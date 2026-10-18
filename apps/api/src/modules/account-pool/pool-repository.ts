import type { Sql, TransactionSql } from "postgres"
import { z } from "zod"

import type { SecretCipher } from "../../lib/crypto"
import { countDeskAccounts, listDeskAccounts, prepareDeskPool, readDeskQuery } from "./desk-pool"
import {
  type AccountPool,
  type PoolConsume,
  type PoolDetails,
  type PoolDevice,
  PoolError,
  type PoolListFilter,
  type PoolSourceAccount,
  type PoolSourceFilter,
  type PoolWrite,
} from "./pool-model"

type QuerySql = Sql | TransactionSql
type PoolRow = {
  id: string
  display_id: string
  group_id: string
  created_by_user_id: string
  key: string
  remark: string
  back_type: AccountPool["backType"]
  device_id: string | null
  device_seq: number | null
  device_label: string
  times: number
  member_count: number
  filter_condition: AccountPool["filterCondition"]
  created_at: Date
  updated_at: Date
  expires_at: Date
}
type SourceRow = {
  id: string
  device_id: string | null
  device_seq: number | null
  follower: number | null
  following: number | null
  favorite: number | null
  online: boolean
  region: string
  note: string
  status: string
  tags: string[]
  platform_uid: string
  identifier: string
  name: string
  updated_at: Date
  proxy_name: string | null
  extra: Record<string, unknown>
}

const metric = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
const toSource = (row: SourceRow): PoolSourceAccount => ({
  id: row.id,
  deviceId: row.device_id,
  deviceSeq: row.device_seq,
  follower: metric(row.follower),
  following: metric(row.following),
  heart: metric(row.favorite),
  online: row.online,
  playBeforeYesterday: metric(row.extra["playBeforeYesterday"]),
  playToday: metric(row.extra["playToday"]),
  playTotal: metric(row.extra["playTotal"]),
  playYesterday: metric(row.extra["playYesterday"]),
  proxyRemark: row.proxy_name ?? "",
  region: row.region,
  remark: row.note,
  status: row.status === "suspended" ? "1" : "0",
  statisticsState: typeof row.extra["playTotal"] === "number" ? "stored" : "unavailable",
  tag: row.tags[0] ?? "",
  tagBucket: row.tags.slice(1),
  transferred: false,
  uid: row.platform_uid,
  updateTime: row.updated_at.toISOString(),
  username: row.identifier || row.name,
  videoPlays: [
    metric(row.extra["playToday"]),
    metric(row.extra["playYesterday"]),
    metric(row.extra["playBeforeYesterday"]),
  ],
})
const creatorName = async (sql: QuerySql, userId: string): Promise<string> => {
  const rows = await sql<{ name: string }[]>`
    select case when btrim(display_name) <> '' then display_name else email end as name
    from app_user where id = ${userId}`
  return rows[0]?.name ?? ""
}
const toPool = async (sql: QuerySql, row: PoolRow): Promise<AccountPool> => ({
  id: row.id,
  displayId: Number(row.display_id),
  groupId: row.group_id,
  createdByUserId: row.created_by_user_id,
  createdByName: await creatorName(sql, row.created_by_user_id),
  key: row.key,
  remark: row.remark,
  backType: row.back_type,
  deviceId: row.device_id,
  deviceSeq: row.device_seq,
  deviceLabel: row.device_label,
  times: row.times,
  count: row.member_count,
  filterCondition: row.filter_condition,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  expiresAt: row.expires_at,
})
const needsDevice = (type: string) => ["1", "2", "4"].includes(type)

const sourceWhere = (sql: QuerySql, groupId: string, filter: PoolSourceFilter) => sql`
  a.group_id = ${groupId} and a.deleted = false and a.transferred = false
  and a.encrypted_transfer_key = '' and a.status not in ('disabled', 'expired', 'hidden')
  and a.backup_type = ${needsDevice(filter.backType) ? "local" : "private_cloud"}::operation_account_backup_type
  and (${!needsDevice(filter.backType)} or a.device_id = ${filter.deviceId}::uuid)
  and (${filter.deviceSeq}::integer is null or i.instance_index = ${filter.deviceSeq})
  and (${filter.online}::boolean is null or a.online = ${filter.online})
  and (${filter.status === ""} or a.status = ${filter.status === "1" ? "suspended" : "ready"}::operation_account_status)
  and (${filter.tag.length === 0} or a.tags[1] = any(${filter.tag}::text[]))
  and (${filter.tagInclude.length === 0} or
    (${filter.tagQueryMode === "AND"} and a.tags[2:2147483647] @> ${filter.tagInclude}::text[])
    or (${filter.tagQueryMode === "OR"} and a.tags[2:2147483647] && ${filter.tagInclude}::text[]))
  and not (a.tags[2:2147483647] && ${filter.tagExclude}::text[])
`
const sourceRows = async (
  sql: QuerySql,
  groupId: string,
  filter: PoolSourceFilter,
  limit: number,
  offset = 0,
  ids?: readonly string[],
  lock = false,
): Promise<SourceRow[]> =>
  sql<SourceRow[]>`
    select a.id, a.device_id, i.instance_index as device_seq, a.follower, a.following,
      a.favorite, a.online, a.region, a.note, a.status, a.tags, a.platform_uid,
      a.identifier, a.name, a.updated_at, p.name as proxy_name, a.extra
    from operation_account a
    left join device_instance i on i.id = a.device_instance_id
    left join operation_proxy p on p.id = a.proxy_id and p.group_id = a.group_id
    where ${sourceWhere(sql, groupId, filter)}
      and (${ids === undefined} or a.id = any(${ids ?? []}::uuid[]))
    order by a.created_at desc, a.id
    limit ${limit} offset ${offset}
    ${lock ? sql`for share of a` : sql``}
  `

