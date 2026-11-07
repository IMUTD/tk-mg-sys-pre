import { z } from "zod"

/** 1 元 = 100 积分，所以 1 分钱正好对应 1 积分。 */
export const POINTS_PER_YUAN = 100

export const MAX_ADJUST_POINTS = 10_000_000_000

export const PointTypeSchema = z.enum(["recharge", "spend", "refund", "adjust"])
export type PointType = z.infer<typeof PointTypeSchema>

export const OrderTypeSchema = z.enum(["points", "resource"])
export const OrderStatusSchema = z.enum(["unpaid", "paid"])

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
  readonly createdAt: string
  readonly description: string
  readonly id: string
  readonly orderNo: string
  readonly paidAt: string | null
  readonly points: number
  readonly product: string
  readonly status: "paid"
  readonly title: string
  readonly type: "points"
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
  readonly groupId: string
  readonly keyword?: string | undefined
  readonly page: number
  readonly pageSize: number
  readonly status?: z.infer<typeof OrderStatusSchema> | undefined
  readonly type?: z.infer<typeof OrderTypeSchema> | undefined
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

export type MallErrorCode = "group_not_found" | "idempotency_conflict" | "insufficient_balance"

export class MallError extends Error {
  public constructor(public readonly code: MallErrorCode) {
    super(code)
    this.name = "MallError"
  }
}
