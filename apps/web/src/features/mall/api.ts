import ky, { HTTPError } from "ky"
import { z } from "zod"
import { resolveApiBaseUrl } from "../../lib/api/auth-api"
import { formatTime, type PointRecord, type ShopOrder } from "./catalog"

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
  createdAt: z.string(),
  description: z.string(),
  id: z.string().uuid(),
  orderNo: z.string(),
  paidAt: z.string().nullable(),
  points: z.number().int(),
  product: z.string(),
  status: z.enum(["unpaid", "paid"]),
  title: z.string(),
  type: z.enum(["points", "resource"]),
})

const pageOf = <Schema extends z.ZodType>(item: Schema) =>
  z.object({ items: z.array(item), total: z.number().int() })

export const LedgerPageSchema = pageOf(LedgerEntrySchema)
export const WalletPageSchema = pageOf(WalletSchema)
const OrderPageSchema = pageOf(OrderSchema)

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

export interface MallApi {
  ledger(groupId: string, query: LedgerQuery): Promise<Paged<PointRecord>>
  orders(groupId: string, query: OrderQuery): Promise<Paged<ShopOrder>>
  wallets(): Promise<readonly GroupWallet[]>
}

const errorMessages: Readonly<Record<string, string>> = {
  group_not_found: "分组不存在",
  idempotency_conflict: "这次提交和上一次内容不一致，请关闭弹窗后重新填写",
  insufficient_balance: "积分余额不足，调账后余额不能为负",
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

const toShopOrder = (order: z.infer<typeof OrderSchema>): ShopOrder => ({
  createdAt: formatTime(order.createdAt),
  deduction: 0,
  delivery: `${order.points.toLocaleString("zh-CN")} 积分已到账`,
  description: order.description,
  finalPrice: order.amountCents / 100,
  id: order.id,
  orderNo: order.orderNo,
  paidAt: formatTime(order.paidAt),
  product: order.product,
  status: order.status,
  title: order.title,
  total: order.amountCents / 100,
  type: order.type,
})

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
    wallets: async () =>
      z.object({ items: z.array(WalletSchema) }).parse(await client.get("mall/wallets").json())
        .items,
  }
}
