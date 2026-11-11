import { Button, Card, Form, Input, Select, Space } from "antd"
import { Fragment, type MutableRefObject, type ReactNode, useEffect, useState } from "react"

import { useAuth } from "../auth/auth-provider"
import { apiByCode, createStep, groupedSkillOptions, paramLabel, type SkillSpec, skillCatalog } from "./rpa-api"
import {
  applyScreenToParams,
  type DevicePoint,
  paramsForPhaseSwipe,
  paramsForSwipeDirection,
  type SwipeDirection,
  swipeDirectionOf,
  withInferredSwipeDirection,
} from "./screen-map"
import { foldedScreenSkills, orderScreenActKeys, screenActHeading, screenActPhase, screenActVisible } from "./screen-act"

type LabRecord = {
  code: string
  id: string
  params: Record<string, string>
  usedAt: number
}

const labUseKey = (userId: string): string => `tk-mg.lab-frequent.${userId}`

const readParams = (value: unknown): Record<string, string> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {}
  const params: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") params[key] = item
  }
  return params
}

const readLabUses = (userId: string): LabRecord[] => {
  if (userId.length === 0) return []
  try {
    const raw = localStorage.getItem(labUseKey(userId))
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .flatMap((item, index) => {
        if (item === null || typeof item !== "object") return []
        const row = item as {
          code?: unknown
          id?: unknown
          lastUsedAt?: unknown
          params?: unknown
          usedAt?: unknown
        }
        if (typeof row.code !== "string" || row.code.length === 0) return []
        const usedAt = typeof row.usedAt === "number" ? row.usedAt : row.lastUsedAt
        if (typeof usedAt !== "number" || !Number.isFinite(usedAt)) return []
        const id =
          typeof row.id === "string" && row.id.length > 0
            ? row.id
            : `${usedAt}:${row.code}:${index}`
        return [{ code: row.code, id, params: readParams(row.params), usedAt }]
      })
      .sort((left, right) => right.usedAt - left.usedAt)
      .slice(0, 5)
  } catch {
    return []
  }
}

const rememberLabUse = (
  userId: string,
  code: string,
  params: Record<string, string>,
  known: ReadonlySet<string>,
): LabRecord[] => {
  const current = readLabUses(userId).filter((item) => known.has(item.code))
  if (!known.has(code)) {
    localStorage.setItem(labUseKey(userId), JSON.stringify(current))
    return current
  }
  const usedAt = Date.now()
  const next = [
    {
      code,
      id: `${usedAt}-${Math.random().toString(36).slice(2, 8)}`,
      params: { ...params },
      usedAt,
    },
    ...current,
  ].slice(0, 5)
  localStorage.setItem(labUseKey(userId), JSON.stringify(next))
  return next
}

