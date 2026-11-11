import { orderScreenActKeys } from "./screen-act"

export const RPA_API_OPTIONS = [
  {
    code: "CheckLive",
    defaults: { jumpWhen: "off", steps: "1" },
    group: "系统",
    name: "存活检测",
    params: ["steps", "jumpWhen"],
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
    defaults: { direction: "up", millis: "400", x0: "360", x1: "360", y0: "1100", y1: "420" },
    group: "触摸",
    name: "滑动",
    options: [
      { label: "上", value: "up" },
      { label: "下", value: "down" },
      { label: "左", value: "left" },
      { label: "右", value: "right" },
    ],
    paramLabels: { direction: "方向" },
    params: ["direction", "x0", "y0", "x1", "y1", "millis"],
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

const keyGroup = (value: string): string =>
  KEY_GROUP[value] ??
  (Number(value) >= 7 && Number(value) <= 16
    ? "数字"
    : Number(value) >= 29 && Number(value) <= 54
      ? "字母"
      : "其他")

export const optionLabel = (spec: SkillSpec | undefined, value: string): string =>
  spec?.options?.find((item) => item.value === value)?.label ?? value

export const groupedSkillOptions = (
  options: ReadonlyArray<{ group?: string; label: string; value: string }>,
  current = "",
): Array<
  | { label: string; value: string }
  | { label: string; options: Array<{ label: string; value: string }> }
> => {
  const listed =
    current.length > 0 && !options.some((item) => item.value === current)
      ? [{ label: current, value: current }, ...options]
      : options
  const groups: Array<{ label: string; options: Array<{ label: string; value: string }> }> = []
  for (const item of listed) {
    const name = item.group || keyGroup(item.value)
    const bucket = groups.find((group) => group.label === name)
    const choice = { label: item.label, value: item.value }
    if (bucket === undefined) groups.push({ label: name, options: [choice] })
    else bucket.options.push(choice)
  }
  const only = groups[0]
  return groups.length === 1 && only !== undefined && only.label === "其他"
    ? listed.map((item) => ({ label: item.label, value: item.value }))
    : groups
}

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

export type AnchorField = {
  label: string
  source: string
}

export const fallbackAnchorFields: readonly AnchorField[] = [
  { label: "账号", source: "account.identifier" },
  { label: "密码", source: "account.secret" },
  { label: "地区", source: "account.region" },
  { label: "语言", source: "account.language" },
  { label: "代理地址", source: "proxy.host" },
  { label: "代理端口", source: "proxy.port" },
  { label: "代理账号", source: "proxy.username" },
  { label: "代理密码", source: "proxy.password" },
  { label: "V2链接", source: "proxy.link" },
  { label: "TUN模式", source: "proxy.tun" },
  { label: "强力安全模式", source: "proxy.safe" },
  { label: "备份名字", source: "account.backup_name" },
  { label: "邮箱", source: "account.email" },
  { label: "客户端ID", source: "account.ms_client_id" },
  { label: "令牌TOKEN", source: "account.ms_token" },
  { label: "视频ID", source: "media.video_id" },
  { label: "图片ID", source: "media.image_id" },
]

let anchorFields: readonly AnchorField[] = fallbackAnchorFields

export const setAnchorFields = (next: readonly AnchorField[]): void => {
  anchorFields = next.map((item) => ({ label: item.label, source: item.source }))
}

export const anchorFieldList = (): readonly AnchorField[] => anchorFields

export const anchorFieldLabel = (source: string | undefined): string =>
  source === "pool.text"
    ? "文本池"
    : (anchorFields.find((item) => item.source === source)?.label ?? "")

export type AnchorKey = {
  key: "id" | "identifier"
  label: string
}

export const fallbackAnchorKeys: readonly AnchorKey[] = [
  { key: "id", label: "编号" },
  { key: "identifier", label: "账号" },
]

export type ChainAnchor = {
  key: "id" | "identifier"
  table: "operation_account"
}

export type ChainStep = {
  api: RpaApiCode
  delayMs: number
  guards: GuardCode[]
  id: number
  params: Record<string, string>
  remark: string
  scopes: Record<string, ParamScope>
  sources: Record<string, string>
}

export type ChainRemark = {
  id: string
  name: string
}

export type BehaviorChain = {
  anchor: ChainAnchor | null
  id: string
  lastTestAt: string
  name: string
  origin: ChainOrigin
  remarks: ChainRemark[]
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
  const spec = apiByCode(step.api)
  const detail = Object.keys(step.params)
    .flatMap((key) => {
      const label = paramLabel(spec, key)
      if (step.scopes?.[key] === "external") {
        const field = anchorFieldLabel(step.sources?.[key])
        return field.length === 0 ? [] : [`${label}=${field}`]
      }
      const value = step.params[key] ?? ""
      if (
        key === "steps" &&
        step.api === "CheckLive" &&
        (step.params["jumpWhen"] ?? "off") === "off"
      ) {
        return []
      }
      if (key === "writeOnSuccessValue" || key === "writeOnFailureValue") return []
      if (key === "writeOnSuccessField" || key === "writeOnFailureField") {
        if (value.length === 0) return []
        const side = key === "writeOnSuccessField" ? "成功写回" : "失败写回"
        const written = (
          step.params[
            key === "writeOnSuccessField" ? "writeOnSuccessValue" : "writeOnFailureValue"
          ] ?? ""
        ).trim()
        const names: Record<string, string> = {
          avatar: "头像地址",
          favorite: "获赞",
          follower: "粉丝量",
          following: "关注数",
          name: "展示名",
          note: "备注",
          platformUid: "平台数字 ID",
          region: "归属地",
          tags: "标签",
        }
        const fieldName = names[value] ?? value
        return [`${side}=${fieldName}${written.length > 0 ? ` ${written}` : ""}`]
      }
      if (key === "jumpWhen") {
        if (value === "off" || value.trim().length === 0) return []
        return [`${label}=${value === "failure" ? "失败时" : "成功时"}`]
      }
      const shown = spec?.options === undefined ? value : optionLabel(spec, value)
      return value.trim().length === 0 ? [] : [`${label}=${shown}`]
    })
    .join(" ")
  return detail.length === 0
    ? `${apiLabel(step.api)}  ${step.api}`
    : `${apiLabel(step.api)}  ${detail}`
}

export const chainFingerprint = (steps: readonly ChainStep[]): string =>
  JSON.stringify(
    steps.map((item) => ({
      api: item.api,
      delayMs: item.delayMs ?? 0,
      guards: item.guards ?? [],
      params: item.params,
    })),
  )

export const normalizeDelay = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) return 0
  const next = Math.floor(value)
  if (next < 1) return 0
  return Math.min(next, 60000)
}

