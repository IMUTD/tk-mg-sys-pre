import ky, { HTTPError } from "ky"
import { z } from "zod"
import { resolveApiBaseUrl } from "../../lib/api/auth-api"
import { formatTime, money, type PointRecord, pointsText, type ShopOrder } from "./catalog"

const WalletSchema = z.object({
  balance: z.number().int(),
  groupId: z.string().uuid(),
  name: z.string(),
})
export type GroupWallet = z.infer<typeof WalletSchema>

const LedgerEntrySchema = z.object({
  actorName: z.string().optional(),
  balance: z.number().int(),
  createdAt: z.string(),
  delta: z.number().int(),
  groupId: z.string().uuid(),
  groupName: z.string(),
  id: z.string().uuid(),
  orderNo: z.string(),
  remark: z.string(),
  type: z.enum(["recharge", "spend", "refund", "adjust"]),
})
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>

const OrderSchema = z.object({
  amountCents: z.number().int(),
  buyerName: z.string().optional(),
  cancelReason: z.string(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string(),
  description: z.string(),
  groupId: z.string().uuid(),
  groupName: z.string(),
  id: z.string().uuid(),
  orderNo: z.string(),
  paidAt: z.string().nullable(),
  points: z.number().int(),
  product: z.string(),
  productKind: z.enum(["account", "proxy"]).nullable(),
  inventoryGroupId: z.string().uuid().nullable().optional(),
  inventoryGroupName: z.string().nullable().optional(),
  quantity: z.number().int().nullable(),
  refundedAt: z.string().nullable(),
  shippedAt: z.string().nullable(),
  status: z.enum(["unpaid", "paid", "closed", "pending_ship", "shipped", "refunded", "cancelled"]),
  title: z.string(),
  type: z.enum(["points", "resource"]),
  unitPoints: z.number().int().nullable(),
})
export type MallOrderRecord = z.infer<typeof OrderSchema>

export const ProductSchema = z.object({
  available: z.number().int().nullable().optional(),
  createdAt: z.string(),
  enabled: z.boolean(),
  id: z.string().uuid(),
  inventoryGroupId: z.string().uuid().nullable().optional(),
  inventoryGroupName: z.string().nullable().optional(),
  kind: z.enum(["account", "proxy"]),
  minQuantity: z.number().int(),
  name: z.string(),
  pricePoints: z.number().int(),
  spec: z.string(),
  stock: z.number().int(),
  updatedAt: z.string(),
})
export type MallProduct = z.infer<typeof ProductSchema>

export const InvoiceSchema = z.object({
  amountCents: z.number().int(),
  applicantName: z.string(),
  createdAt: z.string(),
  groupId: z.string().uuid(),
  groupName: z.string(),
  hasFile: z.boolean(),
  id: z.string().uuid(),
  invoiceNumber: z.string(),
  invoiceType: z.enum(["normal", "special"]),
  rejectReason: z.string(),
  remark: z.string(),
  reviewedAt: z.string().nullable(),
  status: z.enum(["pending", "issued", "rejected"]),
  taxNumber: z.string(),
  title: z.string(),
  titleType: z.enum(["company", "personal"]),
  updatedAt: z.string(),
})
export type InvoiceRecord = z.infer<typeof InvoiceSchema>

const InvoiceQuotaSchema = z.object({
  availableCents: z.number().int(),
  invoicedCents: z.number().int(),
  paidCents: z.number().int(),
})
export type InvoiceQuota = z.infer<typeof InvoiceQuotaSchema>

const RechargeOrderSchema = z.object({
  amountCents: z.number().int(),
  orderNo: z.string(),
  points: z.number().int(),
  status: z.enum(["unpaid", "paid", "closed"]),
})
export type RechargeOrder = z.infer<typeof RechargeOrderSchema>

const pageOf = <Schema extends z.ZodType>(item: Schema) =>
  z.object({ items: z.array(item), total: z.number().int() })

export const LedgerPageSchema = pageOf(LedgerEntrySchema)
export const WalletPageSchema = pageOf(WalletSchema)
export const OrderPageSchema = pageOf(OrderSchema)
export const ProductPageSchema = pageOf(ProductSchema)
export const InvoicePageSchema = pageOf(InvoiceSchema)

export type Paged<Item> = { readonly items: readonly Item[]; readonly total: number }

export type LedgerQuery = {
  readonly keyword?: string
  readonly page: number
  readonly pageSize: number
  readonly type?: string
}

export type OrderQuery = {
  readonly keyword?: string
  readonly page: number
  readonly pageSize: number
  readonly status?: string
  readonly type?: string
}

export type InvoiceQuery = {
  readonly invoiceType?: string
  readonly keyword?: string
  readonly page: number
  readonly pageSize: number
  readonly status?: string
  readonly titleType?: string
}

export type InvoiceCreateInput = {
  readonly amountYuan: string
  readonly idempotencyKey: string
  readonly invoiceType: InvoiceRecord["invoiceType"]
  readonly remark: string
  readonly taxNumber: string
  readonly title: string
  readonly titleType: InvoiceRecord["titleType"]
}

export type PurchaseInput = {
  readonly expectedUnitPoints: number
  readonly idempotencyKey: string
  readonly productId: string
  readonly quantity: number
}

export type ShipmentItem = {
  readonly id: string
  readonly kind: "account" | "proxy"
  readonly name: string
}

export type PurchaseResult = {
  readonly balance: number
  readonly orderNo: string
  readonly points: number
}

export interface MallApi {
  createInvoice(groupId: string, input: InvoiceCreateInput): Promise<InvoiceRecord>
  createRecharge(
    groupId: string,
    input: { readonly amountYuan: string; readonly idempotencyKey: string },
  ): Promise<RechargeOrder & { readonly payUrl: string | null }>
  invoiceFileUrl(groupId: string, invoiceId: string): string
  invoiceQuota(groupId: string): Promise<InvoiceQuota>
  invoices(groupId: string, query: InvoiceQuery): Promise<Paged<InvoiceRecord>>
  paymentConfig(): Promise<{ readonly alipay: boolean }>
  rechargeStatus(groupId: string, orderNo: string): Promise<RechargeOrder>
  ledger(groupId: string, query: LedgerQuery): Promise<Paged<PointRecord>>
  orderItems(groupId: string, orderId: string): Promise<readonly ShipmentItem[]>
  orders(groupId: string, query: OrderQuery): Promise<Paged<ShopOrder>>
  products(): Promise<readonly MallProduct[]>
  purchase(groupId: string, input: PurchaseInput): Promise<PurchaseResult>
  wallets(): Promise<readonly GroupWallet[]>
}

const errorMessages: Readonly<Record<string, string>> = {
  group_not_found: "分组不存在",
  idempotency_conflict: "这次提交和上一次内容不一致，请关闭弹窗后重新填写",
  insufficient_balance: "积分余额不足",
  insufficient_stock: "库存不足，请调整数量",
  invalid_cancel_request: "请填写取消原因",
  invalid_product_request: "商品内容不正确，请检查后重试",
  invalid_purchase_request: "购买内容不正确，请检查后重试",
  invalid_quantity: "购买数量低于起售数量",
  order_not_cancellable: "这笔订单已发货或不能取消",
  order_not_found: "订单不存在",
  price_changed: "商品价格已变化，请确认新价格后再购买",
  product_not_found: "商品不存在",
  product_unavailable: "商品已下架",
  invalid_adjust_request: "调账内容不正确，请检查后重试",
  alipay_unavailable: "支付宝充值还没有开通，请联系平台人工充值",
  invalid_invoice_request: "发票内容不正确，请检查后重试",
  invalid_refund_request: "请填写退款原因",
  invalid_ship_request: "发货内容不正确，请检查后重试",
  invoice_file_not_pdf: "只能上传 PDF 文件",
  invoice_file_too_large: "发票文件不能超过 5MB",
  invoice_not_found: "发票不存在",
  invoice_not_pending: "这张发票已经处理过了",
  invoice_over_quota: "超过可开票金额",
  order_not_refundable: "只有已发货的订单才能退款",
  refund_items_moved: "这些内容发货后又被转移过，不能自动收回，可以选择不收回",
  refund_source_missing: "原来的来源分组已删除，只能选择不收回",
  ship_source_mismatch: "这个商品只能从绑定的库存分组发货",
  invalid_transfer_request: "转移内容不正确，请检查后重试",
  order_not_shippable: "这笔订单已发货或已取消",
  resource_busy: "系统正忙，这次没有转移成功，请重试",
  resource_accelerator_linked: "这些代理在加速链路里，请先到代理管理解除",
  resource_changed: "选中的内容已被转走，请刷新后重新选择",
  resource_has_bindings: "这些代理还绑定着账号，请先解绑",
  resource_in_use: "这些内容正在使用（任务、未开始的派发、租用或占用），请等结束后再试",
  resource_not_found: "选中的内容不存在，请刷新后重新选择",
  resource_not_ready: "这些内容状态异常或已过期，不能发给买家",
  ship_quantity_mismatch: "发货数量和订单数量不一致",
  transfer_conflict: "目标分组已有相同账号（包括回收站）",
  transfer_same_group: "来源分组和目标分组不能相同",
  invalid_recharge_request: "充值内容不正确，请检查后重试",
}

const MAX_NAMED_ITEMS = 5

const namedItems = (items: readonly string[]): string => {
  if (items.length === 0) return ""
  const shown = items.slice(0, MAX_NAMED_ITEMS).join("、")
  return items.length > MAX_NAMED_ITEMS ? `：${shown} 等 ${items.length} 个` : `：${shown}`
}

export const mallRequestError = async (error: unknown): Promise<string> => {
  if (error instanceof HTTPError) {
    const body = z
      .object({ error: z.string(), items: z.array(z.string()).optional() })
      .safeParse(await error.response.json().catch(() => null))
    if (body.success) {
      const text = errorMessages[body.data.error] ?? `请求失败：${body.data.error}`
      return `${text}${namedItems(body.data.items ?? [])}`
    }
    // nginx 挡下的请求返回 HTML，读不出错误码。
    if (error.response.status === 413) return "上传的文件太大"
  }
  return error instanceof Error ? error.message : "请求失败"
}

const toPointRecord = (entry: LedgerEntry): PointRecord => ({
  balance: entry.balance,
  delta: entry.delta,
  id: entry.id,
  remark: entry.remark,
  taskId: "",
  time: formatTime(entry.createdAt),
  type: entry.type,
})

const deliveryText = (order: MallOrderRecord): string => {
  switch (order.status) {
    case "pending_ship":
      return "等待商家发货"
    case "shipped":
      return `已发货${order.quantity === null ? "" : ` ${order.quantity} 个`}`
    case "cancelled":
      return `已取消，积分已退回：${order.cancelReason}`
    case "refunded":
      return `已退款，积分已退回：${order.cancelReason}`
    case "closed":
      return "未付款，订单已关闭"
    case "paid":
      return `${pointsText(order.points)}已到账`
    case "unpaid":
      return "等待付款"
  }
}

const toShopOrder = (order: MallOrderRecord): ShopOrder => {
  const isResource = order.type === "resource"
  const amount = money(order.amountCents / 100)
  return {
    createdAt: formatTime(order.createdAt),
    deduction: isResource ? pointsText(order.points) : money(0),
    delivery: deliveryText(order),
    description: order.description,
    finalPrice: amount,
    id: order.id,
    orderNo: order.orderNo,
    paidAt: formatTime(order.paidAt),
    product: order.quantity === null ? order.product : `${order.product} × ${order.quantity}`,
    status: order.status,
    title: order.title,
    total: isResource ? pointsText(order.points) : amount,
    type: order.type,
  }
}

export const createApiClient = (apiBaseUrl: string) =>
  ky.create({
    credentials: "include",
    prefixUrl: resolveApiBaseUrl(apiBaseUrl, window.location.href),
    retry: 0,
    timeout: 40000,
  })

const groupPath = (groupId: string): string => `groups/${encodeURIComponent(groupId)}/mall`

export const createMallApi = (apiBaseUrl = "/api"): MallApi => {
  const client = createApiClient(apiBaseUrl)
  return {
    createInvoice: async (groupId, input) =>
      InvoiceSchema.parse(
        await client.post(`${groupPath(groupId)}/invoices`, { json: input }).json(),
      ),
    createRecharge: async (groupId, input) =>
      RechargeOrderSchema.extend({ payUrl: z.string().nullable() }).parse(
        await client.post(`${groupPath(groupId)}/recharges`, { json: input }).json(),
      ),
    invoiceFileUrl: (groupId, invoiceId) =>
      `${apiBaseUrl}/${groupPath(groupId)}/invoices/${encodeURIComponent(invoiceId)}/file`,
    invoiceQuota: async (groupId) =>
      InvoiceQuotaSchema.parse(await client.get(`${groupPath(groupId)}/invoice-quota`).json()),
    invoices: async (groupId, query) =>
      InvoicePageSchema.parse(
        await client.get(`${groupPath(groupId)}/invoices`, { searchParams: query }).json(),
      ),
    paymentConfig: async () =>
      z.object({ alipay: z.boolean() }).parse(await client.get("mall/payment-config").json()),
    rechargeStatus: async (groupId, orderNo) =>
      RechargeOrderSchema.parse(
        await client.get(`${groupPath(groupId)}/recharges/${encodeURIComponent(orderNo)}`).json(),
      ),
    ledger: async (groupId, query) => {
      const page = LedgerPageSchema.parse(
        await client.get(`${groupPath(groupId)}/ledger`, { searchParams: query }).json(),
      )
      return { items: page.items.map(toPointRecord), total: page.total }
    },
    orderItems: async (groupId, orderId) =>
      z
        .object({
          items: z.array(
            z.object({
              id: z.string().uuid(),
              kind: z.enum(["account", "proxy"]),
              name: z.string(),
            }),
          ),
        })
        .parse(
          await client
            .get(`${groupPath(groupId)}/orders/${encodeURIComponent(orderId)}/items`)
            .json(),
        ).items,
    orders: async (groupId, query) => {
      const page = OrderPageSchema.parse(
        await client.get(`${groupPath(groupId)}/orders`, { searchParams: query }).json(),
      )
      return { items: page.items.map(toShopOrder), total: page.total }
    },
    products: async () => {
      const items: MallProduct[] = []
      for (let page = 1; ; page++) {
        const result = ProductPageSchema.parse(
          await client.get("mall/products", { searchParams: { page, pageSize: 100 } }).json(),
        )
        items.push(...result.items)
        if (items.length >= result.total || result.items.length === 0) return items
      }
    },
    purchase: async (groupId, input) =>
      z
        .object({
          balance: z.number().int(),
          orderNo: z.string(),
          points: z.number().int(),
        })
        .parse(await client.post(`${groupPath(groupId)}/orders`, { json: input }).json()),
    wallets: async () =>
      z.object({ items: z.array(WalletSchema) }).parse(await client.get("mall/wallets").json())
        .items,
  }
}
