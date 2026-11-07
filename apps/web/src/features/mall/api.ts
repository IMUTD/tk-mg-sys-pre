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
  quantity: z.number().int().nullable(),
  status: z.enum(["unpaid", "paid", "pending_ship", "shipped", "cancelled"]),
  title: z.string(),
  type: z.enum(["points", "resource"]),
  unitPoints: z.number().int().nullable(),
})
export type MallOrderRecord = z.infer<typeof OrderSchema>

export const ProductSchema = z.object({
  createdAt: z.string(),
  enabled: z.boolean(),
  id: z.string().uuid(),
  kind: z.enum(["account", "proxy"]),
  minQuantity: z.number().int(),
  name: z.string(),
  pricePoints: z.number().int(),
  spec: z.string(),
  stock: z.number().int(),
  updatedAt: z.string(),
})
export type MallProduct = z.infer<typeof ProductSchema>

const pageOf = <Schema extends z.ZodType>(item: Schema) =>
  z.object({ items: z.array(item), total: z.number().int() })

export const LedgerPageSchema = pageOf(LedgerEntrySchema)
export const WalletPageSchema = pageOf(WalletSchema)
export const OrderPageSchema = pageOf(OrderSchema)
export const ProductPageSchema = pageOf(ProductSchema)

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

export type PurchaseInput = {
  readonly expectedUnitPoints: number
  readonly idempotencyKey: string
  readonly productId: string
  readonly quantity: number
}

export type PurchaseResult = {
  readonly balance: number
  readonly orderNo: string
  readonly points: number
}

export interface MallApi {
  ledger(groupId: string, query: LedgerQuery): Promise<Paged<PointRecord>>
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
  invalid_recharge_request: "充值内容不正确，请检查后重试",
}

export const mallRequestError = async (error: unknown): Promise<string> => {
  if (error instanceof HTTPError) {
    const body = z
      .object({ error: z.string() })
      .safeParse(await error.response.json().catch(() => null))
    if (body.success) return errorMessages[body.data.error] ?? `请求失败：${body.data.error}`
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
      return "已发货"
    case "cancelled":
      return `已取消，积分已退回：${order.cancelReason}`
    case "paid":
    case "unpaid":
      return `${pointsText(order.points)}已到账`
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
    ledger: async (groupId, query) => {
      const page = LedgerPageSchema.parse(
        await client.get(`${groupPath(groupId)}/ledger`, { searchParams: query }).json(),
      )
      return { items: page.items.map(toPointRecord), total: page.total }
    },
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
