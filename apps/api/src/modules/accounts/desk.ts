import type { Sql, TransactionSql } from "postgres"

import type { GroupId } from "../../lib/authorization"
import {
  assertNoActiveAccountLeases,
  assertNoActiveAccountResourceAllocations,
  OperationDeleteConflictError,
} from "../../lib/operation-claim-guard"

export class AccountDeskError extends Error {
  public constructor(
    readonly reason: "confirm_required" | "invalid_binding" | "invalid_transfer" | "not_found" | "transfer_conflict",
  ) {
    super(reason)
    this.name = "AccountDeskError"
  }
}

export type AccountStatisticRow = {
  readonly available: number
  readonly banned: number
  readonly online: number
  readonly tag: string
  readonly total: number
  readonly transferred: number
}

export type AccountFacetDevice = {
  readonly host: string
  readonly id: string
  readonly instances: readonly { readonly id: string; readonly index: number; readonly label: string }[]
  readonly name: string
}

export type AccountFacets = {
  readonly devices: readonly AccountFacetDevice[]
  readonly groups: readonly { readonly count: number; readonly tag: string }[]
  readonly statuses: readonly ["ready", "suspended", "disabled", "expired", "hidden", "unregistered"]
}

export type AccountTransferView = {
  readonly accountIds: readonly string[]
  readonly code: string
  readonly count: number
  readonly encryptedCode: string
  readonly tags: readonly string[]
}

export type AccountCodeSeal = {
  readonly encryptedCode: string
  readonly hash: string
}

const activeTaskStatuses = ["queued", "dispatching", "running", "ood", "needs_reconciliation"]

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "23505"

const groupTagSql = (client: Sql | TransactionSql) => client`coalesce(a.tags[1], '')`

const replaceGroupTag = (client: Sql | TransactionSql, tag: string) => client`
  case
    when ${tag} = '' and coalesce(cardinality(a.tags[2:2147483647]), 0) = 0 then '{}'::text[]
    else array[${tag}]::text[] || coalesce(a.tags[2:2147483647], '{}'::text[])
  end
`

const assertTransferIdle = async (
  transaction: TransactionSql,
  groupId: string,
  accountIds: readonly string[],
): Promise<void> => {
  await assertNoActiveAccountLeases(transaction, groupId, accountIds)
  await assertNoActiveAccountResourceAllocations(transaction, groupId, accountIds)
  const tasks = await transaction<{ readonly id: string }[]>`
    select id from execution_task
    where account_id = any(${accountIds}::uuid[])
      and status::text = any(${activeTaskStatuses}::text[])
    limit 1
  `
  if (tasks[0] !== undefined) throw new OperationDeleteConflictError()
}

const detachAccounts = async (
  transaction: TransactionSql,
  accountIds: readonly string[],
): Promise<void> => {
  if (accountIds.length === 0) return
  await transaction`
    delete from operation_account_transfer_item where account_id = any(${accountIds}::uuid[])
  `
  await transaction`
    update operation_account_transfer
    set status = 'revoked', revoked_at = now()
    where status = 'active'
      and not exists (
        select 1 from operation_account_transfer_item item
        where item.transfer_id = operation_account_transfer.id
      )
  `
}

const insertTransfer = async (
  transaction: TransactionSql,
  groupId: GroupId,
  actorId: string,
  seal: AccountCodeSeal,
  accountIds: readonly string[],
  splitSize: number | null,
): Promise<void> => {
  const rows = await transaction<{ readonly id: string }[]>`
    insert into operation_account_transfer (group_id, created_by, code_hash, encrypted_code, split_size)
    values (${groupId}, ${actorId}, ${seal.hash}, ${seal.encryptedCode}, ${splitSize})
    returning id
  `
  const transferId = rows[0]?.id
  if (transferId === undefined) throw new AccountDeskError("invalid_transfer")
  for (const [position, accountId] of accountIds.entries()) {
    await transaction`
      insert into operation_account_transfer_item (transfer_id, account_id, position)
      values (${transferId}, ${accountId}, ${position})
    `
  }
  await transaction`
    update operation_account
    set encrypted_transfer_key = ${seal.encryptedCode},
        transfer_key_hash = ${seal.hash},
        updated_at = now()
    where id = any(${accountIds}::uuid[])
  `
}

const lockOwnedAccounts = async (
  transaction: TransactionSql,
  groupId: GroupId,
  accountIds: readonly string[],
): Promise<readonly string[]> => {
  const rows = await transaction<{ readonly id: string }[]>`
    select id from operation_account
    where group_id = ${groupId} and deleted = false and id = any(${accountIds}::uuid[])
    order by created_at, id
    for update
  `
  return rows.map((row) => row.id)
}

