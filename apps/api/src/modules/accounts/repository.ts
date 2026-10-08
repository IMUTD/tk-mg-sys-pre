import type { Sql, TransactionSql } from "postgres"
import { z } from "zod"

import type { GroupId } from "../../lib/authorization"
import {
  assertNoActiveAccountLeases,
  assertNoActiveAccountResourceAllocations,
  assertNoActiveTaskClaims,
} from "../../lib/operation-claim-guard"

export const OperationAccountIdSchema = z.string().uuid().brand<"OperationAccountId">()
export type OperationAccountId = z.infer<typeof OperationAccountIdSchema>

export const OperationAccountStatus = {
  Disabled: "disabled",
  Ready: "ready",
  Suspended: "suspended",
} as const
export type OperationAccountStatus =
  (typeof OperationAccountStatus)[keyof typeof OperationAccountStatus]
export const OperationAccountStatusSchema = z.enum([
  OperationAccountStatus.Ready,
  OperationAccountStatus.Suspended,
  OperationAccountStatus.Disabled,
])

export const OperationAccountApp = {
  Facebook: "facebook",
  Instagram: "instagram",
  TikTok: "tiktok",
  Twitter: "twitter",
  YouTube: "youtube",
} as const
export type OperationAccountApp = (typeof OperationAccountApp)[keyof typeof OperationAccountApp]
export const OperationAccountAppSchema = z.enum([
  OperationAccountApp.TikTok,
  OperationAccountApp.YouTube,
  OperationAccountApp.Facebook,
  OperationAccountApp.Instagram,
  OperationAccountApp.Twitter,
])

export const OperationAccountBackupType = {
  Local: "local",
  PrivateCloud: "private_cloud",
} as const
export type OperationAccountBackupType =
  (typeof OperationAccountBackupType)[keyof typeof OperationAccountBackupType]
export const OperationAccountBackupTypeSchema = z.enum([
  OperationAccountBackupType.Local,
  OperationAccountBackupType.PrivateCloud,
])

export const FavoriteAccountTag = "收藏"

export type OperationAccount = {
  readonly app: OperationAccountApp | null
  readonly avatar: string
  readonly backupKey: string
  readonly backupSlot: string
  readonly backupType: OperationAccountBackupType | null
  readonly createdAt: Date
  readonly credentialState: "configured" | "none"
  readonly deleted: boolean
  readonly deletedAt: Date | null
  readonly deviceId: string | null
  readonly deviceInstanceId: string | null
  readonly deviceName: string | null
  readonly extra: Readonly<Record<string, unknown>>
  readonly favorite: number | null
  readonly follower: number | null
  readonly following: number | null
  readonly groupId: GroupId
  readonly hasPassword: boolean
  readonly hasTotp: boolean
  readonly hasTransferKey: boolean
  readonly id: OperationAccountId
  readonly identifier: string
  readonly instanceLabel: string | null
  readonly name: string
  readonly note: string
  readonly online: boolean
  readonly platformUid: string
  readonly proxyId: string | null
  readonly proxyName: string | null
  readonly region: string
  readonly status: OperationAccountStatus
  readonly tags: readonly string[]
  readonly transferred: boolean
  readonly updatedAt: Date
}

export type StoredOperationAccount = OperationAccount & {
  readonly encryptedSecret: string
  readonly encryptedTotp: string
  readonly encryptedTransferKey: string
}

export type AccountCreateInput = {
  readonly app?: OperationAccountApp | null | undefined
  readonly backupType?: OperationAccountBackupType | null | undefined
  readonly deviceId?: string | null | undefined
  readonly deviceInstanceId?: string | null | undefined
  readonly groupId: GroupId
  readonly identifier: string
  readonly name: string
  readonly avatar?: string | undefined
  readonly extra?: Readonly<Record<string, unknown>> | undefined
  readonly favorite?: number | null | undefined
  readonly follower?: number | null | undefined
  readonly following?: number | null | undefined
  readonly note: string
  readonly platformUid?: string | undefined
  readonly proxyId?: string | null | undefined
  readonly region?: string | undefined
  readonly secret: string
  readonly resourceSecrets?: Readonly<Record<string, string>> | undefined
  readonly status: OperationAccountStatus
  readonly tags: readonly string[]
  readonly totp?: string | undefined
}

