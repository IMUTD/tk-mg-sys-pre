export const POINT_TYPE_OPTIONS = [
  { label: "充值", value: "recharge" },
  { label: "消费", value: "spend" },
  { label: "退款", value: "refund" },
  { label: "调账", value: "adjust" },
] as const

export const ORDER_TYPE_OPTIONS = [
  { label: "积分充值", value: "points" },
  { label: "资源购买", value: "resource" },
] as const

export const ORDER_STATUS_OPTIONS = [
  { label: "待支付", value: "unpaid" },
  { label: "已支付", value: "paid" },
  { label: "待发货", value: "pending_ship" },
  { label: "已发货", value: "shipped" },
  { label: "已退款", value: "refunded" },
  { label: "已关闭", value: "closed" },
  { label: "已取消", value: "cancelled" },
] as const

export const PRODUCT_KIND_OPTIONS = [
  { label: "账号", value: "account" },
  { label: "代理", value: "proxy" },
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
export type ProductKind = (typeof PRODUCT_KIND_OPTIONS)[number]["value"]
export type InvoiceStatus = (typeof INVOICE_STATUS_OPTIONS)[number]["value"]
export type InvoiceKind = (typeof INVOICE_TYPE_OPTIONS)[number]["value"]
export type InvoiceTitleKind = (typeof INVOICE_TITLE_OPTIONS)[number]["value"]

export type PointRecord = {
  balance: number
  delta: number
  id: string
  remark: string
  taskId: string
  time: string
  type: PointType
}

export type ShopOrder = {
  createdAt: string
  deduction: string
  delivery: string
  description: string
  finalPrice: string
  id: string
  orderNo: string
  paidAt: string
  product: string
  status: OrderStatus
  title: string
  total: string
  type: OrderType
}

export const money = (value: number): string => `¥${value.toLocaleString("zh-CN")}`

export const pointTypeLabel = (value: PointType): string =>
  POINT_TYPE_OPTIONS.find((item) => item.value === value)?.label ?? value

export const orderTypeLabel = (value: OrderType): string =>
  ORDER_TYPE_OPTIONS.find((item) => item.value === value)?.label ?? value

export const orderStatusLabel = (value: OrderStatus): string =>
  ORDER_STATUS_OPTIONS.find((item) => item.value === value)?.label ?? value

export const orderStatusColor = (value: OrderStatus): string => {
  switch (value) {
    case "paid":
    case "shipped":
      return "success"
    case "unpaid":
    case "pending_ship":
      return "warning"
    case "cancelled":
    case "closed":
    case "refunded":
      return "default"
  }
}

export const productKindLabel = (value: ProductKind): string =>
  PRODUCT_KIND_OPTIONS.find((item) => item.value === value)?.label ?? value

export const pointsText = (value: number): string => `${value.toLocaleString("zh-CN")} 积分`

export const invoiceStatusColor = (value: InvoiceStatus): string => {
  switch (value) {
    case "issued":
      return "success"
    case "pending":
      return "warning"
    case "rejected":
      return "default"
  }
}

export const invoiceTypeLabel = (value: InvoiceKind): string =>
  INVOICE_TYPE_OPTIONS.find((item) => item.value === value)?.label ?? value

export const invoiceStatusLabel = (value: InvoiceStatus): string =>
  INVOICE_STATUS_OPTIONS.find((item) => item.value === value)?.label ?? value

const pad = (value: number): string => String(value).padStart(2, "0")

export const formatTime = (value: string | null): string => {
  if (value === null) return ""
  const date = new Date(value)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}