const mailSources: Readonly<Record<string, string>> = {
  clientId: "account.ms_client_id",
  email: "account.email",
  refreshToken: "account.ms_token",
}

const mediaSources: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  UploadPitImage: { 图片ID: "media.image_id" },
  UploadPitVideo: { 视频ID: "media.video_id" },
}

const externalSource = (api: RpaApiCode, key: string): string => {
  if (api === "FetchMailCode" && mailSources[key] !== undefined) return mailSources[key] ?? ""
  return mediaSources[api]?.[key] ?? ""
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
    remark: "",
    scopes: Object.fromEntries(
      Object.keys(params).map((key) => [
        key,
        externalSource(api, key).length > 0 ? "external" : "internal",
      ]),
    ),
    sources: Object.fromEntries(
      Object.keys(params).map((key) => {
        const source = externalSource(api, key)
        return [key, source.length > 0 ? source : "literal"]
      }),
    ),
  }
}

const nasApis = new Set([
  "ExportAndroidContainer",
  "DeleteExtraBackup",
  "ImportPitBackup",
  "UploadPitImage",
  "UploadPitVideo",
])

export const orderedParamKeys = (
  api: string,
  params: Readonly<Record<string, string | undefined>>,
): string[] => {
  const spec = apiByCode(api)
  const keys: string[] = []
  const push = (key: string): void => {
    if (key === "nasKey" || keys.includes(key)) return
    keys.push(key)
  }
  for (const key of spec?.params ?? []) push(key)
  if (nasApis.has(api)) {
    push("useNas")
    push("nasId")
  }
  for (const key of Object.keys(params)) push(key)
  if (api === "ScreenAct") return orderScreenActKeys(params, keys)
  return keys
}

export const publishChainSteps = (steps: readonly ChainStep[]): ChainStep[] =>
  steps.map((step) => {
    const keys = orderedParamKeys(step.api, step.params).filter((key) => key in step.params)
    return {
      ...step,
      delayMs: normalizeDelay(step.delayMs),
      remark: (step.remark ?? "").trim(),
      guards: [],
      params: Object.fromEntries(
        keys.map((key) => [key, step.scopes?.[key] === "external" ? "" : (step.params[key] ?? "")]),
      ),
      scopes: { ...(step.scopes ?? {}) },
      sources: Object.fromEntries(
        keys.map((key) => [
          key,
          step.scopes?.[key] !== "external"
            ? "literal"
            : step.api === "ClickJumpNodes" && key === "clickChance"
              ? "chance.external"
              : (step.sources?.[key] ?? ""),
        ]),
      ),
    }
  })

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

export const validateChainName = (name: string): string | null => {
  const trimmed = name.trim()
  if (trimmed.length === 0) return "请填写行为链名称"
  if (trimmed.length > 80) return "名称不能超过 80 个字"
  return null
}
