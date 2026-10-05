export const FIELD_TYPE_OPTIONS = [
  { label: "忽略此列", value: "ignore" },
  { label: "账号", value: "account" },
  { label: "密码", value: "password" },
  { label: "手机号", value: "phone" },
  { label: "API接码", value: "api" },
  { label: "2FA", value: "twoFA" },
  { label: "邮箱", value: "email" },
  { label: "邮箱密码", value: "emailPassword" },
  { label: "客户端ID", value: "msClientId" },
  { label: "令牌TOKEN", value: "msToken" },
  { label: "辅助邮箱", value: "assistEmail" },
  { label: "代理ID", value: "proxyId" },
  { label: "pop3用户名", value: "pop3Username" },
  { label: "pop3密码", value: "pop3Password" },
  { label: "pop3服务器", value: "pop3Server" },
] as const

export type FieldType = (typeof FIELD_TYPE_OPTIONS)[number]["value"]

export type ResourceStatus = "0" | "1"
export type ResourceResult = "0" | "1"

export type TkRegResource = {
  assignTime: string | null
  createTime: string
  data: Record<string, string>
  email: string
  id: number
  recycle: ResourceStatus
  remark: string
  result: ResourceResult
  status: ResourceStatus
  tag: string
}

export type ResourceQuery = {
  email: string
  remark: string
  result: ResourceResult | ""
  status: ResourceStatus | ""
  tag: string
}

export type FieldMapping = {
  confidence: number
  detectedType: FieldType
  type: FieldType
}

export type ParsedDataField = {
  key: string
  value: string
}

export type ParsedDataSummaryItem = {
  key: string
  label: string
  valueText: string
}

export type TagStatistic = {
  availableCount: number
  tag: string
  totalCount: number
  usedCount: number
}

export type AvailableTagCount = {
  count: number
  tag: string
}

export const SMART_IMPORT_PLACEHOLDER = `请粘贴您的数据，使用'----'分割字段，每行一条记录
API接码: 去掉+1,用4个-分开接码地址
样本: 31123456----https://sms11.com/token=weqe4122132frekrar
Google邮箱: 邮箱----密码----[辅助邮箱]
样本: xxx12143@gmail.com----kljo23123----kljoiu@outlook.com
登录账号: 登录账号----登录密码----[代理id]
         登录账号----登录密码----2FA----[代理id]
微软OAuth: 邮箱----密码----客户端ID----令牌TOKEN----[代理id]
微软OAuth样本: enkr5672856@outlook.com----GRRYnwyo5144----dbc8e03a-b00c-46bd-ae65-b683e7707cb0----M.C535_BAY.0.U.-Cnt4FKvKsM1!77r8...
POP3邮箱: 邮箱----POP3服务器----POP3用户名----POP3密码----[代理id]
脆球样本: email1001@tkyds.com----domain-pop.cuiqiu.com----email1001@tkyds.com----DS4646781
[代理ID]留空则使用选中主代理`

export const emptyResourceQuery = (): ResourceQuery => ({
  email: "",
  remark: "",
  result: "",
  status: "",
  tag: "",
})

const pad2 = (value: number): string => value.toString().padStart(2, "0")

export const nowText = (): string => {
  const date = new Date()
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
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

export const getFieldLabel = (type: string): string =>
  FIELD_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type

export const statusLabel = (status: ResourceStatus): string =>
  status === "0" ? "未使用" : "已使用"

export const resultLabel = (result: ResourceResult): string => (result === "0" ? "未知" : "成功")

export const formatParsedDataValue = (value: string): string => value

export const truncateParsedDataValue = (value: string, limit = 24): string =>
  value.length > limit ? `${value.slice(0, limit)}...` : value

export const parseDataKeysWithValues = (
  data: Record<string, string>,
): readonly ParsedDataSummaryItem[] =>
  Object.keys(data).map((key) => ({
    key,
    label: getFieldLabel(key),
    valueText: formatParsedDataValue(data[key] ?? ""),
  }))

export const getParsedDataSummary = (
  data: Record<string, string>,
): readonly ParsedDataSummaryItem[] => parseDataKeysWithValues(data).slice(0, 3)

export const parseDataFieldList = (data: Record<string, string>): ParsedDataField[] =>
  Object.keys(data).map((key) => ({ key, value: data[key] ?? "" }))

export const buildParsedData = (
  fields: readonly ParsedDataField[],
): Record<string, string> | string => {
  const data: Record<string, string> = {}
  const seen = new Set<string>()
  for (const field of fields) {
    const key = field.key.trim()
    if (key.length === 0) continue
    if (seen.has(key)) return key
    seen.add(key)
    data[key] = field.value
  }
  return data
}

const isEmailValue = (value: string): boolean => /@/.test(value) && value.includes(".")

const sampleValues = (rows: readonly (readonly string[])[], column: number): readonly string[] =>
  rows
    .slice(0, Math.min(5, rows.length))
    .map((row) => row[column] ?? "")
    .filter((value) => value.trim().length > 0)

const isFirstColumnEmail = (rows: readonly (readonly string[])[]): boolean => {
  const values = sampleValues(rows, 0)
  return values.length > 0 && values.some((value) => isEmailValue(value))
}

export const detectFieldTypeInitial = (
  rows: readonly (readonly string[])[],
  column: number,
): FieldType => {
  if (rows.length === 0) return "ignore"
  const values = sampleValues(rows, column)
  if (values.length === 0) return "ignore"
  if (column === 1 && isFirstColumnEmail(rows)) return "emailPassword"
  const emailColumns: number[] = []
  const width = rows[0]?.length ?? 0
  for (let index = 0; index < width; index += 1) {
    const columnValues = rows
      .slice(0, Math.min(3, rows.length))
      .map((row) => row[index] ?? "")
      .filter((value) => value.trim().length > 0)
    if (columnValues.some((value) => isEmailValue(value))) emailColumns.push(index)
  }
  for (const value of values) {
    if (value.startsWith("http")) return "api"
    if (isEmailValue(value)) return emailColumns.indexOf(column) === 0 ? "email" : "assistEmail"
    if (/^[A-Za-z0-9]{32}$/.test(value)) return "twoFA"
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return "msClientId"
    }
    if (/^\d{10,15}$/.test(value)) return "phone"
    if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value) && value.includes(".") && !/@/.test(value)) {
      return "pop3Server"
    }
    if (/^\d{1,6}$/.test(value)) return "proxyId"
    if (/^\+?\d{10,15}$/.test(value.replace(/[\s-()]/g, ""))) return "account"
    if (value.includes("token=") || value.length > 50) return "msToken"
  }
  return column === 0 ? "account" : "password"
}

