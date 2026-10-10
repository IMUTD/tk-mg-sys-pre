export const RPA_API_OPTIONS = [
  {
    code: "CheckLive",
    defaults: {},
    group: "系统",
    name: "存活检测",
    params: [],
  },
  {
    code: "TakeCaptureCompress",
    defaults: { quality: "80", type: "jpg" },
    group: "屏幕",
    name: "截图",
    params: ["type", "quality"],
  },
  {
    code: "TouchClick",
    defaults: { x: "360", y: "640" },
    group: "触摸",
    name: "点击",
    params: ["x", "y"],
  },
  {
    code: "TouchDown",
    defaults: { x: "360", y: "640" },
    group: "触摸",
    name: "按下",
    params: ["x", "y"],
  },
  {
    code: "TouchUp",
    defaults: { x: "360", y: "640" },
    group: "触摸",
    name: "抬起",
    params: ["x", "y"],
  },
  {
    code: "TouchMove",
    defaults: { x: "360", y: "800" },
    group: "触摸",
    name: "移动",
    params: ["x", "y"],
  },
  {
    code: "Swipe",
    defaults: { millis: "400", x0: "360", x1: "360", y0: "1100", y1: "420" },
    group: "触摸",
    name: "滑动",
    params: ["x0", "y0", "x1", "y1", "millis"],
  },
  {
    code: "KeyPress",
    defaults: { code: "4" },
    group: "输入",
    name: "按键",
    params: ["code"],
  },
  {
    code: "SendText",
    defaults: { text: "hello" },
    group: "输入",
    name: "输入文字",
    params: ["text"],
  },
  {
    code: "OpenApp",
    defaults: { pkg: "com.zhiliaoapp.musically" },
    group: "应用",
    name: "打开应用",
    params: ["pkg"],
  },
  {
    code: "StopApp",
    defaults: { pkg: "com.zhiliaoapp.musically" },
    group: "应用",
    name: "停止应用",
    params: ["pkg"],
  },
  {
    code: "GetDisplayRotate",
    defaults: {},
    group: "屏幕",
    name: "屏幕旋转",
    params: [],
  },
  {
    code: "DumpNodeXml",
    defaults: { dumpAll: "false" },
    group: "屏幕",
    name: "导出节点",
    params: ["dumpAll"],
  },
  {
    code: "ExecCmd",
    defaults: { cmdline: "pwd" },
    group: "系统",
    name: "执行命令",
    params: ["cmdline"],
  },
] as const

export type RpaApiCode = string
export type SkillSpec = {
  code: string
  defaults: Record<string, string>
  group: string
  hint?: string
  name: string
  options?: ReadonlyArray<{ group?: string; label: string; value: string }>
  paramLabels?: Readonly<Record<string, string>>
  params: readonly string[]
}

export const paramLabel = (spec: SkillSpec | undefined, key: string): string =>
  spec?.paramLabels?.[key] ?? key

let catalog: SkillSpec[] = RPA_API_OPTIONS.map((item) => ({ ...item, params: item.params }))

export const setSkillCatalog = (next: readonly SkillSpec[]): void => {
  catalog = next.map((item) => ({
    code: item.code,
    defaults: { ...item.defaults },
    group: item.group,
    hint: item.hint ?? "",
    name: item.name,
    ...(item.options === undefined ? {} : { options: item.options }),
    ...(item.paramLabels === undefined ? {} : { paramLabels: { ...item.paramLabels } }),
    params: item.params,
  }))
}

export const skillCatalog = (): readonly SkillSpec[] => catalog

export type ChainOrigin = "ai" | "rpa"

export type CloudSlot = {
  height: number
  index: number
  label: string
  rpaPort: number
  status: string
  width: number
}

export type CloudBox = {
  deviceId: string
  host: string
  id: number
  name: string
  online: boolean
  slots: readonly CloudSlot[]
}

export type CloudDevice = {
  deviceId?: string
  height: number
  id: number
  indexNum?: number
  ip: string
  name: string
  online: boolean
  rpaPort: number
  slot: number
  width: number
}

export type ParamScope = "external" | "internal"

export type GuardCode = "ad" | "transcode"

