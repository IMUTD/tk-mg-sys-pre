export const POINT_TYPE_OPTIONS = [
  { label: "充值", value: "recharge" },
  { label: "消费", value: "spend" },
] as const

export const ORDER_TYPE_OPTIONS = [
  { label: "积分充值", value: "points" },
  { label: "资源购买", value: "resource" },
] as const

export const ORDER_STATUS_OPTIONS = [
  { label: "待支付", value: "unpaid" },
  { label: "已支付", value: "paid" },
] as const

export const INVOICE_STATUS_OPTIONS = [
  { label: "待审", value: "pending" },
  { label: "已开", value: "issued" },
  { label: "驳回", value: "rejected" },
] as const

export const INVOICE_TYPE_OPTIONS = [
  { label: "增值税普通发票", value: "normal" },
  { label: "增值税专用发票", value: "special" },
] as const

export const INVOICE_TITLE_OPTIONS = [
  { label: "企业", value: "company" },
  { label: "个人", value: "personal" },
] as const

export type PointType = (typeof POINT_TYPE_OPTIONS)[number]["value"]
export type OrderType = (typeof ORDER_TYPE_OPTIONS)[number]["value"]
export type OrderStatus = (typeof ORDER_STATUS_OPTIONS)[number]["value"]
export type InvoiceStatus = (typeof INVOICE_STATUS_OPTIONS)[number]["value"]
export type InvoiceKind = (typeof INVOICE_TYPE_OPTIONS)[number]["value"]
export type InvoiceTitleKind = (typeof INVOICE_TITLE_OPTIONS)[number]["value"]

export type PointRecord = {
  balance: number
  delta: number
  id: number
  remark: string
  taskId: string
  time: string
  type: PointType
}

export type ShopOrder = {
  createdAt: string
  deduction: number
  delivery: string
  description: string
  finalPrice: number
  id: number
  orderNo: string
  paidAt: string
  product: string
  status: OrderStatus
  title: string
  total: number
  type: OrderType
}

export type RedeemProduct = {
  id: number
  limit: number
  name: string
  points: number
  stockLabel: string
  tag: string
}

export type InvoiceRow = {
  amount: number
  file: string
  id: number
  remark: string
  status: InvoiceStatus
  title: string
  titleType: InvoiceTitleKind
  type: InvoiceKind
  updatedAt: string
}

export const money = (value: number): string => `¥${value.toLocaleString("zh-CN")}`

export const pointTypeLabel = (value: PointType): string =>
  POINT_TYPE_OPTIONS.find((item) => item.value === value)?.label ?? value

export const orderTypeLabel = (value: OrderType): string =>
  ORDER_TYPE_OPTIONS.find((item) => item.value === value)?.label ?? value

export const orderStatusLabel = (value: OrderStatus): string =>
  ORDER_STATUS_OPTIONS.find((item) => item.value === value)?.label ?? value

export const invoiceStatusLabel = (value: InvoiceStatus): string =>
  INVOICE_STATUS_OPTIONS.find((item) => item.value === value)?.label ?? value

export const createSeedPoints = (): PointRecord[] => []

export const createSeedOrders = (): ShopOrder[] => []

export const createSeedProducts = (): RedeemProduct[] => []

export const emptyInvoice = (id: number, stamp: string): InvoiceRow => ({
  amount: 0,
  file: "",
  id,
  remark: "",
  status: "pending",
  title: "",
  titleType: "company",
  type: "normal",
  updatedAt: stamp,
})

export const validateInvoice = (row: InvoiceRow): string | null => {
  if (row.title.trim().length === 0) return "请填写发票抬头"
  if (!Number.isFinite(row.amount) || row.amount <= 0) return "请填写申请余额"
  return null
}

export const pointBalance = (records: readonly PointRecord[]): number => records[0]?.balance ?? 0

export const filterPoints = (
  rows: readonly PointRecord[],
  type: string,
  keyword: string,
): PointRecord[] =>
  rows.filter((item) => {
    if (type.length > 0 && item.type !== type) return false
    if (keyword.length === 0) return true
    return item.remark.includes(keyword) || item.taskId.includes(keyword)
  })

export const filterOrders = (
  rows: readonly ShopOrder[],
  type: string,
  status: string,
  keyword: string,
): ShopOrder[] =>
  rows.filter((item) => {
    if (type.length > 0 && item.type !== type) return false
    if (status.length > 0 && item.status !== status) return false
    if (keyword.length === 0) return true
    return (
      item.orderNo.includes(keyword) ||
      item.product.includes(keyword) ||
      item.title.includes(keyword) ||
      item.description.includes(keyword)
    )
  })