export const detectFieldType = (
  rows: readonly (readonly string[])[],
  mappings: readonly FieldMapping[],
  column: number,
): FieldType => {
  if (rows.length === 0) return "ignore"
  const values = sampleValues(rows, column)
  if (values.length === 0) return "ignore"
  if (column === 1 && isFirstColumnEmail(rows)) return "emailPassword"
  const hasEmail = mappings.some((mapping, index) => index !== column && mapping.type === "email")
  for (const value of values) {
    if (value.startsWith("http")) return "api"
    if (isEmailValue(value)) return hasEmail ? "assistEmail" : "email"
    if (/^[A-Za-z0-9]{32}$/.test(value)) return "twoFA"
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return "msClientId"
    }
    if (/^\d{10,15}$/.test(value)) return "phone"
    if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value) && value.includes(".") && !/@/.test(value)) {
      return "pop3Server"
    }
    if (/^\d{1,6}$/.test(value)) return "proxyId"
    if (/^\+?\d{10,15}$/.test(value.replace(/[\s-()]/g, ""))) return "account"
    if (value.includes("token=") || value.length > 50) return "msToken"
  }
  if (column === 0) return "account"
  if (column === 1) return "password"
  if (column === 2) {
    const first = values[0]
    return first !== undefined && isEmailValue(first) && hasEmail ? "assistEmail" : "email"
  }
  if (column === 3) return "pop3Server"
  if (column === 4) return "pop3Username"
  if (column === 5) return "pop3Password"
  return "password"
}

export const calculateConfidence = (
  rows: readonly (readonly string[])[],
  mappings: readonly FieldMapping[],
  column: number,
): number => {
  const detected = detectFieldType(rows, mappings, column)
  if (detected === "ignore") return 0.1
  const values = rows
    .slice(0, Math.min(3, rows.length))
    .map((row) => row[column] ?? "")
    .filter((value) => value.trim().length > 0)
  if (values.length === 0) return 0.1
  let confidence = 0.5
  for (const value of values) {
    if (value.startsWith("http") && detected === "api") confidence += 0.4
    if (isEmailValue(value) && (detected === "email" || detected === "assistEmail")) {
      confidence += 0.4
    }
    if (/^[A-Za-z0-9]{32}$/.test(value)) confidence += 0.4
    if (/^\d{10,15}$/.test(value) && detected === "phone") confidence += 0.4
    if (/^\d{1,6}$/.test(value) && detected === "proxyId") confidence += 0.3
    if (
      /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value) &&
      !/@/.test(value) &&
      detected === "pop3Server"
    ) {
      confidence += 0.4
    }
    if ((value.startsWith("http") && detected !== "api") || value.includes("token=")) {
      confidence += 0.3
    }
    if (/^[0-9a-f-]{36}$/i.test(value)) confidence += 0.4
    if (/^\+?\d{10,15}$/.test(value.replace(/[\s-()]/g, "")) && detected === "account") {
      confidence += 0.2
    }
    if (column === 1 && detected === "emailPassword" && isFirstColumnEmail(rows)) {
      confidence += 0.3
    }
  }
  return Math.min(confidence, 1)
}

