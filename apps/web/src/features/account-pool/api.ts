import ky, { HTTPError } from "ky"
import { z } from "zod"
import { resolveApiBaseUrl } from "../../lib/api/auth-api"

const SourceSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().uuid().nullable(),
  deviceSeq: z.number().int().nullable(),
  follower: z.number(),
  following: z.number(),
  heart: z.number(),
  online: z.boolean(),
  playBeforeYesterday: z.number(),
  playToday: z.number(),
  playTotal: z.number(),
  playYesterday: z.number(),
  proxyRemark: z.string(),
  region: z.string(),
  remark: z.string(),
  status: z.enum(["0", "1"]),
  statisticsState: z.enum(["stored", "unavailable"]),
  tag: z.string(),
  tagBucket: z.array(z.string()),
  transferred: z.boolean(),
  uid: z.string(),
  updateTime: z.string(),
  username: z.string(),
  videoPlays: z.array(z.number()),
})
const DeskQuerySchema = z.object({
  app: z.string(),
  backType: z.string(),
  deviceId: z.string().uuid().nullable(),
  followerGT: z.string(),
  followingGT: z.string(),
  identity: z.string(),
  proxyId: z.string().uuid().nullable(),
  quick: z.array(z.string()),
  region: z.array(z.string()),
  status: z.string(),
  tag: z.string(),
  tagBucket: z.array(z.string()),
  transferKey: z.string(),
  ungrouped: z.boolean().default(false),
  unremarked: z.boolean().default(false),
  untagged: z.boolean().default(false),
  userRemark: z.string().default(""),
  userRemarks: z.array(z.string()).default([]),
})
const DeskFilterSchema = z.object({
  kind: z.literal("desk"),
  query: DeskQuerySchema,
})
export const FilterSchema = z.object({
  backType: z.enum(["1", "2", "3", "4", "5"]),
  deviceId: z.string().uuid().nullable(),
  deviceSeq: z.number().int().nullable(),
  online: z.boolean().nullable(),
  status: z.enum(["", "0", "1"]),
  tag: z.array(z.string()),
  tagExclude: z.array(z.string()),
  tagInclude: z.array(z.string()),
  tagQueryMode: z.enum(["AND", "OR"]),
})
const PoolSchema = z.object({
  id: z.string().uuid(),
  displayId: z.number().int(),
  groupId: z.string().uuid(),
  createdByUserId: z.string().uuid(),
  createdByName: z.string(),
  key: z.string(),
  remark: z.string(),
  backType: z.enum(["1", "2", "3", "4", "5"]),
  deviceId: z.string().uuid().nullable(),
  deviceSeq: z.number().int().nullable(),
  deviceLabel: z.string(),
  times: z.number().int(),
  count: z.number().int(),
  filterCondition: z.union([DeskFilterSchema, FilterSchema]).nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
})
const DetailsSchema = PoolSchema.extend({
  accounts: z.array(SourceSchema),
  progress: z.array(
    z.object({
      round: z.number().int(),
      key: z.string(),
      size: z.number().int(),
      total: z.number().int(),
      unusedAccountIds: z.array(z.string().uuid()),
    }),
  ),
})
const DevicesSchema = z.object({
  items: z.array(
    z.object({ id: z.string().uuid(), name: z.string(), host: z.string(), serial: z.string() }),
  ),
})
const SourcesSchema = z.object({
  items: z.array(SourceSchema),
  total: z.number().int(),
  groups: z.array(z.object({ tag: z.string(), total: z.number().int() })),
})
const ListSchema = z.object({
  items: z.array(PoolSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
})

export type PoolSource = z.infer<typeof SourceSchema>
export type SourceFilter = z.infer<typeof FilterSchema>
export type StoredPool = z.infer<typeof PoolSchema>
export type StoredPoolDetails = z.infer<typeof DetailsSchema>
export type StoredPoolDevice = z.infer<typeof DevicesSchema>["items"][number]
export type DeskPoolQuery = z.infer<typeof DeskQuerySchema>
export type PoolWrite = {
  readonly accountIds?: readonly string[] | undefined
  readonly filter: SourceFilter
  readonly key?: string | undefined
  readonly mode: "all" | "selected"
  readonly remark: string
  readonly times: number
}
export const createAccountPoolsApi = () => {
  const client = ky.create({
    prefixUrl: resolveApiBaseUrl("/api", window.location.href),
    credentials: "include",
    retry: 0,
  })
  const root = (groupId: string) => `groups/${groupId}/operations/account-pools`
  return {
    list: async (
      groupId: string,
      query: { id: string; key: string; remark: string; page: number; pageSize: number },
    ) => ListSchema.parse(await client.get(root(groupId), { searchParams: query }).json()),
    devices: async (groupId: string) =>
      DevicesSchema.parse(await client.get(`${root(groupId)}/devices`).json()).items,
    sources: async (groupId: string, filter: SourceFilter, page = 1, pageSize = 10) =>
      SourcesSchema.parse(
        await client.post(`${root(groupId)}/sources`, { json: { filter, page, pageSize } }).json(),
      ),
    create: async (groupId: string, input: PoolWrite) =>
      PoolSchema.parse(await client.post(root(groupId), { json: input }).json()),
    createDesk: async (groupId: string, query: DeskPoolQuery, name = "") =>
      PoolSchema.parse(await client.post(root(groupId), { json: { desk: query, name } }).json()),
    details: async (groupId: string, id: string) =>
      DetailsSchema.parse(await client.get(`${root(groupId)}/${id}`).json()),
    remove: async (groupId: string, ids: readonly string[]) => {
      await client.post(`${root(groupId)}/batch-delete`, { json: { ids } })
    },
  }
}
export type AccountPoolsApi = ReturnType<typeof createAccountPoolsApi>

export const poolRequestError = async (error: unknown): Promise<string> => {
  if (error instanceof HTTPError) {
    const body: unknown = await error.response
      .clone()
      .json()
      .catch(() => null)
    const code = body !== null && typeof body === "object" && "error" in body ? body.error : ""
    const errors: Record<string, string> = {
      account_pool_key_conflict: "这个名字的账号池已经存在",
      account_pool_invalid_source: "账号或设备已变化，请刷新后重试",
      account_pool_empty: "没有可加入的账号",
      account_pool_not_found: "账号池不存在或无权访问",
      account_pool_expired: "账号池已过期",
      permission_denied: "没有操作权限",
    }
    if (typeof code === "string" && errors[code]) return errors[code]
  }
  return "账号池请求失败"
}
