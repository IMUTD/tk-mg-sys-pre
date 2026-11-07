import { z } from "zod"

/** 1 元 = 100 积分，所以 1 分钱正好对应 1 积分。 */
export const POINTS_PER_YUAN = 100

export const MAX_ADJUST_POINTS = 10_000_000_000

export const PointTypeSchema = z.enum(["recharge", "spend", "refund", "adjust"])
export type PointType = z.infer<typeof PointTypeSchema>

export const OrderTypeSchema = z.enum(["points", "resource"])
export const OrderStatusSchema = z.enum(["unpaid", "paid", "pending_ship", "shipped", "cancelled"])
export const ProductKindSchema = z.enum(["account", "proxy"])
export type ProductKind = z.infer<typeof ProductKindSchema>

export const MAX_PRICE_POINTS = 10_000_000_000
export const MAX_STOCK_CHANGE = 10_000_000
export const MAX_QUANTITY = 100_000

const RemarkSchema = z.string().trim().min(1).max(500)
const IdempotencyKeySchema = z.string().trim().min(8).max(64)
const PageFields = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}

/** 金额用字符串传递并按十进制解析，避免浮点误差进入账本。 */
export const yuanToCents = (value: string): number => {
  const [whole = "0", fraction = ""] = value.split(".")
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
}

export const RechargeInputSchema = z.object({
  amountYuan: z
    .string()
    .trim()
    .regex(/^\d{1,8}(\.\d{1,2})?$/)
    .refine((value) => yuanToCents(value) > 0),
  groupId: z.string().uuid(),
  idempotencyKey: IdempotencyKeySchema,
  remark: RemarkSchema,
})
export type RechargeInput = z.infer<typeof RechargeInputSchema>

export const AdjustInputSchema = z.object({
  delta: z
    .number()
    .int()
    .min(-MAX_ADJUST_POINTS)
    .max(MAX_ADJUST_POINTS)
    .refine((value) => value !== 0),
  groupId: z.string().uuid(),
  idempotencyKey: IdempotencyKeySchema,
  remark: RemarkSchema,
})
export type AdjustInput = z.infer<typeof AdjustInputSchema>

export const LedgerQuerySchema = z.object({
  ...PageFields,
  keyword: z.string().trim().max(200).optional(),
  type: PointTypeSchema.optional(),
})

export const MerchantLedgerQuerySchema = LedgerQuerySchema.extend({
  groupId: z.string().uuid().optional(),
})

export const OrderQuerySchema = z.object({
  ...PageFields,
  keyword: z.string().trim().max(200).optional(),
  status: OrderStatusSchema.optional(),
  type: OrderTypeSchema.optional(),
})

export const MerchantOrderQuerySchema = OrderQuerySchema.extend({
  groupId: z.string().uuid().optional(),
})

export const ProductQuerySchema = z.object({
  ...PageFields,
  keyword: z.string().trim().max(200).optional(),
  kind: ProductKindSchema.optional(),
})

const ProductNameSchema = z.string().trim().min(1).max(160)
const ProductSpecSchema = z.string().trim().max(200)
const PricePointsSchema = z.number().int().positive().max(MAX_PRICE_POINTS)
const MinQuantitySchema = z.number().int().min(1).max(MAX_QUANTITY)

export const ProductCreateSchema = z.object({
  enabled: z.boolean().default(true),
  kind: ProductKindSchema,
  minQuantity: MinQuantitySchema.default(1),
  name: ProductNameSchema,
  pricePoints: PricePointsSchema,
  spec: ProductSpecSchema.default(""),
  stock: z.number().int().min(0).max(MAX_STOCK_CHANGE).default(0),
})
export type ProductCreateInput = z.infer<typeof ProductCreateSchema>

/** 库存只接受增减量，避免覆盖编辑期间发生的购买。 */
export const ProductUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    minQuantity: MinQuantitySchema.optional(),
    name: ProductNameSchema.optional(),
    pricePoints: PricePointsSchema.optional(),
    spec: ProductSpecSchema.optional(),
    stockDelta: z.number().int().min(-MAX_STOCK_CHANGE).max(MAX_STOCK_CHANGE).optional(),
  })
  .refine((value) => Object.keys(value).length > 0)
