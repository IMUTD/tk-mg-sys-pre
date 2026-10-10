import { Button, Card, Form, Input, Select, Space } from "antd"
import { type MutableRefObject, type ReactNode, useEffect, useState } from "react"

import { apiByCode, createStep, paramLabel, type SkillSpec, skillCatalog } from "./rpa-api"
import { applyScreenToParams, type DevicePoint } from "./screen-map"

const KEY_GROUP: Record<string, string> = {
  "3": "系统",
  "4": "系统",
  "5": "系统",
  "6": "系统",
  "26": "系统",
  "27": "系统",
  "82": "系统",
  "83": "系统",
  "84": "系统",
  "187": "系统",
  "219": "系统",
  "19": "导航",
  "20": "导航",
  "21": "导航",
  "22": "导航",
  "23": "导航",
  "61": "导航",
  "92": "导航",
  "93": "导航",
  "111": "导航",
  "122": "导航",
  "123": "导航",
  "24": "音量/媒体",
  "25": "音量/媒体",
  "91": "音量/媒体",
  "164": "音量/媒体",
  "85": "音量/媒体",
  "86": "音量/媒体",
  "87": "音量/媒体",
  "88": "音量/媒体",
  "89": "音量/媒体",
  "90": "音量/媒体",
  "126": "音量/媒体",
  "127": "音量/媒体",
  "28": "编辑",
  "62": "编辑",
  "66": "编辑",
  "67": "编辑",
  "112": "编辑",
  "124": "编辑",
  "17": "符号",
  "18": "符号",
  "55": "符号",
  "56": "符号",
  "68": "符号",
  "69": "符号",
  "70": "符号",
  "71": "符号",
  "72": "符号",
  "73": "符号",
  "74": "符号",
  "75": "符号",
  "76": "符号",
  "77": "符号",
  "81": "符号",
  "57": "修饰",
  "58": "修饰",
  "59": "修饰",
  "60": "修饰",
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

const groupedChoices = (
  options: ReadonlyArray<{ group?: string; label: string; value: string }>,
  fallbackGroup?: (value: string) => string,
) => {
  const groups: Array<{ label: string; options: Array<{ label: string; value: string }> }> = []
  for (const item of options) {
    const name = item.group || fallbackGroup?.(item.value) || "其他"
    const bucket = groups.find((group) => group.label === name)
    const choice = { label: item.label, value: item.value }
    if (bucket === undefined) groups.push({ label: name, options: [choice] })
    else bucket.options.push(choice)
  }
  return groups.length === 1 && groups[0]?.label === "其他"
    ? options.map((item) => ({ label: item.label, value: item.value }))
    : groups
}

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
  const list = skills.length > 0 ? skills : skillCatalog()
  const [code, setCode] = useState("TouchClick")
  const spec = apiByCode(code)
  const [params, setParams] = useState<Record<string, string>>({
    ...createStep("TouchClick", 1).params,
  })

  const pick = (next: string): void => {
    setCode(next)
    setParams({ ...createStep(next, 1).params })
  }

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
    const found = groups.find((group) => group.name === item.group)
    if (found === undefined) groups.push({ items: [item], name: item.group || "其他" })
    else found.items.push(item)
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
          options={groupedChoices(
            spec.options,
            (value) =>
              KEY_GROUP[value] ??
              (Number(value) >= 7 && Number(value) <= 16
                ? "数字"
                : Number(value) >= 29 && Number(value) <= 54
                  ? "字母"
                  : "其他"),
          )}
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
        onChange={(event) => setParams((current) => ({ ...current, [key]: event.target.value }))}
        value={params[key] ?? ""}
      />
    )
  }

  return (
    <div className="behaviors-pane api-lab">
      <p className="behaviors-meta">
        这里是行为链最底层的单元，对应魔云腾 RPA 接口。AI 制定和 RPA 编排都建立在这些接口上。
      </p>
      <div className="api-lab-layout">
        <div className="api-lab-list">
          {groups.map((group) => (
            <div key={group.name}>
              <div className="api-lab-group">{group.name}</div>
              {group.items.map((item) => (
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
          ))}
        </div>
        <Card size="small" title={spec === undefined ? "接口" : `${spec.name} · ${spec.code}`}>
          <Form layout="vertical" size="small">
            {spec?.hint ? <p className="behaviors-meta">{spec.hint}</p> : null}
            {spec?.params.map((key) => (
              <Form.Item key={key} label={paramLabel(spec, key)}>
                {fieldControl(key)}
              </Form.Item>
            ))}
          </Form>
          <Space>
            <Button
              loading={pending}
              onClick={() => {
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