const accountsForCodes = async (
  transaction: TransactionSql,
  groupId: GroupId,
  hashes: readonly string[],
): Promise<readonly string[]> => {
  const rows = await transaction<{ readonly id: string }[]>`
    select a.id
    from operation_account_transfer transfer
    join operation_account_transfer_item item on item.transfer_id = transfer.id
    join operation_account a on a.id = item.account_id
    where transfer.group_id = ${groupId}
      and transfer.status = 'active'
      and transfer.code_hash = any(${hashes})
      and a.deleted = false
    order by transfer.code_hash, item.position
    for update of a
  `
  return rows.map((row) => row.id)
}

export type AccountDesk = {
  assignTransfer(
    groupId: GroupId,
    actorId: string,
    accountIds: readonly string[],
    seal: AccountCodeSeal,
  ): Promise<number>
  deleteByTag(groupId: GroupId, tag: string, bannedOnly: boolean): Promise<readonly string[]>
  facets(groupId: GroupId): Promise<AccountFacets>
  listTransfers(groupId: GroupId): Promise<readonly AccountTransferView[]>
  mergeTransfers(
    groupId: GroupId,
    actorId: string,
    hashes: readonly string[],
    seal: AccountCodeSeal,
  ): Promise<number>
  moveGroupTags(groupId: GroupId, oldTags: readonly string[], newTag: string): Promise<number>
  redeemTransfer(groupId: GroupId, hash: string): Promise<number>
  resetBanned(groupId: GroupId, tag: string): Promise<number>
  revokeTransfer(groupId: GroupId, hash: string): Promise<number>
  setFavorite(groupId: GroupId, accountIds: readonly string[], starred: boolean): Promise<number>
  setGroupTag(groupId: GroupId, accountIds: readonly string[], tag: string): Promise<number>
  setNote(groupId: GroupId, accountIds: readonly string[], note: string): Promise<number>
  setRegion(groupId: GroupId, accountIds: readonly string[], region: string): Promise<number>
  splitTransfer(
    groupId: GroupId,
    actorId: string,
    hash: string,
    size: number,
    seals: readonly AccountCodeSeal[],
  ): Promise<number>
  startAccount(
    groupId: GroupId,
    accountId: string,
    deviceId: string,
    deviceInstanceId: string,
    proxyId: string | null,
  ): Promise<boolean>
  statistics(groupId: GroupId): Promise<readonly AccountStatisticRow[]>
}