export type ChainStep = {
  api: RpaApiCode
  delayMs: number
  guards: GuardCode[]
  id: number
  params: Record<string, string>
  scopes: Record<string, ParamScope>
}

export type BehaviorChain = {
  id: string
  lastTestAt: string
  name: string
  origin: ChainOrigin
  steps: ChainStep[]
  updateTime: string
}

export type TestResult = {
  at: string
  message: string
  ok: boolean
}

export type ChatMessage = {
  id: number
  role: "assistant" | "user"
  text: string
}

const pad2 = (value: number): string => value.toString().padStart(2, "0")

export const nowText = (): string => {
  const date = new Date()
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export const apiByCode = (code: string): SkillSpec | undefined =>
  catalog.find((item) => item.code === code)

export const apiLabel = (code: string): string => apiByCode(code)?.name ?? code

export const stepText = (step: ChainStep): string => {
  const entries = Object.entries(step.params).filter(([, value]) => value.trim().length > 0)
  const spec = apiByCode(step.api)
  const detail = entries.map(([key, value]) => `${paramLabel(spec, key)}=${value}`).join(" ")
  return detail.length === 0
    ? `${apiLabel(step.api)}  ${step.api}`
    : `${apiLabel(step.api)}  ${detail}`
}

export const chainFingerprint = (steps: readonly ChainStep[]): string =>
  JSON.stringify(steps.map((item) => ({
    api: item.api,
    delayMs: item.delayMs ?? 0,
    guards: item.guards ?? [],
    params: item.params,
  })))

export const normalizeDelay = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) return 0
  const next = Math.floor(value)
  if (next < 1) return 0
  return Math.min(next, 60000)
}

export const createStep = (api: RpaApiCode, id: number): ChainStep => {
  const spec = apiByCode(api)
  const params = spec === undefined ? {} : { ...spec.defaults }
  return {
    api,
    delayMs: 0,
    guards: [],
    id,
    params,
    scopes: Object.fromEntries(Object.keys(params).map((key) => [key, "internal"])),
  }
}

const guardOrder: readonly GuardCode[] = ["ad", "transcode"]

export const publishChainSteps = (steps: readonly ChainStep[]): ChainStep[] =>
  steps.map((step) => ({
    ...step,
    delayMs: normalizeDelay(step.delayMs),
    guards: guardOrder.filter((code) => (step.guards ?? []).includes(code)),
    params: Object.fromEntries(
      Object.entries(step.params).map(([key, value]) => [key, step.scopes?.[key] === "external" ? "" : value]),
    ),
    scopes: { ...(step.scopes ?? {}) },
  }))

export const createSeedDevices = (): CloudDevice[] => []

export const createSeedChains = (): BehaviorChain[] => []

export const originLabel = (origin: ChainOrigin): string => (origin === "ai" ? "AI" : "RPA")

export const originColor = (origin: ChainOrigin): string => (origin === "ai" ? "purple" : "blue")

export const testOnDevice = (
  device: CloudDevice | null,
  label: string,
  now: string,
): TestResult => {
  if (device === null) {
    return { at: now, message: "请先在右侧选择云机", ok: false }
  }
  if (!device.online) {
    return { at: now, message: `${device.name} 不在线，无法测试`, ok: false }
  }
  return {
    at: now,
    message: `已在 ${device.name} (${device.ip}:${device.rpaPort}) 执行 ${label}`,
    ok: true,
  }
}

export const proposeChain = (
  userText: string,
  nextId: number,
): { reply: string; steps: ChainStep[] } => {
  const text = userText.trim()
  const like = text.includes("点赞")
  const steps: ChainStep[] = [
    createStep("OpenApp", nextId),
    createStep("Swipe", nextId + 1),
    like
      ? { ...createStep("TouchClick", nextId + 2), params: { x: "640", y: "980" } }
      : createStep("TouchClick", nextId + 2),
    createStep("Swipe", nextId + 3),
  ]
  return {
    reply: `已根据「${text}」起草 ${steps.length} 步行为链，底层都走魔云腾 RPA 接口。请用右侧云机测试，成功后可永久保存，所有机器人都能执行。`,
    steps,
  }
}

export const validateChainName = (name: string): string | null =>
  name.trim().length === 0 ? "请填写行为链名称" : null
