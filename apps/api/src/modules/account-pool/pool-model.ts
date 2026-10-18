import { z } from "zod"

export const PoolIdSchema = z.string().uuid()
export const PoolBackTypeSchema = z.enum(["1", "2", "3", "4", "5"])
const Tags = z.array(z.string().trim().min(1).max(64)).max(20)

const QuickFilters = [
  "noUsername",
  "noPassword",
  "hasPassword",
  "noTotp",
  "hasTotp",
  "online",
  "offline",
  "noProxy",
  "favorite",
] as const
const sortedText = (values: readonly string[]): string[] =>
  [...new Set(values.map((item) => item.trim()).filter((item) => item.length > 0))].sort(
    (left, right) => left.localeCompare(right, "zh-CN"),
  )
const identityTokens = (value: string): string[] => sortedText(value.split(/[,，;；、|\s]+/))
const countText = (value: string): string => (value.length === 0 ? "" : String(Number(value)))

export const DeskPoolQuerySchema = z.object({
  app: z.enum(["", "tiktok", "youtube", "facebook", "instagram", "twitter"]).default(""),
  backType: z.enum(["", "2", "3", "4", "5"]).default(""),
  deviceId: z.string().uuid().nullable().default(null),
  followerGT: z.string().regex(/^\d*$/).max(12).default("").transform(countText),
  followingGT: z.string().regex(/^\d*$/).max(12).default("").transform(countText),
  identity: z
    .string()
    .max(2000)
    .default("")
    .transform((value) => identityTokens(value).join("、")),
  proxyId: z.string().uuid().nullable().default(null),
  quick: z
    .array(z.enum(QuickFilters))
    .max(QuickFilters.length)
    .default([])
    .transform((values) => QuickFilters.filter((item) => values.includes(item))),
  region: z.array(z.string().trim().min(1).max(40)).max(20).default([]).transform(sortedText),
  status: z.enum(["", "0", "1", "2", "3"]).default(""),
  tag: z.string().trim().max(64).default(""),
  tagBucket: z.array(z.string().trim().min(1).max(64)).max(20).default([]).transform(sortedText),
  transferKey: z.string().trim().max(160).default(""),
  ungrouped: z.boolean().default(false),
  unremarked: z.boolean().default(false),
  untagged: z.boolean().default(false),
  userRemark: z.string().trim().max(200).default(""),
  userRemarks: z.array(z.string().trim().min(1).max(200)).max(20).default([]).transform(sortedText),
})
export const DeskPoolFilterSchema = z.object({
  kind: z.literal("desk"),
  query: DeskPoolQuerySchema,
})
export const DeskCreateSchema = z.object({
  name: z.string().trim().max(400).default(""),
  query: DeskPoolQuerySchema,
})
export type DeskPoolQuery = z.infer<typeof DeskPoolQuerySchema>
export type DeskPoolFilter = z.infer<typeof DeskPoolFilterSchema>
export type DeskCreate = z.infer<typeof DeskCreateSchema>

const QUICK_LABELS: Record<(typeof QuickFilters)[number], string> = {
  favorite: "已收藏",
  hasPassword: "有密码",
  hasTotp: "有2FA",
  noPassword: "无密码",
  noProxy: "无代理",
  noTotp: "无2FA",
  noUsername: "无用户名",
  offline: "离线",
  online: "在线",
}
const STATUS_LABELS = { "0": "正常", "1": "封号", "2": "过期", "3": "不可见" } as const
const APP_LABELS = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "Tiktok",
  twitter: "Twitter",
  youtube: "Youtube",
} as const
const BACKUP_LABELS = {
  "2": "本地备份",
  "3": "私有云备份",
  "4": "云端备份",
  "5": "全量备份",
} as const

export const deskPoolKey = (
  query: DeskPoolQuery,
  labels: { readonly device: string; readonly proxy: string },
): string => {
  const parts: string[] = []
  if (query.ungrouped) parts.push("账号分组=未分组")
  else if (query.tag.length > 0) parts.push(`账号分组=${query.tag}`)
  if (query.untagged) parts.push("账号标签=未标签")
  else if (query.tagBucket.length > 0) parts.push(`账号标签=${query.tagBucket.join("、")}`)
  if (query.unremarked) parts.push("用户备注=未备注")
  else if (query.userRemarks.length > 0) parts.push(`用户备注=${query.userRemarks.join("、")}`)
  else if (query.userRemark.length > 0) parts.push(`用户备注=${query.userRemark}`)
  if (query.status !== "") parts.push(`账号状态=${STATUS_LABELS[query.status]}`)
  if (query.app !== "") parts.push(`APP类型=${APP_LABELS[query.app]}`)
  if (query.backType !== "") parts.push(`备份方式=${BACKUP_LABELS[query.backType]}`)
  if (query.quick.length > 0)
    parts.push(`快捷筛选=${query.quick.map((item) => QUICK_LABELS[item]).join("、")}`)
  if (query.region.length > 0) parts.push(`归属地=${query.region.join("、")}`)
  if (query.deviceId !== null) parts.push(`绑定设备=${labels.device}`)
  if (query.proxyId !== null) parts.push(`绑定代理=${labels.proxy}`)
  if (query.identity.length > 0) parts.push(`用户名 / UID=${query.identity}`)
  if (query.followerGT.length > 0) parts.push(`最少粉丝数=${query.followerGT}`)
  if (query.followingGT.length > 0) parts.push(`最少关注数=${query.followingGT}`)
  if (query.transferKey.length > 0) parts.push(`转移码=${query.transferKey}`)
  return parts.join("，")
}
export const ALL_ACCOUNTS_POOL_NAME = "全部账号"
export const resolveDeskPoolName = (auto: string, custom: string): string => {
  const typed = custom.trim()
  if (typed.length > 0) return typed
  return auto.length > 0 ? auto : ALL_ACCOUNTS_POOL_NAME
}
export const deskPoolHasCondition = (query: DeskPoolQuery): boolean =>
  deskPoolKey(query, { device: "设备", proxy: "代理" }).length > 0

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
  key: z.string().trim().max(400).default(""),
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
  readonly createdByName: string
  readonly key: string
  readonly remark: string
  readonly backType: z.infer<typeof PoolBackTypeSchema>
  readonly deviceId: string | null
  readonly deviceSeq: number | null
  readonly deviceLabel: string
  readonly times: number
  readonly count: number
  readonly filterCondition: PoolSourceFilter | DeskPoolFilter | null
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
