export const PROXY_TYPE_OPTIONS = [
  { label: "V2", value: "0" },
  { label: "HTTP", value: "1" },
  { label: "SOCKS5", value: "2" },
] as const

export const ENABLE_OPTIONS = [
  { label: "启用", value: "true" },
  { label: "停用", value: "false" },
] as const

export const BATCH_SWITCH_OPTIONS = [
  { label: "保持", value: "keep" },
  { label: "开启", value: "on" },
  { label: "关闭", value: "off" },
] as const

export const DETECT_MODE_OPTIONS = [
  { label: "快速模式", value: "quick" },
  { label: "详细模式", value: "detailed" },
] as const

export const DETECT_CHANNEL_OPTIONS = [
  { label: "国内通道", value: "cn" },
  { label: "海外通道", value: "us" },
] as const

export const PROXY_FAQS = [
  {
    key: "import",
    question: "如何导入代理？",
    answer:
      "SOCKS5 / HTTP 每行一条，格式为 IP|端口|用户名|密码 或 IP:端口:用户名:密码。V2 使用 vmess:// 或 vless:// 链接，一行一条。",
  },
  {
    key: "dynamic",
    question: "如何设置动态代理？",
    answer: "类型选择动态代理，账号中用 {} 代替 sessionId，每次使用时自动切换，避免使用轮换代理。",
  },
  {
    key: "detect",
    question: "代理检测失败怎么办？",
    answer: "请核对 IP、端口、账号和密码，并确认当前环境可访问海外网络，或先配置加速节点后再检测。",
  },
  {
    key: "save",
    question: "节流模式说明",
    answer: "节流用于降低流量消耗，需要有加速节点或者在海外环境。",
  },
  {
    key: "tun",
    question: "TUN 模式说明",
    answer: "TUN 为全局接管模式，会接管设备网络流量。",
  },
  {
    key: "safe",
    question: "强力安全模式说明",
    answer: "请配合 TUN 模式打开。强隐私场景使用前请联系客服确认。",
  },
] as const

export const SEED_DYNAMIC_TRAFFIC = "0 GB"

export type ProxyType = "0" | "1" | "2" | "3"
export type ProxyKind = "dynamic" | "static"
export type BatchSwitch = "keep" | "off" | "on"
export type DetectMode = "detailed" | "quick"
export type DetectChannel = "cn" | "us"

export type MytProxy = {
  bindNumber: number
  createTime: string
  expiredTime: string | null
  extra: string
  favorite: boolean
  id: number
  ip: string
  password: string
  port: string
  proxyType: ProxyKind
  region: string
  remark: string
  result: string | null
  refreshUrl: string
  safe: boolean
  save: boolean
  status: boolean
  tag: string
  tun: boolean
  turbo: boolean
  turboNode: number | null
  turboNodeList: readonly number[]
  type: ProxyType
  updateTime: string
  userId: number | null
  username: string
  vpc: boolean
}

export type ProxyQuery = {
  expiredTime: string
  favorite: boolean
  id: string
  noTag: boolean
  save: string
  search: string
  tag: string
  tun: string
  turboNode: string
  type: string
}

export type ProxyCheckItem = {
  delay: number
  ok: boolean
  response_body?: { country?: string; ip?: string }
  status: number
  url: string
}

export type ProxyCheckResult = {
  channel: DetectChannel
  check_time: number
  failures: number
  include_response: boolean
  message: string
  mode: DetectMode
  ok: boolean
  results: readonly ProxyCheckItem[]
  status: number
  successes: number
  use_turbo: boolean
}

export type DetectOptions = {
  channel: DetectChannel
  mode: DetectMode
  useTurbo: boolean
}

export type ImportProxyInput = {
  autoSeq: boolean
  content: string
  expiredTime: string | null
  proxyType: ProxyKind
  remark: string
  safe: boolean
  save: boolean
  tag: string
  tun: boolean
  turbo: boolean
  type: ProxyType
}

export type BatchUpdatePatch = {
  expiredTime: string | null
  safe: BatchSwitch
  save: BatchSwitch
  tun: BatchSwitch
}

export type ProxyDevice = {
  id: number
  name: string
  seqs: readonly number[]
}

export type ProxyModeTag = {
  enabled: boolean
  key: "safe" | "save" | "tun" | "turbo"
  label: string
}

export const emptyProxyQuery = (): ProxyQuery => ({
  expiredTime: "",
  favorite: false,
  id: "",
  noTag: false,
  save: "",
  search: "",
  tag: "",
  tun: "",
  turboNode: "",
  type: "",
})

