import ky, { HTTPError } from "ky"
import { z } from "zod"

import { resolveApiBaseUrl } from "../../lib/api/auth-api"

export const OperationAccountAppSchema = z.enum([
  "tiktok",
  "youtube",
  "facebook",
  "instagram",
  "twitter",
])
export const OperationAccountStatusSchema = z.enum([
  "ready",
  "suspended",
  "disabled",
  "expired",
  "hidden",
  "unregistered",
])
export const OperationAccountBackupTypeSchema = z.enum(["local", "private_cloud", "cloud", "full"])
export const FavoriteAccountTag = "收藏"

const AccountSchema = z.object({
  app: OperationAccountAppSchema.nullable().optional().default(null),
  avatar: z.string().optional().default(""),
  backupKey: z.string().optional().default(""),
  backupSlot: z.string().optional().default(""),
  backupType: OperationAccountBackupTypeSchema.nullable().optional().default(null),
  createdAt: z.coerce
    .date()
    .optional()
    .default(() => new Date(0)),
  credentialState: z.enum(["configured", "none"]).optional().default("none"),
  deleted: z.boolean().optional().default(false),
  deletedAt: z.coerce.date().nullable().optional().default(null),
  deviceId: z.string().uuid().nullable().optional().default(null),
  deviceInstanceId: z.string().uuid().nullable().optional().default(null),
  deviceName: z.string().nullable().optional().default(null),
  extra: z.record(z.string(), z.unknown()).optional().default({}),
  favorite: z.coerce.number().nullable().optional().default(null),
  follower: z.coerce.number().nullable().optional().default(null),
  following: z.coerce.number().nullable().optional().default(null),
  groupId: z.string().uuid(),
  hasPassword: z.boolean().optional().default(false),
  hasTotp: z.boolean().optional().default(false),
  hasTransferKey: z.boolean().optional().default(false),
  id: z.string().uuid(),
  identifier: z.string().optional().default(""),
  instanceIndex: z.number().int().nullable().optional().default(null),
  instanceLabel: z.string().nullable().optional().default(null),
  name: z.string(),
  note: z.string().optional().default(""),
  online: z.boolean().optional().default(false),
  platformUid: z.string().optional().default(""),
  proxyId: z.string().uuid().nullable().optional().default(null),
  proxyName: z.string().nullable().optional().default(null),
  region: z.string().optional().default(""),
  status: OperationAccountStatusSchema,
  tags: z.array(z.string()).optional().default([]),
  transferred: z.boolean().optional().default(false),
  updatedAt: z.coerce.date(),
})

