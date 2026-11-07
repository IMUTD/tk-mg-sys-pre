import { z } from "zod"

/** 1 元 = 100 积分，所以 1 分钱正好对应 1 积分。 */
export const POINTS_PER_YUAN = 100

export const MAX_ADJUST_POINTS = 10_000_000_000

export const PointTypeSchema = z.enum(["recharge", "spend", "refund", "adjust"])
export type PointType = z.infer<typeof PointTypeSchema>

export const OrderTypeSchema = z.enum(["points", "resource"])
export const OrderStatusSchema = z.enum([
  "unpaid",
  "paid",
  "closed",
  "pending_ship",
  "shipped",
  "refunded",
  "cancelled",
])
export const ProductKindSchema = z.enum(["account", "proxy"])
export type ProductKind = z.infer<typeof ProductKindSchema>

export const MAX_PRICE_POINTS = 10_000_000_000
export const MAX_STOCK_CHANGE = 10_000_000
/** 发货要逐个选账号或代理，所以单笔数量不能超过一次过户的上限。 */
export const MAX_QUANTITY = 1000
export const MAX_TRANSFER_ITEMS = MAX_QUANTITY

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
const InventoryGroupSchema = z.string().uuid().nullable()
const PricePointsSchema = z.number().int().positive().max(MAX_PRICE_POINTS)
const MinQuantitySchema = z.number().int().min(1).max(MAX_QUANTITY)

export const ProductCreateSchema = z.object({
  enabled: z.boolean().default(true),
  inventoryGroupId: InventoryGroupSchema.default(null),
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
    inventoryGroupId: InventoryGroupSchema.optional(),
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

export const RefundOrderInputSchema = z.object({
  reason: RemarkSchema,
  /** false 时只退积分，账号或代理留在买家那里。 */
  reclaim: z.boolean(),
})
export type RefundOrderInput = z.infer<typeof RefundOrderInputSchema>

const YuanSchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/)
  .refine((value) => yuanToCents(value) > 0)

export const AlipayRechargeInputSchema = z.object({
  amountYuan: YuanSchema,
  idempotencyKey: IdempotencyKeySchema,
})

export const InvoiceTypeSchema = z.enum(["normal", "special"])
export const InvoiceTitleTypeSchema = z.enum(["company", "personal"])
export const InvoiceStatusSchema = z.enum(["pending", "issued", "rejected"])

/** 统一社会信用代码 18 位，旧税号 15、17、20 位，都只有数字和大写字母。 */
const TAX_NUMBER = /^(?:[0-9A-Z]{15}|[0-9A-Z]{17,18}|[0-9A-Z]{20})$/

export const InvoiceCreateSchema = z
  .object({
    amountYuan: YuanSchema,
    idempotencyKey: IdempotencyKeySchema,
    invoiceType: InvoiceTypeSchema,
    remark: z.string().trim().max(500).default(""),
    taxNumber: z
      .string()
      .trim()
      .max(20)
      .transform((value) => value.toUpperCase())
      .default(""),
    title: z.string().trim().min(1).max(200),
    titleType: InvoiceTitleTypeSchema,
  })
  .superRefine((value, context) => {
    if (value.titleType === "company" && !TAX_NUMBER.test(value.taxNumber)) {
      context.addIssue({ code: "custom", message: "tax_number_required", path: ["taxNumber"] })
    }
    if (value.titleType === "personal" && value.taxNumber !== "") {
      context.addIssue({ code: "custom", message: "tax_number_forbidden", path: ["taxNumber"] })
    }
    if (value.titleType === "personal" && value.invoiceType === "special") {
      context.addIssue({ code: "custom", message: "special_needs_company", path: ["invoiceType"] })
    }
  })
export type InvoiceCreateInput = z.infer<typeof InvoiceCreateSchema>

export const InvoiceQuerySchema = z.object({
  ...PageFields,
  invoiceType: InvoiceTypeSchema.optional(),
  keyword: z.string().trim().max(200).optional(),
  status: InvoiceStatusSchema.optional(),
  titleType: InvoiceTitleTypeSchema.optional(),
})
export type InvoiceFilter = z.infer<typeof InvoiceQuerySchema> & {
  readonly groupId?: string | undefined
}

export const InvoiceRejectSchema = z.object({ reason: RemarkSchema })
export const InvoiceNumberSchema = z.string().trim().min(1).max(64)
export const MAX_INVOICE_FILE_BYTES = 5 * 1024 * 1024

export type InvoiceFile = { readonly content: Uint8Array; readonly fileName: string }
export type InvoiceIssueInput = {
  readonly file: InvoiceFile | null
  readonly invoiceNumber: string
}
export type InvoiceQuota = {
  readonly availableCents: number
  readonly invoicedCents: number
  readonly paidCents: number
}
export type MallInvoice = {
  readonly amountCents: number
  readonly applicantName: string
  readonly createdAt: string
  readonly groupId: string
  readonly groupName: string
  readonly hasFile: boolean
  readonly id: string
  readonly invoiceNumber: string
  readonly invoiceType: z.infer<typeof InvoiceTypeSchema>
  readonly rejectReason: string
  readonly remark: string
  readonly reviewedAt: string | null
  readonly status: z.infer<typeof InvoiceStatusSchema>
  readonly taxNumber: string
  readonly title: string
  readonly titleType: z.infer<typeof InvoiceTitleTypeSchema>
  readonly updatedAt: string
}

export type RechargeOrder = {
  readonly amountCents: number
  readonly orderNo: string
  readonly points: number
  readonly status: "closed" | "paid" | "unpaid"
}

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
  readonly inventoryGroupId: string | null
  readonly inventoryGroupName: string | null
  readonly quantity: number | null
  readonly refundedAt: string | null
  readonly shippedAt: string | null
  readonly status: z.infer<typeof OrderStatusSchema>
  readonly title: string
  readonly type: "points" | "resource"
  readonly unitPoints: number | null
}

