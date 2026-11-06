import { App, Button, Card, Input, Select, Switch, theme } from "antd"
import { type MutableRefObject, type ReactNode, useEffect, useId, useRef, useState } from "react"
import { useAuth } from "../auth/auth-provider"
import { SaveChainDialog } from "./chain-list"
import { saveChain, updateChain, useChains } from "./chain-store"
import {
  type AnchorField,
  type AnchorKey,
  apiByCode,
  type BehaviorChain,
  type ChainStep,
  createStep,
  type GuardCode,
  groupedSkillOptions,
  normalizeDelay,
  paramLabel,
  publishChainSteps,
  type SkillSpec,
  skillCatalog,
  stepText,
} from "./rpa-api"
import { applyScreenToParams, type DevicePoint } from "./screen-map"
import { type NasCard, readNasCards } from "../storage/nas-s3"

const fuzzyMatch = (text: string, query: string): boolean => {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return true
  return text.toLowerCase().includes(needle)
}

const recentKey = (userId: string): string => `tk-mg.studio-recent.${userId}`

const readRecent = (userId: string): string[] => {
  if (userId.length === 0) return []
  try {
    const raw = localStorage.getItem(recentKey(userId))
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const codes: string[] = []
    for (const item of parsed) {
      if (typeof item !== "string" || item.length === 0 || codes.includes(item)) continue
      codes.push(item)
      if (codes.length === 5) break
    }
    return codes
  } catch {
    return []
  }
}

const rememberRecent = (userId: string, code: string, known: ReadonlySet<string>): string[] => {
  const next = [code, ...readRecent(userId).filter((item) => item !== code && known.has(item))].filter((item) =>
    known.has(item),
  )
  const kept = next.slice(0, 5)
  if (userId.length > 0) localStorage.setItem(recentKey(userId), JSON.stringify(kept))
  return kept
}

const writeFieldOptions = [
  { label: "不写回", value: "" },
  { label: "标签", value: "tags" },
  { label: "粉丝量", value: "follower" },
  { label: "关注数", value: "following" },
  { label: "获赞", value: "favorite" },
  { label: "归属地", value: "region" },
  { label: "备注", value: "note" },
  { label: "平台数字 ID", value: "platformUid" },
  { label: "展示名", value: "name" },
  { label: "头像地址", value: "avatar" },
]

const adoptJumpWrite = (
  params: Record<string, string>,
  scopes: ChainStep["scopes"],
  sources: Record<string, string>,
  fieldKey: string,
  valueKey: string,
  legacyKey: string,
): void => {
  if (params[fieldKey] === undefined) {
    const legacy = (params[legacyKey] ?? "").trim()
    params[fieldKey] = legacy.length > 0 ? "tags" : ""
    params[valueKey] = legacy
  }
  delete params[legacyKey]
  delete scopes[legacyKey]
  delete sources[legacyKey]
}

const nodeJump = (api: string): boolean => api === "JumpNodes" || api === "ClickJumpNodes"

const fillJumpFields = (
  step: ChainStep,
): Pick<ChainStep, "params" | "scopes" | "sources"> => {
  const defaults: Record<string, string> | null =
    nodeJump(step.api)
      ? {
          ...(step.api === "ClickJumpNodes" ? { clickChance: "100" } : {}),
          jumpWhen: "success",
          writeOnSuccessField: "",
          writeOnSuccessValue: "",
          writeOnFailureField: "",
          writeOnFailureValue: "",
        }
      : step.api === "CheckLive"
        ? { jumpWhen: "off", steps: "1" }
        : null
  if (defaults === null) {
    return {
      params: { ...step.params },
      scopes: { ...step.scopes },
      sources: { ...step.sources },
    }
  }
  const params = { ...step.params }
  const scopes = { ...step.scopes }
  const sources = { ...step.sources }
  if (nodeJump(step.api)) {
    adoptJumpWrite(params, scopes, sources, "writeOnSuccessField", "writeOnSuccessValue", "tagOnSuccess")
    adoptJumpWrite(params, scopes, sources, "writeOnFailureField", "writeOnFailureValue", "tagOnFailure")
  }
  for (const key of Object.keys(defaults)) {
    const value = defaults[key]
    if (value !== undefined && params[key] === undefined) params[key] = value
    if (scopes[key] === undefined) scopes[key] = "internal"
    if (sources[key] === undefined) sources[key] = "literal"
  }
  return { params, scopes, sources }
}