export interface PoolRepository {
  list(
    groupId: string,
    filter: PoolListFilter,
  ): Promise<{
    items: readonly AccountPool[]
    total: number
    page: number
    pageSize: number
  }>
  devices(groupId: string): Promise<readonly PoolDevice[]>
  sources(
    groupId: string,
    filter: PoolSourceFilter,
    page: number,
    pageSize: number,
  ): Promise<{
    items: readonly PoolSourceAccount[]
    total: number
    groups: readonly { tag: string; total: number }[]
  }>
  create(groupId: string, actorId: string, input: PoolWrite): Promise<AccountPool>
  createDesk(groupId: string, actorId: string, input: unknown): Promise<AccountPool>
  details(groupId: string, poolId: string): Promise<PoolDetails>
  remove(groupId: string, actorId: string, ids: readonly string[]): Promise<number>
  consume(groupId: string, actorId: string, poolId: string, input: PoolConsume): Promise<void>
}

const audit = async (sql: QuerySql, actorId: string, action: string, target: string) => {
  await sql`insert into audit_event (id, actor_id, action, outcome, target)
    values (${crypto.randomUUID()}, ${actorId}, ${action}, 'allowed', ${target})`
}

const withDeskCount = async (
  sql: QuerySql,
  cipher: SecretCipher | undefined,
  groupId: string,
  row: PoolRow,
): Promise<AccountPool> => {
  const pool = await toPool(sql, row)
  const query = readDeskQuery(row.filter_condition)
  if (query === null) return pool
  return { ...pool, count: await countDeskAccounts(sql, cipher, groupId, query) }
}

