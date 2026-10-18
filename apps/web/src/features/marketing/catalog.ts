export const ACCOUNT_TYPE_OPTIONS = [
  { label: "白号", value: "white" },
  { label: "满月白", value: "month-white" },
  { label: "开窗号", value: "windowed" },
  { label: "千粉号", value: "kilo" },
] as const

export const ACCOUNT_STATUS_OPTIONS = [
  { label: "在售", value: "stock" },
  { label: "预留", value: "reserved" },
  { label: "已售", value: "sold" },
] as const

export const WINDOW_OPTIONS = [
  { label: "已开窗", value: "yes" },
  { label: "未开窗", value: "no" },
] as const

export const NODE_TYPE_OPTIONS = [
  { label: "住宅", value: "residential" },
  { label: "机房", value: "datacenter" },
  { label: "移动", value: "mobile" },
] as const

export const NODE_STATUS_OPTIONS = [
  { label: "在售", value: "stock" },
  { label: "售罄", value: "soldout" },
] as const

export const TREND_RANGE_OPTIONS = [
  { label: "日", value: "day" },
  { label: "周", value: "week" },
  { label: "月", value: "month" },
  { label: "季", value: "quarter" },
  { label: "年", value: "year" },
] as const

export type AccountType = (typeof ACCOUNT_TYPE_OPTIONS)[number]["value"]
export type AccountStatus = (typeof ACCOUNT_STATUS_OPTIONS)[number]["value"]
export type NodeType = (typeof NODE_TYPE_OPTIONS)[number]["value"]
export type TrendRange = (typeof TREND_RANGE_OPTIONS)[number]["value"]

export type MarketAccount = {
  followers: number
  id: number
  lastActive: string
  operator: string
  platform: string
  price: number
  region: string
  sku: string
  status: AccountStatus
  type: AccountType
  windowed: boolean
}

export type MarketNode = {
  bandwidth: string
  id: number
  name: string
  price: number
  region: string
  status: "stock" | "soldout"
  stock: number
  type: NodeType
}

export type SalesRow = {
  account: number
  deals: number
  id: number
  name: string
  node: number
  refund: number
  system: number
}

export type OpsRow = {
  id: number
  kiloLeft: number
  name: string
  remaining: number
  scrap: number
  sold: number
  total: number
  windowedLeft: number
}

export type TrendPoint = {
  account: number
  label: string
  node: number
  system: number
}

export const money = (value: number): string => `¥${value.toLocaleString("zh-CN")}`

export const accountTypeLabel = (value: AccountType): string =>
  ACCOUNT_TYPE_OPTIONS.find((item) => item.value === value)?.label ?? value

export const accountStatusLabel = (value: AccountStatus): string =>
  ACCOUNT_STATUS_OPTIONS.find((item) => item.value === value)?.label ?? value

export const accountStatusColor = (value: AccountStatus): string => {
  if (value === "sold") return "default"
  if (value === "reserved") return "warning"
  return "success"
}

export const nodeTypeLabel = (value: NodeType): string =>
  NODE_TYPE_OPTIONS.find((item) => item.value === value)?.label ?? value

export const createSeedAccounts = (): MarketAccount[] => []

export const createSeedNodes = (): MarketNode[] => []

export const createSeedSales = (): SalesRow[] => []

export const createSeedOps = (): OpsRow[] => []

const TRENDS: Record<TrendRange, TrendPoint[]> = {
  day: [],
  week: [],
  month: [],
  quarter: [],
  year: [],
}

export const trendSeries = (range: TrendRange): TrendPoint[] => TRENDS[range]

export const dashboardKpis = (accounts: readonly MarketAccount[], sales: readonly SalesRow[]) => {
  const remaining = (predicate: (item: MarketAccount) => boolean): number =>
    accounts.filter((item) => item.status !== "sold" && predicate(item)).length
  const accountSales = sales.reduce((sum, item) => sum + item.account, 0)
  const nodeSales = sales.reduce((sum, item) => sum + item.node, 0)
  const systemSales = sales.reduce((sum, item) => sum + item.system, 0)
  const refund = sales.reduce((sum, item) => sum + item.refund, 0)
  const deals = sales.reduce((sum, item) => sum + item.deals, 0)
  const net = accountSales + nodeSales + systemSales - refund
  return {
    accountSales,
    deals,
    kiloLeft: remaining((item) => item.type === "kilo"),
    monthWhiteLeft: remaining((item) => item.type === "month-white"),
    net,
    nodeSales,
    ticket: deals === 0 ? 0 : Math.round(net / deals),
    systemSales,
    whiteLeft: remaining((item) => item.type === "white"),
    windowedLeft: remaining((item) => item.windowed),
  }
}

export const soldRate = (row: OpsRow): number =>
  row.total === 0 ? 0 : Math.round((row.sold / row.total) * 100)

export const netSales = (row: SalesRow): number => row.account + row.node + row.system - row.refund

export type AccountQuery = {
  region: string
  status: string
  type: string
  windowed: string
}

export type NodeQuery = {
  region: string
  status: string
  type: string
}

export const emptyAccountQuery = (): AccountQuery => ({
  region: "",
  status: "",
  type: "",
  windowed: "",
})

export const emptyNodeQuery = (): NodeQuery => ({
  region: "",
  status: "",
  type: "",
})

export const uniqueValues = (values: readonly string[]): { label: string; value: string }[] =>
  [...new Set(values)].sort().map((value) => ({ label: value, value }))

export const filterAccounts = (
  accounts: readonly MarketAccount[],
  query: AccountQuery,
): MarketAccount[] =>
  accounts.filter((item) => {
    if (query.type.length > 0 && item.type !== query.type) return false
    if (query.status.length > 0 && item.status !== query.status) return false
    if (query.region.length > 0 && item.region !== query.region) return false
    if (query.windowed === "yes" && !item.windowed) return false
    if (query.windowed === "no" && item.windowed) return false
    return true
  })

export const filterNodes = (nodes: readonly MarketNode[], query: NodeQuery): MarketNode[] =>
  nodes.filter((item) => {
    if (query.type.length > 0 && item.type !== query.type) return false
    if (query.status.length > 0 && item.status !== query.status) return false
    if (query.region.length > 0 && item.region !== query.region) return false
    return true
  })

export type AccountOffer = {
  price: number
  status: AccountStatus
  windowed: boolean
}

export type NodeOffer = {
  price: number
  status: MarketNode["status"]
}

export const validatePrice = (price: number): string | null => {
  if (!Number.isFinite(price) || price < 0) return "请填写有效价格"
  return null
}

export const applyAccountOffer = (account: MarketAccount, offer: AccountOffer): MarketAccount => ({
  ...account,
  price: offer.price,
  status: offer.status,
  windowed: offer.windowed,
})

export const applyNodeOffer = (node: MarketNode, offer: NodeOffer): MarketNode => ({
  ...node,
  price: offer.price,
  status: offer.status,
})