type EditingChain = { readonly id: string; readonly name: string }

const retiredSources = new Set([
  "account.backup_device",
  "account.backup_key",
  "device.host",
  "instance.index",
  "instance.name",
  "pool.backup",
  "pool.backup_host",
  "pool.image",
  "pool.image_host",
  "pool.video",
  "pool.video_host",
])

const studioSeed = (chain: BehaviorChain | null): {
  anchorKey: AnchorKey["key"]
  anchorTable: string
  editing: EditingChain | null
  nextId: number
  selectedId: number | null
  steps: ChainStep[]
} => {
  if (chain === null) {
    return { anchorKey: "id", anchorTable: "", editing: null, nextId: 1, selectedId: null, steps: [] }
  }
  const steps = chain.steps.map((step, index) => {
    const filled = fillJumpFields(step)
    return {
      api: step.api,
      delayMs: step.delayMs,
      guards: [...step.guards],
      id: index,
      params: filled.params,
      scopes: filled.scopes,
      sources: Object.fromEntries(
        Object.entries(filled.sources).map(([key, source]) => [
          key,
          source === "pool.text"
            ? step.api === "SendText" && key === "text"
              ? source
              : ""
            : retiredSources.has(source)
              ? ""
              : source,
        ]),
      ),
    }
  })
  return {
    anchorKey: chain.anchor?.key ?? "id",
    anchorTable: chain.anchor?.table ?? "",
    editing: { id: chain.id, name: chain.name },
    nextId: steps.length,
    selectedId: steps[steps.length - 1]?.id ?? null,
    steps,
  }
}

type RpaStudioProps = {
  readonly anchorFields: readonly AnchorField[]
  readonly anchorKeys: readonly AnchorKey[]
  readonly applyScreen: MutableRefObject<(start: DevicePoint, end: DevicePoint) => string | null>
  readonly canWrite: boolean
  readonly loadedChain: BehaviorChain
  readonly mapped: boolean
  readonly onBack: () => void
  readonly onClearMap: () => void
  readonly onMapNodes: () => string
  readonly onSaved: (chain: BehaviorChain) => void
  readonly onTest: (
    name: string,
    steps: readonly ChainStep[],
    chainId?: string,
    chainName?: string,
  ) => boolean
  readonly skills: readonly SkillSpec[]
}