export type ProductUpdateInput = z.infer<typeof ProductUpdateSchema>

export const PurchaseInputSchema = z.object({
  expectedUnitPoints: PricePointsSchema,
  idempotencyKey: IdempotencyKeySchema,
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
})
export type PurchaseInput = z.infer<typeof PurchaseInputSchema>

export const CancelOrderInputSchema = z.object({ reason: RemarkSchema })

export const WalletQuerySchema = z.object({
  ...PageFields,
  keyword: z.string().trim().max(200).optional(),
})

export type GroupWallet = {
  readonly balance: number
  readonly groupId: string
  readonly name: string
}

export type LedgerEntry = {
  readonly actorName: string
  readonly balance: number
  readonly createdAt: string
  readonly delta: number
  readonly groupId: string
  readonly groupName: string
  readonly id: string
  readonly orderNo: string
  readonly remark: string
  readonly type: PointType
}

export type MallOrder = {
  readonly amountCents: number
  readonly buyerName: string
  readonly cancelReason: string
  readonly cancelledAt: string | null
  readonly createdAt: string
  readonly description: string
  readonly groupId: string
  readonly groupName: string
  readonly id: string
  readonly orderNo: string
  readonly paidAt: string | null
  readonly points: number
  readonly product: string
  readonly productKind: ProductKind | null
  readonly quantity: number | null
  readonly status: "paid" | "pending_ship" | "shipped" | "cancelled"
  readonly title: string
  readonly type: "points" | "resource"
  readonly unitPoints: number | null
}

export type MallProduct = {
  readonly createdAt: string
  readonly enabled: boolean
  readonly id: string
  readonly kind: ProductKind
  readonly minQuantity: number
  readonly name: string
  readonly pricePoints: number
  readonly spec: string
  readonly stock: number
  readonly updatedAt: string
}

export type Page<Item> = { readonly items: readonly Item[]; readonly total: number }

export type LedgerFilter = {
  readonly groupId?: string | undefined
  readonly keyword?: string | undefined
  readonly page: number
  readonly pageSize: number
  readonly type?: PointType | undefined
}

export type OrderFilter = {
  readonly groupId?: string | undefined
  readonly keyword?: string | undefined
  readonly page: number
  readonly pageSize: number
  readonly status?: z.infer<typeof OrderStatusSchema> | undefined
  readonly type?: z.infer<typeof OrderTypeSchema> | undefined
}

export type ProductFilter = {
  readonly enabledOnly: boolean
  readonly keyword?: string | undefined
  readonly kind?: ProductKind | undefined
  readonly page: number
  readonly pageSize: number
}

export type WalletFilter = {
  readonly keyword?: string | undefined
  readonly page: number
  readonly pageSize: number
}

export type RechargeResult = {
  readonly balance: number
  readonly orderNo: string
  readonly points: number
  readonly replayed: boolean
}

export type AdjustResult = {
  readonly balance: number
  readonly delta: number
  readonly replayed: boolean
}

export type PurchaseResult = {
  readonly balance: number
  readonly orderId: string
  readonly orderNo: string
  readonly points: number
  readonly replayed: boolean
}

export type CancelOrderResult = {
  readonly balance: number
  readonly groupId: string
  readonly orderNo: string
  readonly points: number
  readonly replayed: boolean
}

export type MallErrorCode =
  | "group_not_found"
  | "idempotency_conflict"
  | "insufficient_balance"
  | "insufficient_stock"
  | "invalid_quantity"
  | "order_not_cancellable"
  | "order_not_found"
  | "price_changed"
  | "product_not_found"
  | "product_unavailable"

export class MallError extends Error {
  public constructor(public readonly code: MallErrorCode) {
    super(code)
    this.name = "MallError"
  }
}