export const createPostgresPoolRepository = (
  client: Sql,
  cipher?: SecretCipher,
): PoolRepository => ({
  list: async (groupId, filter) => {
    const where = () => {
      const creator = client`case when btrim(u.display_name) <> '' then u.display_name else coalesce(u.email, '') end`
      return client`p.group_id = ${groupId} and p.deleted_at is null
        and (${filter.id === ""} or position(${filter.id} in p.display_id::text) > 0)
        and (${filter.key === ""} or position(lower(${filter.key}) in lower(p.key)) > 0
          or position(lower(${filter.key}) in lower(${creator})) > 0)
        and (${filter.remark === ""} or position(lower(${filter.remark}) in lower(p.remark)) > 0)`
    }
    const [rows, counts] = await Promise.all([
      client<PoolRow[]>`select p.* from operation_account_pool p
        left join app_user u on u.id = p.created_by_user_id
        where ${where()}
        order by p.display_id desc limit ${filter.pageSize} offset ${(filter.page - 1) * filter.pageSize}`,
      client<{ total: string }[]>`select count(*) as total from operation_account_pool p
        left join app_user u on u.id = p.created_by_user_id
        where ${where()}`,
    ])
    const items: AccountPool[] = []
    for (const row of rows) items.push(await withDeskCount(client, cipher, groupId, row))
    return {
      items,
      total: Number(counts[0]?.total ?? 0),
      page: filter.page,
      pageSize: filter.pageSize,
    }
  },
  devices: async (groupId) =>
    client<PoolDevice[]>`select id, name, host, coalesce(external_id, '') as serial from device
      where group_id = ${groupId} and assignment_pending = false and enabled = true order by name, id`,
  sources: async (groupId, filter, page, pageSize) => {
    const [rows, counts, groups] = await Promise.all([
      sourceRows(client, groupId, filter, pageSize, (page - 1) * pageSize),
      client<{ total: string }[]>`select count(*) as total from operation_account a
        left join device_instance i on i.id = a.device_instance_id
        where ${sourceWhere(client, groupId, filter)}`,
      client<{ tag: string; total: string }[]>`select a.tags[1] as tag, count(*) as total
        from operation_account a left join device_instance i on i.id = a.device_instance_id
        where ${sourceWhere(client, groupId, { ...filter, tag: [], tagInclude: [], tagExclude: [] })}
          and coalesce(a.tags[1], '') <> '' group by a.tags[1] order by a.tags[1]`,
    ])
    return {
      items: rows.map(toSource),
      total: Number(counts[0]?.total ?? 0),
      groups: groups.map((item) => ({ tag: item.tag, total: Number(item.total) })),
    }
  },
  create: async (groupId, actorId, input) => {
    try {
      return await client.begin(async (tx) => {
        const filter = input.filter
        if (needsDevice(filter.backType)) {
          if (filter.deviceId === null) throw new PoolError("account_pool_invalid_source")
          const device = await tx<{ label: string }[]>`
            select host || '-' || name as label from device where id = ${filter.deviceId}
              and group_id = ${groupId} and enabled = true and assignment_pending = false for share`
          if (device[0] === undefined) throw new PoolError("account_pool_invalid_source")
        } else if (filter.deviceId !== null || filter.deviceSeq !== null) {
          throw new PoolError("account_pool_invalid_source")
        }
        if (filter.backType !== "1" && filter.deviceSeq !== null)
          throw new PoolError("account_pool_invalid_source")
        const selected = input.mode === "selected" ? input.accountIds : undefined
        if (input.mode === "selected" && (selected === undefined || selected.length === 0))
          throw new PoolError("account_pool_empty")
        if (selected !== undefined && new Set(selected).size !== selected.length)
          throw new PoolError("account_pool_invalid_source")
        const rows = await sourceRows(tx, groupId, filter, 3000, 0, selected, true)
        if (selected !== undefined && rows.length !== selected.length)
          throw new PoolError("account_pool_invalid_source")
        if (rows.length === 0) throw new PoolError("account_pool_empty")
        const id = crypto.randomUUID()
        const device =
          filter.deviceId === null
            ? []
            : await tx<{ label: string }[]>`
          select host || '-' || name as label from device where id = ${filter.deviceId} and group_id = ${groupId}`
        const inserted = await tx<PoolRow[]>`
          insert into operation_account_pool
            (id, group_id, created_by_user_id, key, remark, back_type, device_id, device_seq,
              device_label, times, member_count, filter_condition)
          values (${id}, ${groupId}, ${actorId}, ${input.key ?? `gen-${id.slice(0, 8)}`},
            ${input.remark}, ${filter.backType}, ${filter.deviceId}, ${filter.deviceSeq},
            ${device[0]?.label ?? ""}, ${input.times}, ${rows.length},
            ${input.mode === "all" ? tx.json(z.json().parse(filter)) : null})
          returning *`
        const row = inserted[0]
        if (row === undefined) throw new Error("Account pool insert returned no record")
        const members = rows.map((source, position) => ({
          pool_id: id,
          account_id: source.id,
          position: position + 1,
          snapshot: tx.json(z.json().parse(toSource(source))),
        }))
        await tx`insert into operation_account_pool_member ${tx(members)}`
        await audit(tx, actorId, "account-pool.create", `account-pool:${id}`)
        return toPool(tx, row)
      })
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505")
        throw new PoolError("account_pool_key_conflict")
      throw error
    }
  },
  createDesk: async (groupId, actorId, input) => {
    try {
      return await client.begin(async (tx) => {
        const prepared = await prepareDeskPool(tx, cipher, groupId, input)
        const count = await countDeskAccounts(tx, cipher, groupId, prepared.query)
        const id = crypto.randomUUID()
        const inserted = await tx<PoolRow[]>`
          insert into operation_account_pool
            (id, group_id, created_by_user_id, key, remark, back_type, device_id, device_seq,
              device_label, times, member_count, filter_condition)
          values (${id}, ${groupId}, ${actorId}, ${prepared.key}, '', '5', null, null, '', 1,
            ${Math.min(count, 3000)}, ${tx.json({ kind: "desk", query: prepared.query })})
          returning *`
        const row = inserted[0]
        if (row === undefined) throw new Error("Account pool insert returned no record")
        await audit(tx, actorId, "account-pool.create", `account-pool:${id}`)
        return { ...(await toPool(tx, row)), count }
      })
    } catch (error) {
      if (error instanceof PoolError) throw error
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505")
        throw new PoolError("account_pool_key_conflict")
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23514")
        throw new PoolError("account_pool_invalid_source")
      throw error
    }
  },
  details: async (groupId, poolId) =>
    client.begin(async (tx) => {
      const rows = await tx<PoolRow[]>`select * from operation_account_pool
        where id = ${poolId} and group_id = ${groupId} and deleted_at is null for share`
      const row = rows[0]
      if (row === undefined) throw new PoolError("account_pool_not_found")
      const deskQuery = readDeskQuery(row.filter_condition)
      if (deskQuery !== null) {
        const accounts = (await listDeskAccounts(tx, cipher, groupId, deskQuery)).map(toSource)
        const count = await countDeskAccounts(tx, cipher, groupId, deskQuery)
        return {
          ...(await toPool(tx, row)),
          count,
          accounts,
          progress: [
            {
              round: 1,
              key: `${row.key}_1`,
              total: count,
              size: count,
              unusedAccountIds: accounts.map((item) => item.id),
            },
          ],
        }
      }
      const members = await tx<{ snapshot: PoolSourceAccount }[]>`
        select snapshot from operation_account_pool_member where pool_id = ${poolId} order by position`
      const consumed = await tx<{ round: number; account_id: string }[]>`
        select round, account_id from operation_account_pool_consumption where pool_id = ${poolId}`
      const accounts = members.map((member) => member.snapshot)
      return {
        ...(await toPool(tx, row)),
        accounts,
        progress: Array.from({ length: row.times }, (_, index) => {
          const round = index + 1
          const used = new Set(
            consumed.filter((item) => item.round === round).map((item) => item.account_id),
          )
          const unusedAccountIds = accounts
            .filter((item) => !used.has(item.id))
            .map((item) => item.id)
          return {
            round,
            key: `${row.key}_${round}`,
            total: accounts.length,
            size: unusedAccountIds.length,
            unusedAccountIds,
          }
        }),
      }
    }),
  remove: async (groupId, actorId, ids) =>
    client.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`select id from operation_account_pool
        where group_id = ${groupId} and id = any(${ids}::uuid[]) and deleted_at is null order by id for update`
      if (rows.length !== new Set(ids).size) throw new PoolError("account_pool_not_found")
      await tx`update operation_account_pool set deleted_at = now(), updated_at = now()
        where group_id = ${groupId} and id = any(${ids}::uuid[])`
      for (const row of rows)
        await audit(tx, actorId, "account-pool.delete", `account-pool:${row.id}`)
      return rows.length
    }),
  consume: async (groupId, actorId, poolId, input) =>
    client.begin(async (tx) => {
      const rows = await tx<PoolRow[]>`select * from operation_account_pool
        where group_id = ${groupId} and id = ${poolId} and deleted_at is null for update`
      const row = rows[0]
      if (row === undefined) throw new PoolError("account_pool_not_found")
      const previous = await tx<{ round: number; account_id: string }[]>`
        select round, account_id from operation_account_pool_consumption
        where pool_id = ${poolId} and consumption_key = ${input.consumptionKey}`
      if (previous[0] !== undefined) {
        if (previous[0].round !== input.round || previous[0].account_id !== input.accountId)
          throw new PoolError("account_pool_consumption_conflict")
        return
      }
      if (row.expires_at.getTime() <= Date.now()) throw new PoolError("account_pool_expired")
      if (input.round > row.times) throw new PoolError("account_pool_invalid_source")
      if (needsDevice(row.back_type)) {
        const devices = await tx`select id from device where id = ${row.device_id}
          and group_id = ${groupId} and enabled = true and assignment_pending = false for share`
        if (devices[0] === undefined) throw new PoolError("account_pool_invalid_source")
      }
      const members = await tx<{ account_id: string }[]>`
        select m.account_id from operation_account_pool_member m
        join operation_account a on a.id = m.account_id
        left join device_instance i on i.id = a.device_instance_id
        where m.pool_id = ${poolId} and m.account_id = ${input.accountId}
          and a.group_id = ${groupId} and a.deleted = false and a.transferred = false
          and a.encrypted_transfer_key = '' and a.status = 'ready'
          and a.backup_type = ${needsDevice(row.back_type) ? "local" : "private_cloud"}::operation_account_backup_type
          and (${!needsDevice(row.back_type)} or a.device_id = ${row.device_id})
          and (${row.device_seq}::integer is null or i.instance_index = ${row.device_seq})
          for share of a`
      if (members[0] === undefined) throw new PoolError("account_pool_invalid_source")
      const inserted = await tx<{ id: string }[]>`
        insert into operation_account_pool_consumption (pool_id, account_id, round, consumption_key, actor_id, origin)
        values (${poolId}, ${input.accountId}, ${input.round}, ${input.consumptionKey}, ${actorId}, ${input.origin ?? "reported"})
        on conflict do nothing returning id`
      if (inserted[0] === undefined) throw new PoolError("account_pool_consumption_conflict")
      await tx`update operation_account_pool set updated_at = now() where id = ${poolId}`
      await audit(
        tx,
        actorId,
        "account-pool.consume",
        `account-pool:${poolId}:round:${input.round}`,
      )
    }),
})