export const RpaStudio = ({
  anchorFields,
  anchorKeys,
  applyScreen,
  canWrite,
  loadedChain,
  mapped,
  onBack,
  onClearMap,
  onMapNodes,
  onSaved,
  onTest,
  skills,
}: RpaStudioProps): ReactNode => {
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const { session } = useAuth()
  const userId = session.kind === "authenticated" ? session.user.userId : ""
  const chains = useChains()
  const studioId = useId()
  const seed = studioSeed(loadedChain)
  const [steps, setSteps] = useState<ChainStep[]>(seed.steps)
  const [nextId, setNextId] = useState(seed.nextId)
  const [pick, setPick] = useState("TouchClick")
  const [query, setQuery] = useState("")
  const [recent, setRecent] = useState<string[]>(() => readRecent(userId))
  const [selectedId, setSelectedId] = useState<number | null>(seed.selectedId)
  const [editing, setEditing] = useState<EditingChain>({ id: loadedChain.id, name: loadedChain.name })
  const list = skills.length > 0 ? skills : skillCatalog()
  const visible = list.filter((item) => fuzzyMatch(`${item.group} ${item.name} ${item.code}`, query))
  const known = new Set(list.map((item) => item.code))
  const recentSkills = recent.flatMap((code) => {
    const skill = list.find((item) => item.code === code)
    return skill === undefined ? [] : [skill]
  })

  useEffect(() => {
    setRecent(readRecent(userId).filter((code) => known.has(code)))
  }, [userId, skills])
  const studioRef = useRef<HTMLDivElement>(null)
  const stepListRef = useRef<HTMLDivElement>(null)
  const [studioHeight, setStudioHeight] = useState<number>()
  const [saving, setSaving] = useState(false)
  const [anchorTable, setAnchorTable] = useState(seed.anchorTable)
  const [anchorKey, setAnchorKey] = useState<AnchorKey["key"]>(seed.anchorKey)
  const canSave = canWrite && steps.length > 0
  const constrained = anchorTable === "operation_account"
  const nasWatch = steps
    .map((item) => `${item.api}:${item.params["useNas"] ?? ""}:${item.params["nasId"] ?? ""}`)
    .join("|")
  const [nasCards, setNasCards] = useState<readonly NasCard[]>([])
  const [backupDirs, setBackupDirs] = useState<readonly { directory: string; name: string; nasId: string }[]>([])
  const [nasNote, setNasNote] = useState("")
  useEffect(() => {
    if (!nasWatch.includes(":on")) return
    let cancelled = false
    const load = async (): Promise<void> => {
      const response = await fetch("/api/storage/configuration", { credentials: "same-origin" })
      if (!response.ok) {
        if (!cancelled) setNasNote("没有读到 NAS 配置")
        return
      }
      const cards = readNasCards(await response.json()).filter((card) => card.bucket.length > 0)
      if (cancelled) return
      setNasCards(cards)
      setNasNote(cards.length === 0 ? "NAS未配置" : "")
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [nasWatch])
  useEffect(() => {
    const cards = nasCards.filter((card) => card.bucket === "backup")
    if (cards.length === 0) {
      setBackupDirs([])
      return
    }
    let cancelled = false
    const loadDirs = async (): Promise<void> => {
      const lists = await Promise.all(
        cards.map(async (card) => {
          const response = await fetch(`/api/share-nas-directories?nasId=${encodeURIComponent(card.id)}`, {
            credentials: "same-origin",
          })
          if (!response.ok) return []
          const body = (await response.json()) as { directories?: string[] }
          return (body.directories ?? []).map((directory) => ({ directory, name: card.name, nasId: card.id }))
        }),
      )
      if (!cancelled) setBackupDirs(lists.flat())
    }
    void loadDirs()
    return () => {
      cancelled = true
    }
  }, [nasCards])

  const addStep = (): void => {
    const id = nextId
    setSteps((current) => [...current, createStep(pick, id)])
    setNextId((current) => current + 1)
    setSelectedId(id)
    setRecent(rememberRecent(userId, pick, known))
    requestAnimationFrame(() => stepListRef.current?.scrollTo({ top: 0 }))
  }

  const setBackupDir = (id: number, value: string): void => {
    const slash = value.indexOf("/")
    const nasId = slash > 0 ? value.slice(0, slash) : ""
    const nasDir = slash > 0 ? value.slice(slash + 1) : ""
    setSteps((current) =>
      current.map((item) =>
        item.id === id ? { ...item, params: { ...item.params, nasDir, nasId } } : item,
      ),
    )
  }

  const patchStep = (id: number, key: string, value: string): void => {
    setSteps((current) =>
      current.map((item) =>
        item.id === id ? { ...item, params: { ...item.params, [key]: value } } : item,
      ),
    )
  }

  const setWrite = (id: number, fieldKey: string, valueKey: string, field: string): void => {
    setSteps((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              params: {
                ...item.params,
                [fieldKey]: field,
                [valueKey]: field === "" ? "" : (item.params[valueKey] ?? ""),
              },
            }
          : item,
      ),
    )
  }

  const setGuard = (id: number, code: GuardCode, on: boolean): void => {
    setSteps((current) =>
      current.map((item) => {
        if (item.id !== id) return item
        const guards = (item.guards ?? []).filter((itemCode) => itemCode !== code)
        return { ...item, guards: on ? [...guards, code] : guards }
      }),
    )
  }

  const setRemark = (id: number, raw: string): void => {
    const remark = raw.replace(/[\r\n]/g, "").slice(0, 40)
    setSteps((current) => current.map((item) => (item.id === id ? { ...item, remark } : item)))
  }

  const setDelay = (id: number, raw: string): void => {
    const digits = raw.replace(/\D/g, "")
    const delayMs = normalizeDelay(digits.length === 0 ? 0 : Number(digits))
    setSteps((current) => current.map((item) => (item.id === id ? { ...item, delayMs } : item)))
  }

  const chooseAnchor = (value: string): void => {
    setAnchorTable(value)
  }

  const setScope = (id: number, key: string, internal: boolean): void => {
    setSteps((current) =>
      current.map((item) => {
        if (item.id !== id) return item
        if (
          (nodeJump(item.api) || item.api === "CheckLive") &&
          (key === "steps" || key === "jumpWhen") &&
          !internal
        ) {
          return item
        }
        if (
          nodeJump(item.api) &&
          (key === "tagOnSuccess" ||
            key === "tagOnFailure" ||
            key === "writeOnSuccessField" ||
            key === "writeOnSuccessValue" ||
            key === "writeOnFailureField" ||
            key === "writeOnFailureValue") &&
          !internal
        ) {
          return item
        }
        const chance = item.api === "ClickJumpNodes" && key === "clickChance"
        const currentChance = (item.params.clickChance ?? "").trim()
        return {
          ...item,
          params: chance
            ? {
                ...item.params,
                clickChance: internal ? (currentChance.length > 0 ? currentChance : "100") : "",
              }
            : item.params,
          scopes: { ...item.scopes, [key]: internal ? "internal" : "external" },
          sources: {
            ...item.sources,
            [key]: internal ? "literal" : chance ? "chance.external" : "",
          },
        }
      }),
    )
  }

  const setSource = (id: number, key: string, source: string): void => {
    setSteps((current) =>
      current.map((item) => {
        if (item.id !== id) return item
        const pool = item.api === "SendText" && key === "text" && source === "pool.text"
        return {
          ...item,
          params: pool ? { ...item.params, text: "" } : item.params,
          sources: { ...item.sources, [key]: source },
        }
      }),
    )
  }

  const move = (id: number, offset: number): void => {
    setSteps((current) => {
      const index = current.findIndex((item) => item.id === id)
      const target = index + offset
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = current.slice()
      const [removed] = next.splice(index, 1)
      if (removed === undefined) return current
      next.splice(target, 0, removed)
      return next
    })
  }

  useEffect(() => {
    const node = studioRef.current
    if (node === null) return
    const measure = (): void => {
      const top = Math.max(0, node.getBoundingClientRect().top)
      setStudioHeight(Math.max(320, Math.round(window.innerHeight - top - 16)))
    }
    measure()
    const frame = window.requestAnimationFrame(measure)
    window.addEventListener("resize", measure)
    if (typeof ResizeObserver === "undefined") {
      return () => {
        window.cancelAnimationFrame(frame)
        window.removeEventListener("resize", measure)
      }
    }
    const observer = new ResizeObserver(measure)
    observer.observe(document.documentElement)
    if (node.parentElement !== null) observer.observe(node.parentElement)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [])

  useEffect(() => {
    applyScreen.current = (start, end) => {
      const step = steps.find((item) => item.id === selectedId)
      if (step === undefined) return "先点一条 RPA 步骤再点画面"
      const applied = applyScreenToParams(step.params, start, end)
      if (applied === null) return "当前步骤没有坐标参数"
      setSteps((current) =>
        current.map((item) => (item.id === step.id ? { ...item, params: applied.params } : item)),
      )
      return applied.message
    }
    return () => {
      applyScreen.current = () => null
    }
  }, [applyScreen, selectedId, steps])

  return (
    <div
      className="behaviors-pane rpa-studio"
      ref={studioRef}
      {...(studioHeight === undefined ? {} : { style: { height: studioHeight } })}
    >
      {canWrite ? (
        <>
        {recentSkills.length === 0 ? null : (
          <div aria-label="快速选择" className="rpa-recent">
            {recentSkills.map((item) => (
              <button
                className={item.code === pick ? "rpa-recent-item active" : "rpa-recent-item"}
                key={item.code}
                onClick={() => setPick(item.code)}
                type="button"
              >
                {item.name}
              </button>
            ))}
          </div>
        )}
        <div className="behaviors-toolbar">
          <Select
            aria-label="约束数据表"
            onChange={chooseAnchor}
            options={[
              { label: "不约束", value: "" },
              { label: "账号表", value: "operation_account" },
            ]}
            style={{ width: 140 }}
            value={anchorTable}
            virtual={false}
          />
          {constrained ? (
            <Select
              aria-label="约束条件"
              onChange={(value: AnchorKey["key"]) => setAnchorKey(value)}
              options={anchorKeys.map((item) => ({ label: item.label, value: item.key }))}
              style={{ width: 140 }}
              value={anchorKey}
              virtual={false}
            />
          ) : null}
          <Button onClick={onBack}>返回</Button>
          <Button onClick={addStep} type="primary">
            添加步骤
          </Button>
          <span className="behaviors-editing">正在编辑「{editing.name}」</span>
          <Button
            disabled={steps.length === 0}
            onClick={() => {
              const ok = onTest(editing.name, steps, editing.id, editing.name)
              if (ok) message.success("全链测试已下发")
            }}
          >
            全链测试
          </Button>
          <Button disabled={!canSave} onClick={() => setSaving(true)}>
            保存
          </Button>
        </div>
        </>
      ) : (
        <p className="behaviors-meta">仅管理员可以编排并保存行为链。</p>
      )}
      <div className={canWrite ? "rpa-studio-body" : "rpa-studio-body readonly"}>
        {canWrite ? (
          <div className="rpa-skill-pane">
            <Input
              allowClear
              aria-label="搜索接口"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索接口"
              value={query}
            />
            <div className="rpa-skill-list">
              {visible.map((item) => (
                <button
                  className={item.code === pick ? "rpa-skill-item active" : "rpa-skill-item"}
                  key={item.code}
                  onClick={() => setPick(item.code)}
                  type="button"
                >
                  <strong>{item.name}</strong>
                  <span>{item.group}</span>
                </button>
              ))}
              {visible.length === 0 ? <p className="behaviors-meta">没有匹配的接口</p> : null}
            </div>
          </div>
        ) : null}
        {steps.length === 0 ? (
          <Card className="behaviors-empty">从左侧选择接口，再点添加步骤。</Card>
        ) : (
        <div className="rpa-step-list" ref={stepListRef}>
          {[...steps].map((item, index) => ({ index, item })).reverse().map(({ index, item }) => {
            const backupNas =
              item.api === "ExportAndroidContainer" ||
              item.api === "DeleteExtraBackup" ||
              item.api === "ImportPitBackup"
            return (
            <Card
              className={item.id === selectedId ? "rpa-step rpa-step-on" : "rpa-step"}
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              size="small"
              title={`${index + 1}. ${stepText(item)}`}
            >
              <div className="rpa-step-params">
                {(() => {
                  const paramKeys = Object.keys(item.params)
                  const nasSkill =
                    backupNas || item.api === "UploadPitImage" || item.api === "UploadPitVideo"
                  if (nasSkill && !paramKeys.includes("useNas")) paramKeys.push("useNas")
                  if (nasSkill && !paramKeys.includes("nasId")) paramKeys.push("nasId")
                  return paramKeys.filter((key) => key !== "nasKey")
                })().map((key) => {
                  const external = item.scopes[key] === "external"
                  const jumpLocked =
                    ((nodeJump(item.api) || item.api === "CheckLive") &&
                      (key === "steps" || key === "jumpWhen")) ||
                    (nodeJump(item.api) &&
                      (key === "tagOnSuccess" ||
                        key === "tagOnFailure" ||
                        key === "writeOnSuccessField" ||
                        key === "writeOnSuccessValue" ||
                        key === "writeOnFailureField" ||
                        key === "writeOnFailureValue"))
                  const writeSide =
                    nodeJump(item.api) && key === "writeOnSuccessField"
                      ? "成功写回"
                      : nodeJump(item.api) && key === "writeOnFailureField"
                        ? "失败写回"
                        : ""
                  const writeValueKey =
                    key === "writeOnSuccessField"
                      ? "writeOnSuccessValue"
                      : key === "writeOnFailureField"
                        ? "writeOnFailureValue"
                        : ""
                  if (
                    nodeJump(item.api) &&
                    (key === "writeOnSuccessValue" || key === "writeOnFailureValue")
                  ) {
                    return null
                  }
                  const jumpOn = item.params["jumpWhen"] !== "off"
                  const jumpMode = item.params["jumpWhen"] === "failure" ? "failure" : "success"
                  const swipeRepeat = item.api === "SwipeNode" && item.params["repeatMode"] === "random" ? "random" : item.api === "SwipeNode" ? "fixed" : ""
                  if (swipeRepeat === "fixed" && (key === "repeatMin" || key === "repeatMax")) return null
                  if (swipeRepeat === "random" && key === "repeatCount") return null
                  const nasOn = item.params["useNas"] === "on"
                  if ((key === "图片ID" || key === "视频ID") && nasOn) return null
                  if (key === "nasDir") return null
                  if ((key === "nasKey" || key === "nasId") && !nasOn) return null
                  const nasBucket =
                    item.api === "UploadPitImage"
                      ? "pictures"
                      : item.api === "UploadPitVideo"
                        ? "videos"
                        : "backup"
                  const nasChoices = nasCards.filter((card) => card.bucket === nasBucket)
                  const requestedNas = item.params["nasId"] ?? ""
                  return (
                    <div className={writeSide.length > 0 ? "rpa-param rpa-write" : "rpa-param"} key={key}>
                      {(nodeJump(item.api) || item.api === "CheckLive") &&
                      key === "jumpWhen" ? (
                        <div className="rpa-source">
                          <span className="rpa-source-label">启动跳跃</span>
                          <Switch
                            aria-label={`${item.api}-启动跳跃`}
                            checked={jumpOn}
                            onChange={(on) => patchStep(item.id, key, on ? jumpMode : "off")}
                            size="small"
                          />
                          <Select<string>
                            aria-label={`${item.api}-跳跃时机`}
                            disabled={!jumpOn}
                            onChange={(mode) => patchStep(item.id, key, mode)}
                            options={[
                              { label: "成功时跳跃", value: "success" },
                              { label: "失败时跳跃", value: "failure" },
                            ]}
                            value={jumpMode}
                            virtual={false}
                          />
                        </div>
                      ) : writeSide.length > 0 ? (
                        <div className="rpa-source">
                          <span className="rpa-source-label">{writeSide}</span>
                          <Select<string>
                            aria-label={`${item.api}-${writeSide}字段`}
                            classNames={{ popup: { root: "rpa-write-menu" } }}
                            listHeight={360}
                            onChange={(field) => setWrite(item.id, key, writeValueKey, field)}
                            options={writeFieldOptions}
                            popupMatchSelectWidth={false}
                            value={item.params[key] ?? ""}
                            virtual={false}
                          />
                          <Input
                            aria-label={`${item.api}-${writeSide}值`}
                            disabled={(item.params[key] ?? "") === ""}
                            onChange={(event) => patchStep(item.id, writeValueKey, event.target.value)}
                            placeholder={(item.params[key] ?? "") === "" ? "" : "写回值"}
                            value={item.params[writeValueKey] ?? ""}
                          />
                          <Switch
                            aria-label={`${item.api}-${key}-范围`}
                            checked
                            checkedChildren="内部"
                            disabled
                            size="small"
                            unCheckedChildren="外部"
                          />
                        </div>
                      ) : item.api === "SwipeNode" && key === "repeatMode" ? (
                        <div className="rpa-source">
                          <span className="rpa-source-label">次数</span>
                          <Select<string>
                            aria-label="SwipeNode-次数"
                            onChange={(value) => patchStep(item.id, key, value)}
                            options={[
                              { label: "固定次数", value: "fixed" },
                              { label: "随机次数", value: "random" },
                            ]}
                            value={swipeRepeat}
                            virtual={false}
                          />
                        </div>
                      ) : key === "useNas" ? (
                        <div className="rpa-source">
                          <span className="rpa-source-label">联通 NAS</span>
                          <Switch
                            aria-label={`${item.api}-联通 NAS`}
                            checked={nasOn}
                            onChange={(on) => patchStep(item.id, key, on ? "on" : "off")}
                            size="small"
                          />
                          {nasOn && nasNote.length > 0 ? <span>{nasNote}</span> : null}
                        </div>
                      ) : key === "nasId" && backupNas ? (
                        <Select<string>
                          aria-label={`${item.api}-目录`}
                          onChange={(value) => setBackupDir(item.id, value)}
                          options={backupDirs.map((dir) => ({
                            label: `${dir.name} · ${dir.directory}`,
                            value: `${dir.nasId}/${dir.directory}`,
                          }))}
                          placeholder="选择目录"
                          value={
                            backupDirs.some(
                              (dir) => dir.nasId === requestedNas && dir.directory === (item.params["nasDir"] ?? ""),
                            )
                              ? `${requestedNas}/${item.params["nasDir"] ?? ""}`
                              : null
                          }
                          virtual={false}
                        />
                      ) : key === "nasId" ? (
                        <Select<string>
                          aria-label={`${item.api}-NAS`}
                          onChange={(value) => patchStep(item.id, key, value)}
                          options={nasChoices.map((card) => ({ label: `${card.name} · ${card.bucket}`, value: card.id }))}
                          placeholder="选择 NAS"
                          value={nasChoices.some((card) => card.id === requestedNas) ? requestedNas : null}
                          virtual={false}
                        />
                      ) : key === "nasKey" ? null : !external &&
                        (apiByCode(item.api)?.options?.length ?? 0) > 0 &&
                        key === "code" ? (
                        <div className="rpa-source">
                          <span className="rpa-source-label">
                            {paramLabel(apiByCode(item.api), key)}
                          </span>
                          <Select<string>
                            aria-label={`${item.api}-${key}`}
                            onChange={(value) => patchStep(item.id, key, value)}
                            optionFilterProp="label"
                            options={groupedSkillOptions(
                              apiByCode(item.api)?.options ?? [],
                              item.params[key] ?? "",
                            )}
                            placeholder="选择按键"
                            popupMatchSelectWidth={false}
                            showSearch
                            value={item.params[key] || null}
                            virtual={false}
                          />
                        </div>
                      ) : external && item.api === "ClickJumpNodes" && key === "clickChance" ? (
                        <div className="rpa-source">
                          <span className="rpa-source-label">
                            {paramLabel(apiByCode(item.api), key)}
                          </span>
                          <span aria-label={`${item.api}-${key}-来源`} className="rpa-chance-pill">
                            外部概率
                          </span>
                        </div>
                      ) : external ? (
                        <label className="rpa-source" htmlFor={`${studioId}-${item.id}-${key}`}>
                          <span className="rpa-source-label">
                            {paramLabel(apiByCode(item.api), key)}
                          </span>
                          <Select<string>
                            aria-label={`${item.api}-${key}-来源`}
                            id={`${studioId}-${item.id}-${key}`}
                            onChange={(source) => setSource(item.id, key, source)}
                            optionRender={(option) =>
                              String(option.value ?? "").startsWith("account.") ? (
                                <span style={{ color: token.colorPrimary }}>{option.label}</span>
                              ) : (
                                <span>{option.label}</span>
                              )
                            }
                            options={(item.api === "SendText" && key === "text"
                              ? [...anchorFields, { label: "文本池", source: "pool.text" }]
                              : anchorFields
                            ).map((field) => ({
                              label: field.label,
                              value: field.source,
                            }))}
                            placeholder="选择字段"
                            value={item.sources?.[key] || null}
                            virtual={false}
                          />
                        </label>
                      ) : (
                        <Input
                          addonBefore={paramLabel(apiByCode(item.api), key)}
                          aria-label={`${item.api}-${key}`}
                          onChange={(event) => patchStep(item.id, key, event.target.value)}
                          placeholder={
                            item.api === "DeleteExtraBackup" && key === "backupName"
                              ? "留空则用当前坑位的云机名"
                              : ""
                          }
                          value={item.params[key]}
                        />
                      )}
                      {key === "jumpWhen" || key === "useNas" || key === "nasId" || key === "nasDir" || key === "nasKey" || writeSide.length > 0 ? null : (
                        <Switch
                          aria-label={`${item.api}-${key}-范围`}
                          checked={!external}
                          checkedChildren="内部"
                          disabled={jumpLocked}
                          onChange={(internal) => setScope(item.id, key, internal)}
                          size="small"
                          unCheckedChildren="外部"
                        />
                      )}
                    </div>
                  )
                })}
                <div className="rpa-delay">
                  <Input
                    addonAfter="毫秒"
                    addonBefore="延时"
                    aria-label={`${item.api}-延时`}
                    onChange={(event) => setDelay(item.id, event.target.value)}
                    value={item.delayMs > 0 ? String(item.delayMs) : ""}
                  />
                </div>
                <div className="rpa-guards">
                  <span>守护</span>
                  <label htmlFor={`${studioId}-${item.id}-ad`}>
                    <Switch
                      aria-label={`${item.api}-广告通过`}
                      id={`${studioId}-${item.id}-ad`}
                      checked={(item.guards ?? []).includes("ad")}
                      onChange={(on) => setGuard(item.id, "ad", on)}
                      size="small"
                    />
                    广告通过
                  </label>
                  <label htmlFor={`${studioId}-${item.id}-transcode`}>
                    <Switch
                      aria-label={`${item.api}-转码通过`}
                      id={`${studioId}-${item.id}-transcode`}
                      checked={(item.guards ?? []).includes("transcode")}
                      onChange={(on) => setGuard(item.id, "transcode", on)}
                      size="small"
                    />
                    转码通过
                  </label>
                </div>
                <div className="rpa-delay rpa-remark">
                  <Input
                    addonBefore="备注"
                    aria-label={`${item.api}-备注`}
                    disabled={!canWrite}
                    maxLength={40}
                    onChange={(event) => setRemark(item.id, event.target.value)}
                    placeholder="给这一步起个短名字"
                    value={item.remark ?? ""}
                  />
                  <span className="rpa-remark-hint">这个名字会进日志，也会用作新增任务里的调节条。</span>
                </div>
                {canWrite || item.api === "ArrangeNodes" ? (
                  <div className="rpa-step-actions">
                    {item.api === "ArrangeNodes" ? (
                      <Button
                        aria-label="ArrangeNodes-映射"
                        onClick={() => {
                          setSelectedId(item.id)
                          if (mapped) {
                            onClearMap()
                            message.info("已取消画面上的范围")
                            return
                          }
                          message.info(onMapNodes())
                        }}
                        size="small"
                      >
                        {mapped ? "取消映射" : "映射"}
                      </Button>
                    ) : null}
                    {canWrite ? (
                      <>
                        <Button
                          aria-label={`${item.api}-单步测试`}
                          onClick={() => {
                            setSelectedId(item.id)
                            const ok = onTest(stepText(item), [item], editing.id, editing.name)
                            if (ok) message.success("已下发单步测试")
                          }}
                          size="small"
                          type="primary"
                        >
                          测试
                        </Button>
                        <Button
                          disabled={index === steps.length - 1}
                          onClick={() => move(item.id, 1)}
                          size="small"
                        >
                          上移
                        </Button>
                        <Button disabled={index === 0} onClick={() => move(item.id, -1)} size="small">
                          下移
                        </Button>
                        <Button
                          danger
                          onClick={() => {
                            setSteps((current) => current.filter((step) => step.id !== item.id))
                          }}
                          size="small"
                        >
                          删除
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Card>
            )
          })}
        </div>
        )}
      </div>
      {saving ? (
        <SaveChainDialog
          initialName={editing.name}
          note="名称不变则保存回当前行为链。修改名称会另存为一条新的行为链。"
          onCancel={() => setSaving(false)}
          onSubmit={(name) => {
            const trimmed = name.trim()
            const renamed = trimmed !== editing.name.trim()
            if (renamed && chains.some((item) => item.name === trimmed)) {
              message.error("名称已存在")
              return
            }
            const anchor = constrained ? { key: anchorKey, table: "operation_account" as const } : null
            const stepsToSave = publishChainSteps(steps)
            const request = renamed
              ? saveChain(loadedChain.origin, trimmed, stepsToSave, anchor)
              : updateChain(editing.id, trimmed, stepsToSave, anchor)
            void request
              .then((saved) => {
                setSaving(false)
                setEditing({ id: saved.id, name: saved.name })
                onSaved(saved)
                message.success(renamed ? "已保存为新的行为链" : "已保存")
              })
              .catch((caught: unknown) =>
                message.error(
                  caught instanceof Error && caught.message === "chain_name_taken"
                    ? "名称已存在"
                    : caught instanceof Error &&
                        (caught.message === "备注过长" || caught.message === "备注无效")
                      ? caught.message
                      : "保存失败",
                ),
              )
          }}
          title="保存行为链"
        />
      ) : null}
    </div>
  )
}