const pad2 = (value: number): string => value.toString().padStart(2, "0")

export const nowText = (): string => {
  const date = new Date()
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

const formatDateTime = (date: Date, time = "00:00:00"): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${time}`

const daysFromNow = (days: number, time = "12:00:00"): string => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return formatDateTime(date, time)
}

const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

export const shortDate = (value: string | null): string => {
  if (value === null || value.length === 0) return "-"
  const date = new Date(value.replace(" ", "T"))
  if (Number.isNaN(date.getTime())) return value
  const now = new Date()
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000)
  if (diffDays === 0) return time
  if (diffDays === -1) return `昨天 ${time}`
  const monthDay = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  const hm = time.slice(0, 5)
  if (date.getFullYear() === now.getFullYear()) return `${monthDay} ${hm}`
  return `${date.getFullYear()}-${monthDay} ${hm}`
}

export const expireDate = (value: string | null): string => {
  if (value === null || value.length === 0) return "-"
  return value.slice(0, 10)
}

export const expirePresetOptions = (now = new Date()): { label: string; value: string }[] =>
  [3, 7, 30].map((days) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
    return { label: `<${days}天`, value: formatDateTime(date) }
  })

export const emptyProxy = (id: number, now: string): MytProxy => ({
  bindNumber: 0,
  createTime: now,
  expiredTime: null,
  extra: "",
  favorite: false,
  id,
  ip: "",
  password: "",
  port: "",
  proxyType: "static",
  region: "",
  remark: "",
  result: null,
  refreshUrl: "",
  safe: false,
  save: false,
  status: true,
  tag: "",
  tun: false,
  turbo: false,
  turboNode: null,
  turboNodeList: [],
  type: "2",
  updateTime: now,
  userId: null,
  username: "",
  vpc: false,
})

export const proxyTypeLabel = (type: string): string => {
  if (type === "3") return "内置"
  return PROXY_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type
}

export const extraModeLabel = (extra: string): string => {
  const lower = extra.toLowerCase()
  if (lower.includes("vmess://")) return "VMess"
  if (lower.includes("vless://")) return "VLESS"
  return "配置"
}

export const endpointText = (proxy: MytProxy): string => {
  if (proxy.type === "3") return "内置代理"
  if (proxy.type === "0" && proxy.extra.length > 0)
    return proxy.ip.length > 0 ? proxy.ip : "代理配置"
  if (proxy.ip.length === 0 && proxy.port.length === 0) return "直连"
  return `${proxy.ip}:${proxy.port}`
}

export const getModeTags = (proxy: MytProxy): readonly ProxyModeTag[] => [
  { enabled: proxy.save, key: "save", label: "节流" },
  { enabled: proxy.tun, key: "tun", label: "TUN" },
  { enabled: proxy.turbo || proxy.turboNode !== null, key: "turbo", label: "加速" },
  { enabled: proxy.safe, key: "safe", label: "安全" },
]

export const turboNodeLabel = (proxy: MytProxy): string => {
  const kind = proxy.type === "0" ? "[V2🚀]" : "[S5🧦]"
  const remark = proxy.remark.length > 0 ? `-${proxy.remark}` : ""
  return `${kind}-[${proxy.id}] ${proxy.ip}:${proxy.port}${remark}`
}

export const turboNodeProxies = (proxies: readonly MytProxy[]): MytProxy[] =>
  proxies.filter((item) => item.turbo && (item.type === "0" || item.type === "2"))

export const uniqueTagOptions = (
  proxies: readonly MytProxy[],
): { label: string; value: string }[] => {
  const counts = new Map<string, number>()
  for (const item of proxies) {
    if (item.tag.length === 0) continue
    counts.set(item.tag, (counts.get(item.tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "zh-CN"))
    .map(([tag, count]) => ({ label: `${tag} (${count})`, value: tag }))
}

export const staticProxyCount = (proxies: readonly MytProxy[]): number =>
  proxies.filter((item) => item.proxyType === "static" && item.type !== "0" && item.type !== "3")
    .length

const includesIgnoreCase = (value: string, query: string): boolean =>
  value.toLowerCase().includes(query.toLowerCase())

export const filterProxies = (proxies: readonly MytProxy[], query: ProxyQuery): MytProxy[] =>
  proxies.filter((item) => {
    if (query.id.length > 0 && String(item.id) !== query.id.trim()) return false
    if (query.tag.length > 0 && item.tag !== query.tag) return false
    if (query.type.length > 0 && item.type !== query.type) return false
    if (query.save === "true" && !item.save) return false
    if (query.save === "false" && item.save) return false
    if (query.tun === "true" && !item.tun) return false
    if (query.tun === "false" && item.tun) return false
    if (query.turboNode.length > 0 && item.turboNode !== Number(query.turboNode)) return false
    if (query.expiredTime.length > 0) {
      if (item.expiredTime === null || item.expiredTime > query.expiredTime) return false
    }
    if (query.noTag && item.tag.length > 0) return false
    if (query.favorite && !item.favorite) return false
    if (query.search.trim().length > 0) {
      const keyword = query.search.trim()
      const haystack = [item.ip, item.port, item.username, item.password, item.remark, item.tag]
      if (!haystack.some((field) => includesIgnoreCase(field, keyword))) return false
    }
    return true
  })

export const isStructuredResult = (value: unknown): value is ProxyCheckResult =>
  typeof value === "object" &&
  value !== null &&
  "ok" in value &&
  "results" in value &&
  Array.isArray((value as ProxyCheckResult).results)

export const parseCheckResult = (raw: string | null): ProxyCheckResult | null => {
  if (raw === null || raw.length === 0) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isStructuredResult(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const getPrimaryCheckResult = (result: ProxyCheckResult | null): ProxyCheckItem | null =>
  result?.results[0] ?? null

export const getResultIp = (item: ProxyCheckItem | null): string => item?.response_body?.ip ?? "-"

export const getResultCountry = (item: ProxyCheckItem | null): string =>
  item?.response_body?.country ?? "-"

export const getResultStatusLabel = (ok: boolean): string => (ok ? "成功" : "失败")

export const simulateCheckResult = (proxy: MytProxy, options: DetectOptions, now: Date): string => {
  const reachable = proxy.ip.length > 0 || (proxy.type === "0" && proxy.extra.length > 0)
  const ip = proxy.ip.length > 0 ? proxy.ip : "203.0.113.20"
  const country = proxy.region.length > 0 ? proxy.region : options.channel === "cn" ? "CN" : "US"
  const result: ProxyCheckResult = {
    channel: options.channel,
    check_time: now.getTime(),
    failures: reachable ? 0 : 1,
    include_response: options.mode === "detailed",
    message: reachable ? "成功" : "失败",
    mode: options.mode,
    ok: reachable,
    results: reachable
      ? [
          {
            delay: 86,
            ok: true,
            response_body: { country, ip },
            status: 200,
            url: options.channel === "cn" ? "myip.ipip.net" : "ipinfo.io",
          },
        ]
      : [],
    status: reachable ? 200 : 0,
    successes: reachable ? 1 : 0,
    use_turbo: options.useTurbo,
  }
  return JSON.stringify(result)
}

export const applyCheckResult = (
  proxies: readonly MytProxy[],
  ids: readonly number[],
  options: DetectOptions,
  now: string,
): { failed: number; proxies: MytProxy[]; succeeded: number } => {
  const idSet = new Set(ids)
  const stamp = new Date(now.replace(" ", "T"))
  let succeeded = 0
  let failed = 0
  const next = proxies.map((item) => {
    if (!idSet.has(item.id)) return item
    const result = simulateCheckResult(item, options, stamp)
    const parsed = parseCheckResult(result)
    if (parsed?.ok === true) succeeded += 1
    else failed += 1
    return { ...item, result, updateTime: now }
  })
  return { failed, proxies: next, succeeded }
}

const parseHostPortLine = (
  line: string,
): { ip: string; password: string; port: string; username: string } | null => {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  const parts = trimmed.includes("|") ? trimmed.split("|") : trimmed.split(":")
  if (parts.length < 2) return null
  const [ip, port, username = "", password = ""] = parts
  if (ip === undefined || port === undefined || ip.length === 0 || port.length === 0) return null
  return { ip: ip.trim(), password: password.trim(), port: port.trim(), username: username.trim() }
}

const parseV2Line = (
  line: string,
): { extra: string; ip: string; port: string; username: string } => {
  try {
    const url = new URL(line)
    return {
      extra: line,
      ip: url.hostname,
      port: url.port,
      username: decodeURIComponent(url.username),
    }
  } catch {
    return { extra: line, ip: "", port: "", username: "" }
  }
}

export const importProxies = (input: ImportProxyInput, nextId: number, now: string): MytProxy[] => {
  const lines = input.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  return lines.map((line, index) => {
    const id = nextId + index
    const tag = input.autoSeq && input.tag.length > 0 ? `${input.tag}-${index + 1}` : input.tag
    const base = {
      ...emptyProxy(id, now),
      expiredTime: input.expiredTime,
      proxyType: input.type === "0" ? "static" : input.proxyType,
      remark: input.remark,
      safe: input.safe,
      save: input.type === "0" ? false : input.save,
      tag,
      tun: input.tun,
      turbo: input.type === "2" ? input.turbo : false,
      type: input.type,
    }
    if (input.type === "0") {
      const parsed = parseV2Line(line)
      return {
        ...base,
        extra: parsed.extra,
        ip: parsed.ip,
        port: parsed.port,
        username: parsed.username,
      }
    }
    const parsed = parseHostPortLine(line)
    if (parsed === null) {
      return {
        ...base,
        ip: line,
        remark: input.remark.length > 0 ? input.remark : "无法解析的导入行",
      }
    }
    return {
      ...base,
      ip: parsed.ip,
      password: parsed.password,
      port: parsed.port,
      username: parsed.username,
    }
  })
}

export const editSelectedTag = (
  proxies: readonly MytProxy[],
  ids: readonly number[],
  tag: string,
  now: string,
): MytProxy[] => {
  const idSet = new Set(ids)
  return proxies.map((item) => (idSet.has(item.id) ? { ...item, tag, updateTime: now } : item))
}

export const editSelectedTurboNode = (
  proxies: readonly MytProxy[],
  ids: readonly number[],
  turboNode: number | null,
  now: string,
): MytProxy[] => {
  const idSet = new Set(ids)
  return proxies.map((item) =>
    idSet.has(item.id) ? { ...item, turboNode, updateTime: now } : item,
  )
}

const applySwitch = (current: boolean, value: BatchSwitch): boolean => {
  if (value === "on") return true
  if (value === "off") return false
  return current
}

export const batchUpdateByTags = (
  proxies: readonly MytProxy[],
  ids: readonly number[],
  patch: BatchUpdatePatch,
  now: string,
): MytProxy[] => {
  const idSet = new Set(ids)
  return proxies.map((item) => {
    if (!idSet.has(item.id)) return item
    return {
      ...item,
      expiredTime: patch.expiredTime === null ? item.expiredTime : patch.expiredTime,
      safe: applySwitch(item.safe, patch.safe),
      save: applySwitch(item.save, patch.save),
      tun: applySwitch(item.tun, patch.tun),
      updateTime: now,
    }
  })
}

export const toggleFavorite = (proxies: readonly MytProxy[], id: number, now: string): MytProxy[] =>
  proxies.map((item) =>
    item.id === id ? { ...item, favorite: !item.favorite, updateTime: now } : item,
  )

export const genCurlCmd = (
  proxy: Pick<MytProxy, "ip" | "password" | "port" | "type" | "username">,
): string => {
  const scheme = proxy.type === "1" ? "http" : "socks5"
  const auth =
    proxy.username.length > 0
      ? `${proxy.username}${proxy.password.length > 0 ? `:${proxy.password}` : ""}@`
      : ""
  return `curl -x ${scheme}://${auth}${proxy.ip}:${proxy.port} https://ipinfo.io`
}