export const createAccountDesk = (client: Sql): AccountDesk => ({
  assignTransfer: (groupId, actorId, accountIds, seal) =>
    client.begin(async (transaction) => {
      const locked = await lockOwnedAccounts(transaction, groupId, accountIds)
      if (locked.length !== accountIds.length) throw new AccountDeskError("not_found")
      await detachAccounts(transaction, locked)
      try {
        await insertTransfer(transaction, groupId, actorId, seal, locked, null)
      } catch (error) {
        if (isUniqueViolation(error)) throw new AccountDeskError("transfer_conflict")
        throw error
      }
      return locked.length
    }),
  deleteByTag: async (groupId, tag, bannedOnly) => {
    const rows = await client<{ readonly id: string }[]>`
      select a.id from operation_account a
      where a.group_id = ${groupId} and a.deleted = false
        and ${groupTagSql(client)} = ${tag}
        and (${!bannedOnly} or a.status = 'suspended')
    `
    return rows.map((row) => row.id)
  },
  facets: async (groupId) => {
    const groups = await client<{ readonly count: number; readonly tag: string }[]>`
      select coalesce(tags[1], '') as tag, count(*)::int as count
      from operation_account
      where group_id = ${groupId} and deleted = false
      group by 1
      order by 2 desc, 1
    `
    const rows = await client<
      {
        readonly host: string
        readonly id: string
        readonly instanceId: string | null
        readonly instanceIndex: number | null
        readonly label: string | null
        readonly name: string
      }[]
    >`
      select device.id, device.name, device.host,
        instance.id as "instanceId", instance.instance_index as "instanceIndex", instance.label
      from device
      left join device_instance instance on instance.device_id = device.id
      where device.group_id = ${groupId}
      order by device.name, instance.instance_index
    `
    const devices = new Map<string, AccountFacetDevice>()
    for (const row of rows) {
      const current = devices.get(row.id) ?? {
        host: row.host,
        id: row.id,
        instances: [],
        name: row.name,
      }
      if (row.instanceId !== null && row.instanceIndex !== null) {
        devices.set(row.id, {
          ...current,
          instances: [
            ...current.instances,
            { id: row.instanceId, index: row.instanceIndex, label: row.label ?? "" },
          ],
        })
      } else {
        devices.set(row.id, current)
      }
    }
    return {
      devices: [...devices.values()],
      groups,
      statuses: ["ready", "suspended", "disabled", "expired", "hidden", "unregistered"],
    }
  },
  listTransfers: async (groupId) => {
    const rows = await client<
      {
        readonly accountId: string
        readonly encryptedCode: string
        readonly hash: string
        readonly tag: string
      }[]
    >`
      select transfer.code_hash as hash, transfer.encrypted_code as "encryptedCode",
        a.id as "accountId", coalesce(a.tags[1], '') as tag
      from operation_account_transfer transfer
      join operation_account_transfer_item item on item.transfer_id = transfer.id
      join operation_account a on a.id = item.account_id
      where transfer.group_id = ${groupId} and transfer.status = 'active' and a.deleted = false
      order by transfer.created_at, item.position
    `
    const grouped = new Map<string, AccountTransferView>()
    for (const row of rows) {
      const current = grouped.get(row.hash) ?? {
        accountIds: [],
        code: row.encryptedCode,
        count: 0,
        encryptedCode: row.encryptedCode,
        tags: [],
      }
      grouped.set(row.hash, {
        ...current,
        accountIds: [...current.accountIds, row.accountId],
        count: current.count + 1,
        tags: current.tags.includes(row.tag) ? current.tags : [...current.tags, row.tag],
      })
    }
    return [...grouped.values()]
  },
  mergeTransfers: (groupId, actorId, hashes, seal) =>
    client.begin(async (transaction) => {
      const accountIds = await accountsForCodes(transaction, groupId, hashes)
      if (accountIds.length === 0) throw new AccountDeskError("invalid_transfer")
      await detachAccounts(transaction, accountIds)
      try {
        await insertTransfer(transaction, groupId, actorId, seal, accountIds, null)
      } catch (error) {
        if (isUniqueViolation(error)) throw new AccountDeskError("transfer_conflict")
        throw error
      }
      return accountIds.length
    }),
  moveGroupTags: async (groupId, oldTags, newTag) => {
    if (oldTags.length === 0) return 0
    const rows = await client<{ readonly id: string }[]>`
      update operation_account a
      set tags = ${replaceGroupTag(client, newTag)}, updated_at = now()
      where a.group_id = ${groupId} and a.deleted = false
        and ${groupTagSql(client)} = any(${oldTags}::text[])
      returning a.id
    `
    return rows.length
  },
  redeemTransfer: (groupId, hash) =>
    client.begin(async (transaction) => {
      const transfers = await transaction<{ readonly groupId: string; readonly id: string }[]>`
        select id, group_id as "groupId" from operation_account_transfer
        where code_hash = ${hash} and status = 'active'
        for update
      `
      const transfer = transfers[0]
      if (transfer === undefined) throw new AccountDeskError("invalid_transfer")
      const accounts = await transaction<{ readonly id: string }[]>`
        select a.id
        from operation_account_transfer_item item
        join operation_account a on a.id = item.account_id
        where item.transfer_id = ${transfer.id} and a.deleted = false
        for update of a
      `
      const accountIds = accounts.map((row) => row.id)
      if (accountIds.length === 0) throw new AccountDeskError("invalid_transfer")
      await assertTransferIdle(transaction, transfer.groupId, accountIds)
      try {
        await transaction`
          update operation_account
          set group_id = ${groupId},
              encrypted_transfer_key = '',
              transfer_key_hash = null,
              updated_at = now()
          where id = any(${accountIds}::uuid[])
        `
      } catch (error) {
        if (isUniqueViolation(error)) throw new AccountDeskError("transfer_conflict")
        throw error
      }
      await transaction`
        update operation_account_transfer
        set status = 'consumed', consumed_at = now()
        where id = ${transfer.id}
      `
      return accountIds.length
    }),
  resetBanned: async (groupId, tag) => {
    const rows = await client<{ readonly id: string }[]>`
      update operation_account a
      set status = 'ready', updated_at = now()
      where a.group_id = ${groupId} and a.deleted = false and a.status = 'suspended'
        and ${groupTagSql(client)} = ${tag}
      returning a.id
    `
    return rows.length
  },
  revokeTransfer: (groupId, hash) =>
    client.begin(async (transaction) => {
      const transfers = await transaction<{ readonly id: string }[]>`
        select id from operation_account_transfer
        where group_id = ${groupId} and code_hash = ${hash} and status = 'active'
        for update
      `
      const transfer = transfers[0]
      if (transfer === undefined) throw new AccountDeskError("invalid_transfer")
      const accounts = await transaction<{ readonly id: string }[]>`
        select account_id as id from operation_account_transfer_item where transfer_id = ${transfer.id}
      `
      const accountIds = accounts.map((row) => row.id)
      await transaction`
        update operation_account
        set encrypted_transfer_key = '', transfer_key_hash = null, updated_at = now()
        where id = any(${accountIds}::uuid[]) and transfer_key_hash = ${hash}
      `
      await transaction`
        update operation_account_transfer
        set status = 'revoked', revoked_at = now()
        where id = ${transfer.id}
      `
      return accountIds.length
    }),
  setFavorite: async (groupId, accountIds, starred) => {
    if (accountIds.length === 0) return 0
    const rows = await client<{ readonly id: string }[]>`
      update operation_account
      set favorite = ${starred ? 1 : null}, updated_at = now()
      where group_id = ${groupId} and deleted = false and id = any(${accountIds}::uuid[])
      returning id
    `
    return rows.length
  },
  setGroupTag: async (groupId, accountIds, tag) => {
    if (accountIds.length === 0) return 0
    const rows = await client<{ readonly id: string }[]>`
      update operation_account a
      set tags = ${replaceGroupTag(client, tag)}, updated_at = now()
      where a.group_id = ${groupId} and a.deleted = false and a.id = any(${accountIds}::uuid[])
      returning a.id
    `
    return rows.length
  },
  setNote: async (groupId, accountIds, note) => {
    if (accountIds.length === 0) return 0
    const rows = await client<{ readonly id: string }[]>`
      update operation_account
      set note = ${note}, updated_at = now()
      where group_id = ${groupId} and deleted = false and id = any(${accountIds}::uuid[])
      returning id
    `
    return rows.length
  },
  setRegion: async (groupId, accountIds, region) => {
    if (accountIds.length === 0) return 0
    const rows = await client<{ readonly id: string }[]>`
      update operation_account
      set region = ${region}, updated_at = now()
      where group_id = ${groupId} and deleted = false and id = any(${accountIds}::uuid[])
      returning id
    `
    return rows.length
  },
  splitTransfer: (groupId, actorId, hash, size, seals) =>
    client.begin(async (transaction) => {
      const accounts = await transaction<{ readonly id: string }[]>`
        select a.id
        from operation_account_transfer transfer
        join operation_account_transfer_item item on item.transfer_id = transfer.id
        join operation_account a on a.id = item.account_id
        where transfer.group_id = ${groupId}
          and transfer.status = 'active'
          and transfer.code_hash = ${hash}
          and a.deleted = false
        order by item.position
        for update of a
      `
      const accountIds = accounts.map((row) => row.id)
      if (accountIds.length === 0 || size >= accountIds.length) throw new AccountDeskError("invalid_transfer")
      const chunks: string[][] = []
      for (let offset = 0; offset < accountIds.length; offset += size) {
        chunks.push(accountIds.slice(offset, offset + size))
      }
      if (chunks.length !== seals.length) throw new AccountDeskError("invalid_transfer")
      await detachAccounts(transaction, accountIds)
      try {
        for (const [index, chunk] of chunks.entries()) {
          const seal = seals[index]
          if (seal === undefined) throw new AccountDeskError("invalid_transfer")
          await insertTransfer(transaction, groupId, actorId, seal, chunk, size)
        }
      } catch (error) {
        if (isUniqueViolation(error)) throw new AccountDeskError("transfer_conflict")
        throw error
      }
      return chunks.length
    }),
  startAccount: async (groupId, accountId, deviceId, deviceInstanceId, proxyId) => {
    const instances = await client<{ readonly deviceId: string }[]>`
      select instance.device_id as "deviceId"
      from device_instance instance
      join device on device.id = instance.device_id
      where instance.id = ${deviceInstanceId} and device.group_id = ${groupId} and device.id = ${deviceId}
    `
    if (instances[0] === undefined) throw new AccountDeskError("invalid_binding")
    if (proxyId !== null) {
      const proxies = await client<{ readonly id: string }[]>`
        select id from operation_proxy where id = ${proxyId} and group_id = ${groupId}
      `
      if (proxies[0] === undefined) throw new AccountDeskError("invalid_binding")
    }
    const rows = await client<{ readonly id: string }[]>`
      update operation_account
      set device_id = ${deviceId},
          device_instance_id = ${deviceInstanceId},
          proxy_id = ${proxyId},
          updated_at = now()
      where id = ${accountId} and group_id = ${groupId} and deleted = false
      returning id
    `
    return rows[0] !== undefined
  },
  statistics: (groupId) => client<AccountStatisticRow[]>`
    select coalesce(a.tags[1], '') as tag,
      count(*)::int as total,
      count(*) filter (where a.status = 'suspended')::int as banned,
      count(*) filter (where a.online)::int as online,
      count(*) filter (where a.transferred)::int as transferred,
      count(*) filter (where a.status = 'ready' and a.transferred = false)::int as available
    from operation_account a
    where a.group_id = ${groupId} and a.deleted = false
    group by 1
    order by 1
  `,
})