const PageSchema = z.object({
  items: z.array(AccountSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
})
const BatchResultSchema = z.object({ affected: z.number().int() })
const CredentialSchema = z.object({
  emailPassword: z.string(),
  id: z.string().uuid(),
  msToken: z.string(),
  password: z.string(),
  pop3Password: z.string(),
  totp: z.string(),
})

export type OperationAccount = z.infer<typeof AccountSchema>
export type OperationAccountApp = z.infer<typeof OperationAccountAppSchema>
export type OperationAccountStatus = z.infer<typeof OperationAccountStatusSchema>
export type OperationAccountBackupType = z.infer<typeof OperationAccountBackupTypeSchema>
export type AccountPage = z.infer<typeof PageSchema>
export type AccountTagBatchMode = "add" | "replace" | "clear" | "remove"

export type AccountListInput = {
  readonly app?: OperationAccountApp | undefined
  readonly backupType?: OperationAccountBackupType | undefined
  readonly deleted?: boolean | undefined
  readonly deviceId?: string | undefined
  readonly favorite?: boolean | undefined
  readonly groupId: string
  readonly hasPassword?: boolean | undefined
  readonly hasProxy?: boolean | undefined
  readonly hasTotp?: boolean | undefined
  readonly noUsername?: boolean | undefined
  readonly online?: boolean | undefined
  readonly page: number
  readonly pageSize: number
  readonly query?: string | undefined
  readonly status?: OperationAccountStatus | undefined
  readonly tag?: string | undefined
}

export type AccountWriteInput = {
  readonly app?: OperationAccountApp | null | undefined
  readonly backupType?: OperationAccountBackupType | null | undefined
  readonly deviceId?: string | null | undefined
  readonly deviceInstanceId?: string | null | undefined
  readonly identifier?: string | undefined
  readonly name?: string | undefined
  readonly note?: string | undefined
  readonly proxyId?: string | null | undefined
  readonly extra?: Readonly<Record<string, unknown>> | undefined
  readonly follower?: number | null | undefined
  readonly following?: number | null | undefined
  readonly platformUid?: string | undefined
  readonly region?: string | undefined
  readonly resourceSecrets?: Readonly<Record<string, string>> | undefined
  readonly secret?: string | undefined
  readonly status?: OperationAccountStatus | undefined
  readonly tags?: readonly string[] | undefined
  readonly totp?: string | undefined
}

export type AccountCredential = {
  readonly emailPassword: string
  readonly id: string
  readonly msToken: string
  readonly password: string
  readonly pop3Password: string
  readonly totp: string
}

export interface AccountsApi {
  assignProxy(
    groupId: string,
    ids: readonly string[],
    proxyId: string | null,
  ): Promise<{ readonly affected: number }>
  credentials(groupId: string, ids: readonly string[]): Promise<readonly AccountCredential[]>
  create(groupId: string, input: AccountWriteInput): Promise<OperationAccount>
  delete(groupId: string, ids: readonly string[]): Promise<{ readonly affected: number }>
  exportMasked(input: AccountListInput): Promise<string>
  list(input: AccountListInput): Promise<AccountPage>
  recycle(groupId: string, ids: readonly string[]): Promise<{ readonly affected: number }>
  restore(groupId: string, ids: readonly string[]): Promise<{ readonly affected: number }>
  update(groupId: string, id: string, input: AccountWriteInput): Promise<OperationAccount>
  updateTags(
    groupId: string,
    ids: readonly string[],
    mode: AccountTagBatchMode,
    tags?: readonly string[],
  ): Promise<{ readonly affected: number }>
  setGroup(groupId: string, ids: readonly string[], tag: string): Promise<{ readonly affected: number }>
  setNote(groupId: string, ids: readonly string[], note: string): Promise<{ readonly affected: number }>
  setRegion(groupId: string, ids: readonly string[], region: string): Promise<{ readonly affected: number }>
  setFavorite(
    groupId: string,
    ids: readonly string[],
    starred: boolean,
  ): Promise<{ readonly affected: number }>
  moveGroupTags(
    groupId: string,
    oldTags: readonly string[],
    newTag: string,
  ): Promise<{ readonly affected: number }>
  statistics(groupId: string): Promise<
    readonly {
      readonly available: number
      readonly banned: number
      readonly online: number
      readonly tag: string
      readonly total: number
      readonly transferred: number
    }[]
  >
  deleteByTag(
    groupId: string,
    tag: string,
    bannedOnly: boolean,
    confirm?: string,
  ): Promise<{ readonly affected: number }>
  resetBanned(groupId: string, tag: string): Promise<{ readonly affected: number }>
  listTransfers(groupId: string): Promise<
    readonly {
      readonly accountIds: readonly string[]
      readonly code: string
      readonly count: number
      readonly tags: string
    }[]
  >
  createTransfer(
    groupId: string,
    ids: readonly string[],
    code?: string,
  ): Promise<{ readonly code: string; readonly count: number }>
  revokeTransfer(groupId: string, code: string): Promise<{ readonly affected: number }>
  splitTransfer(
    groupId: string,
    code: string,
    size: number,
  ): Promise<{ readonly codes: readonly string[] }>
  mergeTransfers(
    groupId: string,
    codes: readonly string[],
    code?: string,
  ): Promise<{ readonly code: string; readonly count: number }>
  redeemTransfer(groupId: string, code: string): Promise<{ readonly affected: number }>
  backup(groupId: string, input: AccountWriteInput): Promise<OperationAccount>
  start(
    groupId: string,
    accountId: string,
    input: {
      readonly deviceId: string
      readonly deviceInstanceId: string
      readonly proxyId: string | null
    },
  ): Promise<{ readonly updated: boolean }>
  exportByIds(groupId: string, ids: readonly string[]): Promise<string>
}

const groupPath = (groupId: string): string =>
  `groups/${encodeURIComponent(groupId)}/operations/accounts`

const searchParams = (input: AccountListInput): URLSearchParams => {
  const params = new URLSearchParams({
    page: `${input.page}`,
    pageSize: `${input.pageSize}`,
  })
  const flags = {
    deleted: input.deleted,
    favorite: input.favorite,
    hasPassword: input.hasPassword,
    hasProxy: input.hasProxy,
    hasTotp: input.hasTotp,
    noUsername: input.noUsername,
    online: input.online,
  } as const
  for (const [key, value] of Object.entries(flags)) {
    if (value !== undefined) params.set(key, value ? "true" : "false")
  }
  if (input.app !== undefined) params.set("app", input.app)
  if (input.backupType !== undefined) params.set("backupType", input.backupType)
  if (input.deviceId !== undefined && input.deviceId.length > 0)
    params.set("deviceId", input.deviceId)
  if (input.query !== undefined && input.query.length > 0) params.set("query", input.query)
  if (input.status !== undefined) params.set("status", input.status)
  if (input.tag !== undefined && input.tag.length > 0) params.set("tag", input.tag)
  return params
}

export const accountRequestError = async (error: unknown): Promise<string> => {
  if (error instanceof HTTPError) {
    try {
      const payload = z.object({ error: z.string() }).safeParse(await error.response.json())
      if (payload.success) {
        const messages: Readonly<Record<string, string>> = {
          confirm_required: "需要输入“确认全部删除”",
          invalid_account_binding: "设备、机位或代理不属于当前分组",
          invalid_transfer: "转移码无效",
          not_found: "账号不存在",
          operation_entity_active: "账号正在被租约或任务占用",
          transfer_conflict: "转移失败，目标分组已有相同账号",
        }
        return messages[payload.data.error] ?? `请求失败：${payload.data.error}`
      }
    } catch {
      return error instanceof Error ? error.message : "操作失败，请稍后重试"
    }
  }
  return error instanceof Error ? error.message : "操作失败，请稍后重试"
}

export const createAccountsApi = (apiBaseUrl = "/api"): AccountsApi => {
  const client = ky.create({
    credentials: "include",
    prefixUrl: resolveApiBaseUrl(apiBaseUrl, window.location.href),
    retry: 0,
    timeout: 7_000,
  })
  return {
    assignProxy: async (groupId, ids, proxyId) =>
      BatchResultSchema.parse(
        await client.post(`${groupPath(groupId)}/batch/proxy`, { json: { ids, proxyId } }).json(),
      ),
    credentials: async (groupId, ids) =>
      z.array(CredentialSchema).parse(
        await client.post(`${groupPath(groupId)}/credentials`, { json: { ids } }).json(),
      ),
    create: async (groupId, input) =>
      AccountSchema.parse(await client.post(groupPath(groupId), { json: input }).json()),
    delete: async (groupId, ids) =>
      BatchResultSchema.parse(
        await client.post(`${groupPath(groupId)}/batch/delete`, { json: { ids } }).json(),
      ),
    exportMasked: async (input) =>
      client
        .get(`${groupPath(input.groupId)}/export`, { searchParams: searchParams(input) })
        .text(),
    list: async (input) =>
      PageSchema.parse(
        await client.get(groupPath(input.groupId), { searchParams: searchParams(input) }).json(),
      ),
    recycle: async (groupId, ids) =>
      BatchResultSchema.parse(
        await client.post(`${groupPath(groupId)}/recycle`, { json: { ids } }).json(),
      ),
    restore: async (groupId, ids) =>
      BatchResultSchema.parse(
        await client.post(`${groupPath(groupId)}/restore`, { json: { ids } }).json(),
      ),
    update: async (groupId, id, input) =>
      AccountSchema.parse(
        await client
          .patch(`${groupPath(groupId)}/${encodeURIComponent(id)}`, { json: input })
          .json(),
      ),
    updateTags: async (groupId, ids, mode, tags = []) =>
      BatchResultSchema.parse(
        await client.post(`${groupPath(groupId)}/batch/tags`, { json: { ids, mode, tags } }).json(),
      ),
    setGroup: async (groupId, ids, tag) =>
      BatchResultSchema.parse(
        await client.post(`${groupPath(groupId)}/batch/group`, { json: { ids, tag } }).json(),
      ),
    setNote: async (groupId, ids, note) =>
      BatchResultSchema.parse(
        await client.post(`${groupPath(groupId)}/batch/note`, { json: { ids, note } }).json(),
      ),
    setRegion: async (groupId, ids, region) =>
      BatchResultSchema.parse(
        await client.post(`${groupPath(groupId)}/batch/region`, { json: { ids, region } }).json(),
      ),
    setFavorite: async (groupId, ids, starred) =>
      BatchResultSchema.parse(
        await client.post(`${groupPath(groupId)}/batch/favorite`, { json: { ids, starred } }).json(),
      ),
    moveGroupTags: async (groupId, oldTags, newTag) =>
      BatchResultSchema.parse(
        await client
          .post(`${groupPath(groupId)}/batch/tags/move`, { json: { newTag, oldTags } })
          .json(),
      ),
    statistics: async (groupId) =>
      z
        .array(
          z.object({
            available: z.number().int(),
            banned: z.number().int(),
            online: z.number().int(),
            tag: z.string(),
            total: z.number().int(),
            transferred: z.number().int(),
          }),
        )
        .parse(await client.get(`${groupPath(groupId)}/statistics`).json()),
    deleteByTag: async (groupId, tag, bannedOnly, confirm) =>
      BatchResultSchema.parse(
        await client
          .post(`${groupPath(groupId)}/statistics/delete`, {
            json: { bannedOnly, confirm, tag },
          })
          .json(),
      ),
    resetBanned: async (groupId, tag) =>
      BatchResultSchema.parse(
        await client
          .post(`${groupPath(groupId)}/statistics/reset-banned`, { json: { tag } })
          .json(),
      ),
    listTransfers: async (groupId) =>
      z
        .array(
          z.object({
            accountIds: z.array(z.string().uuid()),
            code: z.string(),
            count: z.number().int(),
            tags: z.string(),
          }),
        )
        .parse(await client.get(`${groupPath(groupId)}/transfers`).json()),
    createTransfer: async (groupId, ids, code) =>
      z
        .object({ code: z.string(), count: z.number().int() })
        .parse(
          await client.post(`${groupPath(groupId)}/transfers`, { json: { code, ids } }).json(),
        ),
    revokeTransfer: async (groupId, code) =>
      BatchResultSchema.parse(
        await client.post(`${groupPath(groupId)}/transfers/revoke`, { json: { code } }).json(),
      ),
    splitTransfer: async (groupId, code, size) =>
      z
        .object({ codes: z.array(z.string()) })
        .parse(
          await client.post(`${groupPath(groupId)}/transfers/split`, { json: { code, size } }).json(),
        ),
    mergeTransfers: async (groupId, codes, code) =>
      z
        .object({ code: z.string(), count: z.number().int() })
        .parse(
          await client
            .post(`${groupPath(groupId)}/transfers/merge`, { json: { code, codes } })
            .json(),
        ),
    redeemTransfer: async (groupId, code) =>
      BatchResultSchema.parse(
        await client.post(`${groupPath(groupId)}/transfers/redeem`, { json: { code } }).json(),
      ),
    backup: async (groupId, input) =>
      AccountSchema.parse(await client.post(`${groupPath(groupId)}/backups`, { json: input }).json()),
    start: async (groupId, accountId, input) =>
      z
        .object({ updated: z.boolean() })
        .parse(
          await client
            .post(`${groupPath(groupId)}/${encodeURIComponent(accountId)}/start`, { json: input })
            .json(),
        ),
    exportByIds: async (groupId, ids) =>
      client.post(`${groupPath(groupId)}/export`, { json: { ids } }).text(),
  }
}