export const parseSmartData = (rawData: string): { mappings: FieldMapping[]; rows: string[][] } => {
  const rows = rawData
    .trim()
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split("----").map((cell) => cell.trim()))
  if (rows.length === 0) return { mappings: [], rows }
  const width = rows[0]?.length ?? 0
  const detected = Array.from({ length: width }, (_value, index) =>
    detectFieldTypeInitial(rows, index),
  )
  const used = new Set<FieldType>()
  const mappings: FieldMapping[] = detected.map((type) => {
    let next = type
    if (used.has(next)) next = "ignore"
    else if (next !== "ignore") used.add(next)
    return {
      confidence: 0,
      detectedType: type,
      type: next,
    }
  })
  return {
    mappings: mappings.map((mapping, index) => ({
      ...mapping,
      confidence: calculateConfidence(rows, mappings, index),
    })),
    rows,
  }
}

export const getAvailableFieldOptions = (
  mappings: readonly FieldMapping[],
  column: number,
): readonly (typeof FIELD_TYPE_OPTIONS)[number][] => {
  const used = mappings
    .map((mapping, index) => ({ index, type: mapping.type }))
    .filter((item) => item.index !== column && item.type !== "ignore")
    .map((item) => item.type)
  return FIELD_TYPE_OPTIONS.filter(
    (option) => option.value === "ignore" || !used.includes(option.value),
  )
}

export const applyFieldTypeChange = (
  mappings: readonly FieldMapping[],
  column: number,
  type: FieldType,
): FieldMapping[] =>
  mappings.map((mapping, index) => {
    if (index === column) return { ...mapping, type }
    if (type !== "ignore" && mapping.type === type) return { ...mapping, type: "ignore" }
    return mapping
  })

export const getColumnExample = (rows: readonly (readonly string[])[], column: number): string =>
  rows
    .slice(0, 3)
    .map((row) => row[column] ?? "")
    .filter((value) => value.trim().length > 0)
    .join(", ")

type ParsedResourceData = Record<string, string> & {
  readonly account?: string
  readonly email?: string
  readonly phone?: string
}

const displayEmail = (data: ParsedResourceData, row: readonly string[]): string =>
  data.email ?? data.account ?? data.phone ?? row[0] ?? ""

export const importedResourcesFromParse = (
  rows: readonly (readonly string[])[],
  mappings: readonly FieldMapping[],
  tag: string,
  startId: number,
  createTime: string,
): TkRegResource[] =>
  rows.map((row, index) => {
    const data: Record<string, string> = {}
    mappings.forEach((mapping, column) => {
      if (mapping.type === "ignore") return
      data[mapping.type] = row[column] ?? ""
    })
    return {
      assignTime: null,
      createTime,
      data,
      email: displayEmail(data, row),
      id: startId + index,
      recycle: "0",
      remark: "",
      result: "0",
      status: "0",
      tag,
    }
  })

export const resourceTagKey = (resource: TkRegResource): string =>
  resource.tag.length === 0 ? "未分组" : resource.tag

export const filterResources = (
  resources: readonly TkRegResource[],
  query: ResourceQuery,
): TkRegResource[] =>
  resources.filter((resource) => {
    if (
      query.email.length > 0 &&
      !resource.email.toLowerCase().includes(query.email.toLowerCase())
    ) {
      return false
    }
    if (
      query.remark.length > 0 &&
      !resource.remark.toLowerCase().includes(query.remark.toLowerCase())
    ) {
      return false
    }
    if (query.tag.length > 0 && resource.tag !== query.tag) return false
    if (query.status.length > 0 && resource.status !== query.status) return false
    if (query.result.length > 0 && resource.result !== query.result) return false
    return true
  })

export const resourceStatistics = (resources: readonly TkRegResource[]): TagStatistic[] => {
  const grouped = new Map<string, TagStatistic>()
  for (const resource of resources) {
    const tag = resourceTagKey(resource)
    const current = grouped.get(tag) ?? {
      availableCount: 0,
      tag,
      totalCount: 0,
      usedCount: 0,
    }
    current.totalCount += 1
    if (resource.status === "1") current.usedCount += 1
    else current.availableCount += 1
    grouped.set(tag, current)
  }
  return [...grouped.values()]
}

export const availableTagCounts = (resources: readonly TkRegResource[]): AvailableTagCount[] =>
  resourceStatistics(resources)
    .filter((item) => item.availableCount > 0)
    .map((item) => ({ count: item.availableCount, tag: item.tag === "未分组" ? "" : item.tag }))
    .filter((item) => item.tag.length > 0)

export const resourcesToCsv = (resources: readonly TkRegResource[]): string => {
  const header = "id,email,data,tag,status,result,recycle,remark,createTime,assignTime"
  const rows = resources.map((resource) =>
    [
      resource.id,
      resource.email,
      JSON.stringify(resource.data),
      resource.tag,
      resource.status,
      resource.result,
      resource.recycle,
      resource.remark,
      resource.createTime,
      resource.assignTime ?? "",
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(","),
  )
  return [header, ...rows].join("\n")
}

export const confidenceTagColor = (confidence: number): "success" | "warning" | "error" => {
  if (confidence > 0.7) return "success"
  if (confidence > 0.4) return "warning"
  return "error"
}

export const createSeedResources = (): TkRegResource[] => []