export type MallProduct = {
  /** 绑定库存分组时才有值：分组里实际可发的数量减去待发货占用。可能为负。 */
  readonly available: number | null
  readonly createdAt: string
  readonly enabled: boolean
  readonly id: string
  readonly inventoryGroupId: string | null
  readonly inventoryGroupName: string | null
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

const TransferIdsSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(MAX_TRANSFER_ITEMS)
  .refine((ids) => new Set(ids).size === ids.length)

export const TransferInputSchema = z.object({
  ids: TransferIdsSchema,
  kind: ProductKindSchema,
  sourceGroupId: z.string().uuid(),
  targetGroupId: z.string().uuid(),
})
export type TransferInput = z.infer<typeof TransferInputSchema>

export const ShipOrderInputSchema = z.object({
  ids: TransferIdsSchema,
  sourceGroupId: z.string().uuid(),
})
export type ShipOrderInput = z.infer<typeof ShipOrderInputSchema>

export const TransferableQuerySchema = z.object({
  ...PageFields,
  groupId: z.string().uuid(),
  keyword: z.string().trim().max(200).optional(),
  shippableOnly: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
})
export type TransferableFilter = z.infer<typeof TransferableQuerySchema>

export const TransferRecordQuerySchema = z.object({
  ...PageFields,
  kind: ProductKindSchema.optional(),
  orderId: z.string().uuid().optional(),
})
export type TransferRecordFilter = z.infer<typeof TransferRecordQuerySchema>

/** 为什么现在不能转移：占用中、代理还绑着账号、代理在加速链路里。 */
export type TransferBlock = "accelerator_linked" | "has_bindings" | "in_use"

export type TransferableResource = {
  readonly blockedBy: TransferBlock | null
  readonly detail: string
  readonly id: string
  readonly kind: ProductKind
  readonly name: string
  readonly shippable: boolean
  readonly status: string
  readonly tags: readonly string[]
}

export type TransferRecord = {
  readonly createdAt: string
  readonly displayName: string
  readonly entityId: string
  readonly id: string
  readonly kind: ProductKind
  readonly movedByName: string
  readonly orderNo: string | null
  readonly reason: string
  readonly sourceGroupName: string
  readonly targetGroupName: string
}

export type TransferResult = {
  readonly moved: number
  readonly replayed: boolean
}

export type ShipOrderResult = TransferResult & {
  readonly groupId: string
  readonly orderNo: string
}

export type ShipmentItem = {
  readonly id: string
  readonly kind: ProductKind
  readonly name: string
}

export type MallErrorCode =
  | "alipay_unavailable"
  | "group_not_found"
  | "idempotency_conflict"
  | "insufficient_balance"
  | "insufficient_stock"
  | "invalid_quantity"
  | "invoice_not_found"
  | "invoice_not_pending"
  | "invoice_over_quota"
  | "order_not_cancellable"
  | "order_not_found"
  | "order_not_refundable"
  | "order_not_shippable"
  | "price_changed"
  | "product_not_found"
  | "product_unavailable"
  | "resource_accelerator_linked"
  | "resource_changed"
  | "resource_has_bindings"
  | "resource_in_use"
  | "resource_not_found"
  | "resource_not_ready"
  | "refund_items_moved"
  | "refund_source_missing"
  | "ship_quantity_mismatch"
  | "ship_source_mismatch"
  | "transfer_conflict"
  | "transfer_same_group"

export class MallError extends Error {
  /** items 是出问题的账号或代理名称，让操作人知道该处理哪几个。 */
  public constructor(
    public readonly code: MallErrorCode,
    public readonly items: readonly string[] = [],
  ) {
    super(code)
    this.name = "MallError"
  }
}
