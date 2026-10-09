import { z } from "zod"

export const PoolIdSchema = z.string().uuid()
export const PoolBackTypeSchema = z.enum(["1", "2", "3", "4", "5"])
const Tags = z.array(z.string().trim().min(1).max(64)).max(20)

export const PoolSourceFilterSchema = z.object({
  backType: PoolBackTypeSchema.default("2"),
  deviceId: z.string().uuid().nullable().default(null),
  deviceSeq: z.number().int().min(1).max(12).nullable().default(null),
  online: z.boolean().nullable().default(null),
  status: z.enum(["", "0", "1"]).default(""),
  tag: Tags.default([]),
  tagExclude: Tags.default([]),
  tagInclude: Tags.default([]),
  tagQueryMode: z.enum(["AND", "OR"]).default("AND"),
})
export const PoolWriteSchema = z.object({
  accountIds: z.array(z.string().uuid()).min(1).max(3000).optional(),
  filter: PoolSourceFilterSchema,
  key: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .refine((value) => !value.includes("+"))
    .optional(),
  mode: z.enum(["all", "selected"]).default("all"),
  remark: z.string().max(2000).default(""),
  times: z.number().int().min(1).max(20).default(1),
})
export const PoolListSchema = z.object({
  id: z.string().trim().max(30).default(""),
  key: z.string().trim().max(160).default(""),
  remark: z.string().trim().max(2000).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(10),
})
export const PoolConsumeSchema = z.object({
  accountId: z.string().uuid(),
  consumptionKey: z.string().trim().min(1).max(160),
  round: z.number().int().min(1).max(20),
})

export type PoolSourceFilter = z.infer<typeof PoolSourceFilterSchema>
export type PoolWrite = z.infer<typeof PoolWriteSchema>
export type PoolListFilter = z.infer<typeof PoolListSchema>
export type PoolConsume = z.infer<typeof PoolConsumeSchema> & {
  readonly origin?: "reported" | "simulation"
}
export type PoolSourceAccount = {
  readonly id: string
  readonly deviceId: string | null
  readonly deviceSeq: number | null
  readonly follower: number
  readonly following: number
  readonly heart: number
  readonly online: boolean
  readonly playBeforeYesterday: number
  readonly playToday: number
  readonly playTotal: number
  readonly playYesterday: number
  readonly proxyRemark: string
  readonly region: string
  readonly remark: string
  readonly status: "0" | "1"
  readonly statisticsState: "stored" | "unavailable"
  readonly tag: string
  readonly tagBucket: readonly string[]
  readonly transferred: boolean
  readonly uid: string
  readonly updateTime: string
  readonly username: string
  readonly videoPlays: readonly number[]
}
export type PoolDevice = {
  readonly id: string
  readonly name: string
  readonly host: string
  readonly serial: string
}
export type AccountPool = {
  readonly id: string
  readonly displayId: number
  readonly groupId: string
  readonly createdByUserId: string
  readonly key: string
  readonly remark: string
  readonly backType: z.infer<typeof PoolBackTypeSchema>
  readonly deviceId: string | null
  readonly deviceSeq: number | null
  readonly deviceLabel: string
  readonly times: number
  readonly count: number
  readonly filterCondition: PoolSourceFilter | null
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly expiresAt: Date
}
export type PoolRound = {
  readonly round: number
  readonly key: string
  readonly size: number
  readonly total: number
  readonly unusedAccountIds: readonly string[]
}
export type PoolDetails = AccountPool & {
  readonly accounts: readonly PoolSourceAccount[]
  readonly progress: readonly PoolRound[]
}
export class PoolError extends Error {
  public constructor(
    public readonly code:
      | "account_pool_not_found"
      | "account_pool_key_conflict"
      | "account_pool_invalid_source"
      | "account_pool_empty"
      | "account_pool_expired"
      | "account_pool_consumption_conflict"
      | "account_pool_in_use",
  ) {
    super(code)
    this.name = "PoolError"
  }
}