export type AccountUpdateInput = {
  readonly app?: OperationAccountApp | null | undefined
  readonly backupType?: OperationAccountBackupType | null | undefined
  readonly deviceId?: string | null | undefined
  readonly deviceInstanceId?: string | null | undefined
  readonly identifier?: string | undefined
  readonly name?: string | undefined
  readonly avatar?: string | undefined
  readonly extra?: Readonly<Record<string, unknown>> | undefined
  readonly favorite?: number | null | undefined
  readonly follower?: number | null | undefined
  readonly following?: number | null | undefined
  readonly note?: string | undefined
  readonly platformUid?: string | undefined
  readonly proxyId?: string | null | undefined
  readonly region?: string | undefined
  readonly resourceSecrets?: Readonly<Record<string, string>> | undefined
  readonly secret?: string | undefined
  readonly status?: OperationAccountStatus | undefined
  readonly tags?: readonly string[] | undefined
  readonly totp?: string | undefined
}

export type AccountListFilter = {
  readonly app?: OperationAccountApp | undefined
  readonly backupType?: OperationAccountBackupType | undefined
  readonly deleted?: boolean | undefined
  readonly deviceId?: string | undefined
  readonly favorite?: boolean | undefined
  readonly groupId: GroupId
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

export type AccountPage = {
  readonly items: readonly OperationAccount[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

export type AccountTagBatchMode = "add" | "replace" | "clear"

export interface AccountRepository {
  assignProxy(
    groupId: GroupId,
    ids: readonly OperationAccountId[],
    proxyId: string | null,
  ): Promise<number>
  create(
    input: Omit<AccountCreateInput, "secret" | "totp"> & {
      readonly encryptedSecret: string
      readonly encryptedTotp: string
    },
  ): Promise<StoredOperationAccount>
  delete(groupId: GroupId, ids: readonly OperationAccountId[]): Promise<number>
  find(groupId: GroupId, accountId: OperationAccountId): Promise<StoredOperationAccount | null>
  iterate(filter: Omit<AccountListFilter, "page" | "pageSize">): AsyncIterable<OperationAccount>
  list(filter: AccountListFilter): Promise<AccountPage>
  recycle(groupId: GroupId, ids: readonly OperationAccountId[]): Promise<number>
  restore(groupId: GroupId, ids: readonly OperationAccountId[]): Promise<number>
  update(
    groupId: GroupId,
    accountId: OperationAccountId,
    input: AccountUpdateInput & {
      readonly encryptedSecret?: string
      readonly encryptedTotp?: string
    },
  ): Promise<StoredOperationAccount | null>
  updateTags(
    groupId: GroupId,
    ids: readonly OperationAccountId[],
    mode: AccountTagBatchMode,
    tags: readonly string[],
  ): Promise<number>
}

export class AccountBindingError extends Error {
  public constructor() {
    super("Account device or proxy binding is invalid")
    this.name = "AccountBindingError"
  }
}

class AccountPersistenceError extends Error {
  public constructor() {
    super("Operation account insert did not return a record")
    this.name = "AccountPersistenceError"
  }
}

type AccountRow = {
  readonly app: string | null
  readonly avatar: string
  readonly backupKey: string
  readonly backupSlot: string
  readonly backupType: string | null
  readonly createdAt: Date
  readonly deleted: boolean
  readonly deletedAt: Date | null
  readonly deviceId: string | null
  readonly deviceInstanceId: string | null
  readonly deviceName: string | null
  readonly encryptedSecret: string
  readonly encryptedTotp: string
  readonly encryptedTransferKey: string
  readonly extra: Readonly<Record<string, unknown>> | null
  readonly favorite: number | string | null
  readonly follower: number | string | null
  readonly following: number | string | null
  readonly groupId: string
  readonly id: string
  readonly identifier: string
  readonly instanceLabel: string | null
  readonly name: string
  readonly note: string
  readonly online: boolean
  readonly platformUid: string
  readonly proxyId: string | null
  readonly proxyName: string | null
  readonly region: string
  readonly status: string
  readonly tags: readonly string[]
  readonly transferred: boolean
  readonly updatedAt: Date
}

const listColumns = (client: Sql) => client`
  a.id, a.group_id as "groupId", a.name, a.identifier, a.platform_uid as "platformUid",
  a.encrypted_secret as "encryptedSecret", a.encrypted_totp as "encryptedTotp",
  a.encrypted_transfer_key as "encryptedTransferKey", a.note, a.tags, a.status, a.app,
  a.online, a.transferred, a.follower, a.following, a.favorite, a.avatar, a.region, a.extra,
  a.device_id as "deviceId", a.device_instance_id as "deviceInstanceId", a.proxy_id as "proxyId",
  a.backup_type as "backupType", a.backup_key as "backupKey", a.backup_slot as "backupSlot",
  a.deleted, a.deleted_at as "deletedAt", a.created_at as "createdAt", a.updated_at as "updatedAt",
  d.name as "deviceName", i.label as "instanceLabel", p.name as "proxyName"
`

const toCount = (value: number | string | null): number | null => {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const extraRecord = (value: AccountRow["extra"]): Readonly<Record<string, unknown>> =>
  value === null || typeof value !== "object" || Array.isArray(value) ? {} : value

const toStored = (row: AccountRow): StoredOperationAccount => {
  const hasPassword = row.encryptedSecret.length > 0
  return {
    app: row.app === null ? null : OperationAccountAppSchema.parse(row.app),
    avatar: row.avatar,
    backupKey: row.backupKey,
    backupSlot: row.backupSlot,
    backupType:
      row.backupType === null ? null : OperationAccountBackupTypeSchema.parse(row.backupType),
    createdAt: row.createdAt,
    credentialState: hasPassword ? "configured" : "none",
    deleted: row.deleted,
    deletedAt: row.deletedAt,
    deviceId: row.deviceId,
    deviceInstanceId: row.deviceInstanceId,
    deviceName: row.deviceName,
    encryptedSecret: row.encryptedSecret,
    encryptedTotp: row.encryptedTotp,
    encryptedTransferKey: row.encryptedTransferKey,
    extra: extraRecord(row.extra),
    favorite: toCount(row.favorite),
    follower: toCount(row.follower),
    following: toCount(row.following),
    groupId: z.string().uuid().brand<"GroupId">().parse(row.groupId),
    hasPassword,
    hasTotp: row.encryptedTotp.length > 0,
    hasTransferKey: row.encryptedTransferKey.length > 0,
    id: OperationAccountIdSchema.parse(row.id),
    identifier: row.identifier,
    instanceLabel: row.instanceLabel,
    name: row.name,
    note: row.note,
    online: row.online,
    platformUid: row.platformUid,
    proxyId: row.proxyId,
    proxyName: row.proxyName,
    region: row.region,
    status: OperationAccountStatusSchema.parse(row.status),
    tags: row.tags,
    transferred: row.transferred,
    updatedAt: row.updatedAt,
  }
}

export const toPublicAccount = ({
  encryptedSecret: _encryptedSecret,
  encryptedTotp: _encryptedTotp,
  encryptedTransferKey: _encryptedTransferKey,
  extra,
  ...account
}: StoredOperationAccount): OperationAccount => ({
  ...account,
  extra: Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "sealed")),
})

const escapeLike = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")

const filteredFrom = (client: Sql, filter: Omit<AccountListFilter, "page" | "pageSize">) => {
  const deleted = filter.deleted ?? false
  const query =
    filter.query === undefined || filter.query.length === 0
      ? undefined
      : `%${escapeLike(filter.query)}%`
  return client`
    from operation_account a
    left join device d on d.id = a.device_id
    left join device_instance i on i.id = a.device_instance_id
    left join operation_proxy p on p.id = a.proxy_id
    where a.group_id = ${filter.groupId}
      and a.deleted = ${deleted}
      ${filter.app === undefined ? client`` : client`and a.app = ${filter.app}`}
      ${filter.backupType === undefined ? client`` : client`and a.backup_type = ${filter.backupType}`}
      ${filter.deviceId === undefined ? client`` : client`and a.device_id = ${filter.deviceId}`}
      ${filter.status === undefined ? client`` : client`and a.status = ${filter.status}`}
      ${filter.tag === undefined ? client`` : client`and ${filter.tag} = any(a.tags)`}
      ${filter.online === undefined ? client`` : client`and a.online = ${filter.online}`}
      ${filter.hasPassword === undefined ? client`` : filter.hasPassword ? client`and length(a.encrypted_secret) > 0` : client`and length(a.encrypted_secret) = 0`}
      ${filter.hasTotp === undefined ? client`` : filter.hasTotp ? client`and length(a.encrypted_totp) > 0` : client`and length(a.encrypted_totp) = 0`}
      ${filter.hasProxy === undefined ? client`` : filter.hasProxy ? client`and a.proxy_id is not null` : client`and a.proxy_id is null`}
      ${filter.noUsername === true ? client`and a.identifier = ''` : client``}
      ${filter.favorite === true ? client`and ${FavoriteAccountTag} = any(a.tags)` : client``}
      ${
        query === undefined
          ? client``
          : client`and (
        a.identifier ilike ${query} escape '\\'
        or a.platform_uid ilike ${query} escape '\\'
        or a.note ilike ${query} escape '\\'
        or a.region ilike ${query} escape '\\'
        or a.name ilike ${query} escape '\\'
      )`
      }
  `
}

const resolveBinding = async (
  client: Sql,
  groupId: GroupId,
  deviceId: string | null,
  deviceInstanceId: string | null,
  proxyId: string | null,
): Promise<{
  readonly deviceId: string | null
  readonly deviceInstanceId: string | null
  readonly online: boolean | undefined
  readonly proxyId: string | null
}> => {
  let nextDeviceId = deviceId
  let nextOnline: boolean | undefined
  if (deviceInstanceId !== null) {
    const instances = await client<{ readonly deviceId: string; readonly status: string }[]>`
      select instance.device_id as "deviceId", instance.status
      from device_instance instance
      join device on device.id = instance.device_id
      where instance.id = ${deviceInstanceId} and device.group_id = ${groupId}
    `
    const instance = instances[0]
    if (instance === undefined) throw new AccountBindingError()
    if (nextDeviceId !== null && nextDeviceId !== instance.deviceId) throw new AccountBindingError()
    nextDeviceId = instance.deviceId
    nextOnline = instance.status === "online"
  }
  if (nextDeviceId !== null) {
    const devices = await client<{ readonly id: string }[]>`
      select id from device where id = ${nextDeviceId} and group_id = ${groupId}
    `
    if (devices[0] === undefined) throw new AccountBindingError()
  }
  if (proxyId !== null) {
    const proxies = await client<{ readonly id: string }[]>`
      select id from operation_proxy where id = ${proxyId} and group_id = ${groupId}
    `
    if (proxies[0] === undefined) throw new AccountBindingError()
  }
  return {
    deviceId: nextDeviceId,
    deviceInstanceId,
    online: nextOnline,
    proxyId,
  }
}

const lockAccounts = async (
  transaction: Sql | TransactionSql,
  groupId: GroupId,
  ids: readonly OperationAccountId[],
  deleted?: boolean,
): Promise<readonly string[]> => {
  const locked = await transaction<{ readonly id: string }[]>`
    select id from operation_account
    where group_id = ${groupId} and id = any(${ids})
      ${deleted === undefined ? transaction`` : transaction`and deleted = ${deleted}`}
    for update
  `
  return locked.map((row) => row.id)
}

const uniqueTags = (tags: readonly string[]): readonly string[] => [
  ...new Set(tags.filter((tag) => tag.length > 0)),
]

const fetchAccount = async (
  client: Sql,
  groupId: GroupId,
  accountId: string,
): Promise<StoredOperationAccount | null> => {
  const rows = await client<AccountRow[]>`
    select ${listColumns(client)}
    from operation_account a
    left join device d on d.id = a.device_id
    left join device_instance i on i.id = a.device_instance_id
    left join operation_proxy p on p.id = a.proxy_id
    where a.group_id = ${groupId} and a.id = ${accountId}
  `
  const row = rows[0]
  return row === undefined ? null : toStored(row)
}

export const createPostgresAccountRepository = (client: Sql): AccountRepository => {
  const list = async (filter: AccountListFilter): Promise<AccountPage> => {
    const from = filteredFrom(client, filter)
    const totals = await client<{ readonly count: number }[]>`select count(*)::int as count ${from}`
    const offset = (filter.page - 1) * filter.pageSize
    const rows = await client<AccountRow[]>`
      select ${listColumns(client)} ${from}
      order by a.created_at desc, a.id desc
      limit ${filter.pageSize} offset ${offset}
    `
    return {
      items: rows.map(toStored).map(toPublicAccount),
      page: filter.page,
      pageSize: filter.pageSize,
      total: totals[0]?.count ?? 0,
    }
  }
  return {
    assignProxy: async (groupId, ids, proxyId) => {
      if (ids.length === 0) return 0
      if (proxyId !== null) await resolveBinding(client, groupId, null, null, proxyId)
      const rows = await client<{ readonly id: string }[]>`
      update operation_account
      set proxy_id = ${proxyId}, updated_at = now()
      where group_id = ${groupId} and id = any(${ids}) and deleted = false
      returning id
    `
      return rows.length
    },
    create: async (input) => {
      const binding = await resolveBinding(
        client,
        input.groupId,
        input.deviceId ?? null,
        input.deviceInstanceId ?? null,
        input.proxyId ?? null,
      )
      const rows = await client<{ readonly id: string }[]>`
      insert into operation_account (
        group_id, name, identifier, encrypted_secret, encrypted_totp, note, tags, status, app,
        platform_uid, online, region, device_id, device_instance_id, proxy_id, backup_type,
        follower, following, avatar, favorite, extra
      )
      values (
        ${input.groupId}, ${input.name}, ${input.identifier}, ${input.encryptedSecret},
        ${input.encryptedTotp}, ${input.note}, ${input.tags}, ${input.status}, ${input.app ?? null},
        ${input.platformUid ?? ""}, ${binding.online ?? false}, ${input.region ?? ""}, ${binding.deviceId},
        ${binding.deviceInstanceId}, ${binding.proxyId}, ${input.backupType ?? null},
        ${input.follower ?? null}, ${input.following ?? null}, ${input.avatar ?? ""},
        ${input.favorite ?? null}, ${client.json(z.json().parse(input.extra ?? {}))}
      )
      returning id
    `
      const row = rows[0]
      if (row === undefined) throw new AccountPersistenceError()
      const stored = await fetchAccount(client, input.groupId, row.id)
      if (stored === null) throw new AccountPersistenceError()
      return stored
    },
    delete: async (groupId, ids) => {
      if (ids.length === 0) return 0
      return client.begin(async (transaction) => {
        const entityIds = await lockAccounts(transaction, groupId, ids, true)
        await assertNoActiveTaskClaims(transaction, groupId, "account", entityIds)
        await assertNoActiveAccountLeases(transaction, groupId, entityIds)
        await assertNoActiveAccountResourceAllocations(transaction, groupId, entityIds)
        const rows = await transaction<{ readonly id: string }[]>`
        delete from operation_account where group_id = ${groupId} and id = any(${entityIds}) and deleted = true returning id
      `
        return rows.length
      })
    },
    find: async (groupId, accountId) => fetchAccount(client, groupId, accountId),
    iterate: async function* (filter) {
      let page = 1
      const pageSize = 100
      while (true) {
        const pageResult = await list({ ...filter, page, pageSize })
        for (const item of pageResult.items) yield item
        if (pageResult.items.length < pageSize) return
        page += 1
      }
    },
    list,
    recycle: async (groupId, ids) => {
      if (ids.length === 0) return 0
      return client.begin(async (transaction) => {
        const entityIds = await lockAccounts(transaction, groupId, ids, false)
        await assertNoActiveTaskClaims(transaction, groupId, "account", entityIds)
        await assertNoActiveAccountLeases(transaction, groupId, entityIds)
        await assertNoActiveAccountResourceAllocations(transaction, groupId, entityIds)
        const rows = await transaction<{ readonly id: string }[]>`
        update operation_account
        set deleted = true, deleted_at = now(), updated_at = now()
        where group_id = ${groupId} and id = any(${entityIds}) and deleted = false
        returning id
      `
        return rows.length
      })
    },
    restore: async (groupId, ids) => {
      if (ids.length === 0) return 0
      const rows = await client<{ readonly id: string }[]>`
      update operation_account
      set deleted = false, deleted_at = null, updated_at = now()
      where group_id = ${groupId} and id = any(${ids}) and deleted = true
      returning id
    `
      return rows.length
    },
    update: async (groupId, accountId, input) => {
      const existing = await client<AccountRow[]>`
      select ${listColumns(client)}
      from operation_account a
      left join device d on d.id = a.device_id
      left join device_instance i on i.id = a.device_instance_id
      left join operation_proxy p on p.id = a.proxy_id
      where a.group_id = ${groupId} and a.id = ${accountId}
    `
      const current = existing[0]
      if (current === undefined) return null
      const stored = toStored(current)
      const binding = await resolveBinding(
        client,
        groupId,
        input.deviceId === undefined ? stored.deviceId : input.deviceId,
        input.deviceInstanceId === undefined ? stored.deviceInstanceId : input.deviceInstanceId,
        input.proxyId === undefined ? stored.proxyId : input.proxyId,
      )
      const next = {
        app: input.app === undefined ? stored.app : input.app,
        backupType: input.backupType === undefined ? stored.backupType : input.backupType,
        encryptedSecret: input.encryptedSecret ?? stored.encryptedSecret,
        encryptedTotp: input.encryptedTotp ?? stored.encryptedTotp,
        identifier: input.identifier ?? stored.identifier,
        name: input.name ?? stored.name,
        avatar: input.avatar ?? stored.avatar,
        extra: input.extra ?? stored.extra,
        favorite: input.favorite === undefined ? stored.favorite : input.favorite,
        follower: input.follower === undefined ? stored.follower : input.follower,
        following: input.following === undefined ? stored.following : input.following,
        note: input.note ?? stored.note,
        online: binding.online ?? stored.online,
        platformUid: input.platformUid ?? stored.platformUid,
        region: input.region ?? stored.region,
        status: input.status ?? stored.status,
        tags: input.tags ?? stored.tags,
      }
      const updated = await client<{ readonly id: string }[]>`
      update operation_account set
        name = ${next.name},
        identifier = ${next.identifier},
        encrypted_secret = ${next.encryptedSecret},
        encrypted_totp = ${next.encryptedTotp},
        note = ${next.note},
        tags = ${next.tags},
        status = ${next.status},
        app = ${next.app},
        platform_uid = ${next.platformUid},
        follower = ${next.follower},
        following = ${next.following},
        avatar = ${next.avatar},
        favorite = ${next.favorite},
        extra = ${client.json(z.json().parse(next.extra))},
        online = ${next.online},
        region = ${next.region},
        device_id = ${binding.deviceId},
        device_instance_id = ${binding.deviceInstanceId},
        proxy_id = ${binding.proxyId},
        backup_type = ${next.backupType},
        updated_at = now()
      where group_id = ${groupId} and id = ${accountId}
      returning id
    `
      return updated[0] === undefined ? null : fetchAccount(client, groupId, accountId)
    },
    updateTags: async (groupId, ids, mode, tags) => {
      if (ids.length === 0) return 0
      const nextTags = uniqueTags(tags)
      const rows = await client<{ readonly id: string }[]>`
      update operation_account
      set tags = ${
        mode === "clear"
          ? client`'{}'::text[]`
          : mode === "replace"
            ? client`${nextTags}`
            : client`(
                select coalesce(array_agg(distinct tag), '{}'::text[])
                from unnest(coalesce(tags, '{}'::text[]) || ${nextTags}::text[]) as tag
              )`
      },
      updated_at = now()
      where group_id = ${groupId} and id = any(${ids}) and deleted = false
      returning id
    `
      return rows.length
    },
  }
}