export const proxiesToCsv = (proxies: readonly MytProxy[]): string => {
  const header = [
    "ID",
    "类型",
    "分组",
    "IP端口",
    "检测",
    "节流",
    "TUN",
    "加速",
    "安全",
    "绑定数量",
    "备注",
    "过期",
    "更新",
    "密码",
  ]
  const rows = proxies.map((item) => {
    const result = parseCheckResult(item.result)
    return [
      String(item.id),
      proxyTypeLabel(item.type),
      item.tag,
      endpointText(item),
      result === null ? "未检测" : getResultStatusLabel(result.ok),
      item.save ? "开启" : "关闭",
      item.tun ? "开启" : "关闭",
      item.turbo || item.turboNode !== null ? "开启" : "关闭",
      item.safe ? "开启" : "关闭",
      String(item.bindNumber),
      item.remark,
      expireDate(item.expiredTime),
      item.updateTime,
      item.password.length > 0 ? "已配置" : "无",
    ]
  })
  return [header, ...rows]
    .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
    .join("\n")
}

const seedCheckResult = (ip: string, country: string): string =>
  JSON.stringify({
    channel: "us",
    check_time: 1_726_560_000_000,
    failures: 0,
    include_response: true,
    message: "成功",
    mode: "detailed",
    ok: true,
    results: [
      {
        delay: 86,
        ok: true,
        response_body: { country, ip },
        status: 200,
        url: "ipinfo.io",
      },
    ],
    status: 200,
    successes: 1,
    use_turbo: false,
  } satisfies ProxyCheckResult)

export const createSeedProxies = (): MytProxy[] => []

export const createSeedProxyDevices = (): ProxyDevice[] => []