const recordTime = (usedAt: number): string => {
  const date = new Date(usedAt)
  const pad = (value: number): string => String(value).padStart(2, "0")
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const PKG_OPTIONS = [
  { label: "国际版抖音 TikTok", value: "com.zhiliaoapp.musically" },
  { label: "抖音", value: "com.ss.android.ugc.aweme" },
  { label: "系统设置", value: "com.android.settings" },
]

const LANGUAGE_OPTIONS = [
  { label: "英语 en", value: "en" },
  { label: "中文 zh", value: "zh" },
  { label: "日语 ja", value: "ja" },
  { label: "韩语 ko", value: "ko" },
]

const COUNTRY_OPTIONS = [
  { label: "美国 US", value: "US" },
  { label: "中国 CN", value: "CN" },
  { label: "日本 JP", value: "JP" },
  { label: "韩国 KR", value: "KR" },
]

type ApiLabProps = {
  readonly applyScreen: MutableRefObject<(start: DevicePoint, end: DevicePoint) => string | null>
  readonly onEnqueue: (
    name: string,
    steps: readonly ReturnType<typeof createStep>[],
  ) => Promise<string | null>
  readonly pending: boolean
  readonly skills: readonly SkillSpec[]
}

export const ApiLab = ({ applyScreen, onEnqueue, pending, skills }: ApiLabProps): ReactNode => {
  const { session } = useAuth()
  const userId = session.kind === "authenticated" ? session.user.userId : ""
  const list = skills.length > 0 ? skills : skillCatalog()
  const [code, setCode] = useState("TouchClick")
  const [groupName, setGroupName] = useState<string | null>(null)
  const [openedId, setOpenedId] = useState<string | null>(null)
  const [frequent, setFrequent] = useState<LabRecord[]>(() => readLabUses(userId))
  const spec = apiByCode(code)
  const known = new Set(list.map((item) => item.code))
  const shortcuts = frequent.filter((item) => known.has(item.code)).slice(0, 5)
  const [params, setParams] = useState<Record<string, string>>({
    ...createStep("TouchClick", 1).params,
  })

  const pick = (next: string): void => {
    setOpenedId(null)
    setCode(next)
    setParams({ ...createStep(next, 1).params })
    const group = list.find((item) => item.code === next)?.group
    if (group !== undefined && group.length > 0) setGroupName(group)
  }

  const openRecord = (item: LabRecord): void => {
    setOpenedId(item.id)
    setCode(item.code)
    setParams({ ...createStep(item.code, 1).params, ...item.params })
    const group = list.find((specItem) => specItem.code === item.code)?.group
    if (group !== undefined && group.length > 0) setGroupName(group)
  }

  useEffect(() => {
    setFrequent(readLabUses(userId))
  }, [userId])

  useEffect(() => {
    applyScreen.current = (start, end) => {
      const applied = applyScreenToParams(params, start, end)
      if (applied === null) return "当前接口没有坐标参数"
      setParams(applied.params)
      return applied.message
    }
    return () => {
      applyScreen.current = () => null
    }
  }, [applyScreen, params])

  const groups: Array<{ items: SkillSpec[]; name: string }> = []
  for (const item of list) {
    if (foldedScreenSkills.has(item.code)) continue
    const found = groups.find((group) => group.name === item.group)
    if (found === undefined) groups.push({ items: [item], name: item.group || "其他" })
    else found.items.push(item)
  }
  const selectedName =
    (groupName !== null && groups.some((group) => group.name === groupName)
      ? groupName
      : groups.find((group) => group.items.some((item) => item.code === code))?.name) ??
    groups[0]?.name ??
    ""
  const visible = groups.find((group) => group.name === selectedName)?.items ?? []

  const chooseGroup = (name: string): void => {
    setGroupName(name)
    const group = groups.find((item) => item.name === name)
    if (group === undefined || group.items.some((item) => item.code === code)) return
    const first = group.items[0]
    if (first !== undefined) pick(first.code)
  }

  const fieldControl = (key: string) => {
    if (spec === undefined) return null
    if (key === "code" && spec.options !== undefined && spec.options.length > 0) {
      return (
        <Select<
          string,
          { label: string; value?: string; options?: Array<{ label: string; value: string }> }
        >
          aria-label={key}
          onChange={(value) => setParams((current) => ({ ...current, [key]: value }))}
          options={groupedSkillOptions(spec.options, params[key] ?? "")}
          showSearch
          value={params[key] ?? ""}
          virtual={false}
        />
      )
    }
    if (key === "pkg") {
      const current = params[key] ?? ""
      const options =
        PKG_OPTIONS.some((item) => item.value === current) || current === ""
          ? PKG_OPTIONS
          : [{ label: current, value: current }, ...PKG_OPTIONS]
      return (
        <Select
          aria-label={key}
          onChange={(value) => setParams((currentParams) => ({ ...currentParams, [key]: value }))}
          options={options}
          value={current}
          virtual={false}
        />
      )
    }
    if (key === "language") {
      return (
        <Select
          aria-label={key}
          onChange={(value) => setParams((current) => ({ ...current, [key]: value }))}
          options={LANGUAGE_OPTIONS}
          value={params[key] ?? ""}
          virtual={false}
        />
      )
    }
    if (key === "country") {
      return (
        <Select
          aria-label={key}
          onChange={(value) => setParams((current) => ({ ...current, [key]: value }))}
          options={COUNTRY_OPTIONS}
          value={params[key] ?? ""}
          virtual={false}
        />
      )
    }
    return (
      <Input
        aria-label={key}
        onChange={(event) =>
          setParams((current) => {
            const next = { ...current, [key]: event.target.value }
            return spec.code === "Swipe" && (key === "x0" || key === "y0" || key === "x1" || key === "y1")
              ? withInferredSwipeDirection(next)
              : next
          })
        }
        value={params[key] ?? ""}
      />
    )
  }

  return (
    <div className="behaviors-pane api-lab">
      {shortcuts.length === 0 ? null : (
        <section aria-label="使用记录" className="api-lab-frequent">
          {shortcuts.map((item) => {
            const skill = list.find((specItem) => specItem.code === item.code)
            if (skill === undefined) return null
            return (
              <button
                className={item.id === openedId ? "api-lab-item active" : "api-lab-item"}
                key={item.id}
                onClick={() => openRecord(item)}
                type="button"
              >
                <strong>{skill.name}</strong>
                <span>
                  {skill.code} · {recordTime(item.usedAt)}
                </span>
              </button>
            )
          })}
        </section>
      )}
      <p className="behaviors-meta">
        这里是行为链最底层的单元，对应魔云腾 RPA 接口。AI 制定和 RPA 编排都建立在这些接口上。
      </p>
      <div className="api-lab-layout">
        <div className="api-lab-list">
          <Select
            aria-label="分组"
            onChange={chooseGroup}
            options={groups.map((group) => ({ label: group.name, value: group.name }))}
            showSearch
            value={selectedName}
            virtual={false}
          />
          <div className="api-lab-skills">
            {visible.map((item) => (
              <button
                className={item.code === code ? "api-lab-item active" : "api-lab-item"}
                key={item.code}
                onClick={() => pick(item.code)}
                type="button"
              >
                <strong>{item.name}</strong>
                <span>{item.code}</span>
              </button>
            ))}
          </div>
        </div>
        <Card size="small" title={spec === undefined ? "接口" : `${spec.name} · ${spec.code}`}>
          <Form layout="vertical" size="small">
            {spec?.hint ? <p className="behaviors-meta">{spec.hint}</p> : null}
            {spec === undefined
              ? null
              : (spec.code === "ScreenAct" ? orderScreenActKeys(params, spec.params) : spec.params).map((key) => {
              if (spec.code === "ScreenAct" && !screenActVisible(params, key)) return null
              const section =
                spec.code === "SwipeWait" && key === "swipeText"
                  ? "滑动"
                  : spec.code === "SwipeWait" && key === "text"
                    ? "出现后通过"
                    : spec.code === "ScreenAct"
                      ? screenActHeading(params, key)
                      : ""
              const swipeRepeat = spec.code !== "SwipeNode" ? "" : params["repeatMode"] === "random" ? "random" : "fixed"
              if (swipeRepeat === "fixed" && (key === "repeatMin" || key === "repeatMax")) return null
              if (swipeRepeat === "random" && key === "repeatCount") return null
              return (
                <Fragment key={key}>
                {section.length > 0 ? <div className="rpa-section">{section}</div> : null}
                <Form.Item label={paramLabel(spec, key)}>
                  {spec.code === "ScreenAct" && key.endsWith("Action") ? (
                    <Select
                      aria-label={key}
                      onChange={(value) => setParams((current) => ({ ...current, [key]: value }))}
                      options={[
                        { label: "不执行", value: "" },
                        { label: "OCR识别", value: "OcrClick" },
                        { label: "新节点点击", value: "ClickArrangedNode" },
                        { label: "节点点击", value: "ClickNode" },
                        { label: "滑动", value: "Swipe" },
                        { label: "节点滑动", value: "SwipeNode" },
                        { label: "等待节点", value: "WaitNode" },
                        { label: "持续滑动等待", value: "SwipeWait" },
                      ]}
                      value={params[key] ?? ""}
                      virtual={false}
                    />
                  ) : spec.code === "ScreenAct" && key.endsWith("Pass") ? (
                    <Select
                      aria-label={key}
                      onChange={(value) => setParams((current) => ({ ...current, [key]: value }))}
                      options={[
                        { label: "只要执行就算成功", value: "on" },
                        { label: "必须命中", value: "off" },
                      ]}
                      value={(params[key] ?? "on") === "off" ? "off" : "on"}
                      virtual={false}
                    />
                  ) : spec.code === "ScreenAct" && key.endsWith("Focus") ? (
                    <Select
                      aria-label={key}
                      onChange={(value) => setParams((current) => ({ ...current, [key]: value }))}
                      options={[
                        { label: "整个画面", value: "" },
                        { label: "左侧", value: "left" },
                        { label: "右侧", value: "right" },
                        { label: "上方", value: "above" },
                        { label: "下方", value: "below" },
                      ]}
                      value={params[key] ?? ""}
                      virtual={false}
                    />
                  ) : spec.code === "ScreenAct" && key.endsWith("Direction") ? (
                    <Select<SwipeDirection>
                      aria-label={key}
                      onChange={(value) => setParams((current) => paramsForPhaseSwipe(current, screenActPhase(key), value))}
                      options={[
                        { label: "上", value: "up" },
                        { label: "下", value: "down" },
                        { label: "左", value: "left" },
                        { label: "右", value: "right" },
                      ]}
                      value={
                        params[key] === "down" || params[key] === "left" || params[key] === "right"
                          ? params[key]
                          : "up"
                      }
                      virtual={false}
                    />
                  ) : spec.code === "ScreenAct" && key.endsWith("RepeatMode") ? (
                    <Select
                      aria-label={key}
                      onChange={(value) => setParams((current) => ({ ...current, [key]: value }))}
                      options={[
                        { label: "固定次数", value: "fixed" },
                        { label: "随机次数", value: "random" },
                      ]}
                      value={params[key] === "random" ? "random" : "fixed"}
                      virtual={false}
                    />
                  ) : spec.code === "Swipe" && key === "direction" ? (
                    <Select<SwipeDirection>
                      aria-label="方向"
                      onChange={(value) => setParams((current) => paramsForSwipeDirection(current, value))}
                      options={[
                        { label: "上", value: "up" },
                        { label: "下", value: "down" },
                        { label: "左", value: "left" },
                        { label: "右", value: "right" },
                      ]}
                      value={swipeDirectionOf(params)}
                      virtual={false}
                    />
                  ) : spec.code === "SwipeNode" && key === "repeatMode" ? (
                    <Select
                      aria-label="次数"
                      onChange={(value) => setParams((current) => ({ ...current, [key]: value }))}
                      options={[
                        { label: "固定次数", value: "fixed" },
                        { label: "随机次数", value: "random" },
                      ]}
                      value={swipeRepeat}
                      virtual={false}
                    />
                  ) : (
                    fieldControl(key)
                  )}
                </Form.Item>
                </Fragment>
              )
            })}
          </Form>
          <Space>
            <Button
              loading={pending}
              onClick={() => {
                if (userId.length > 0) setFrequent(rememberLabUse(userId, code, params, known))
                void onEnqueue(code, [{ ...createStep(code, 1), params }])
              }}
              type="primary"
            >
              测试
            </Button>
          </Space>
        </Card>
      </div>
    </div>
  )
}
