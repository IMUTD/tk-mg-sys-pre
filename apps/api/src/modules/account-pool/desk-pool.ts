import type { Sql, TransactionSql } from "postgres"

import type { SecretCipher } from "../../lib/crypto"
import {
  DeskCreateSchema,
  type DeskPoolQuery,
  DeskPoolQuerySchema,
  deskPoolKey,
  PoolError,
  resolveDeskPoolName,
} from "./pool-model"

type QuerySql = Sql | TransactionSql
type DeskRow = {
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

const decrypt = (cipher: SecretCipher | undefined, value: string): string => {
  if (value.length === 0 || cipher === undefined) return ""
  try {
    return cipher.decrypt(value)
  } catch {
    return ""
  }
}

const transferAccountIds = async (
  sql: QuerySql,
  cipher: SecretCipher | undefined,
  groupId: string,
  transferKey: string,
): Promise<readonly string[] | null> => {
  if (transferKey.length === 0) return null
  if (cipher === undefined) throw new PoolError("account_pool_invalid_source")
  const rows = await sql<{ accountId: string; encryptedCode: string }[]>`
    select item.account_id as "accountId", transfer.encrypted_code as "encryptedCode"
    from operation_account_transfer transfer
    join operation_account_transfer_item item on item.transfer_id = transfer.id
    where transfer.group_id = ${groupId} and transfer.status = 'active'`
  const needle = transferKey.toLowerCase()
  return rows.flatMap((row) =>
    decrypt(cipher, row.encryptedCode).toLowerCase().includes(needle) ? [row.accountId] : [],
  )
}

const where = (
  sql: QuerySql,
  groupId: string,
  query: DeskPoolQuery,
  transferIds: readonly string[] | null,
) => {
  const parts = [sql`a.group_id = ${groupId}`, sql`a.deleted = false`]
  if (query.ungrouped) parts.push(sql`btrim(coalesce(a.tags[1], '')) = ''`)
  else if (query.tag.length > 0) parts.push(sql`coalesce(a.tags[1], '') = ${query.tag}`)
  if (query.untagged)
    parts.push(sql`(
      select count(*) from unnest(coalesce(a.tags[2:2147483647], '{}'::text[])) as tag(name)
      where btrim(name) <> ''
    ) = 0`)
  else if (query.tagBucket.length > 0)
    parts.push(sql`a.tags[2:2147483647] @> ${query.tagBucket}::text[]`)
  if (query.unremarked) parts.push(sql`btrim(coalesce(a.note, '')) = ''`)
  else if (query.userRemarks.length > 0)
    parts.push(sql`${[...query.userRemarks]}::text[] <@ (
      select coalesce(array_agg(distinct btrim(part)), '{}'::text[])
      from unnest(string_to_array(btrim(coalesce(a.note, '')), ${"\u001e"})) as item(part)
      where btrim(part) <> ''
    )`)
  else if (query.userRemark.length > 0)
    parts.push(sql`exists (
      select 1
      from unnest(string_to_array(btrim(coalesce(a.note, '')), ${"\u001e"})) as part(name)
      where btrim(name) = ${query.userRemark}
    )`)
  if (query.status === "0") parts.push(sql`a.status in ('ready', 'disabled')`)
  if (query.status === "1") parts.push(sql`a.status = 'suspended'`)
  if (query.status === "2") parts.push(sql`a.status = 'expired'`)
  if (query.status === "3") parts.push(sql`a.status = 'hidden'`)
  if (query.app === "tiktok")
    parts.push(sql`(a.app = 'tiktok'::operation_account_app or a.app is null)`)
  else if (query.app.length > 0)
    parts.push(sql`a.app = ${query.app}::operation_account_app`)
  if (query.backType === "2") parts.push(sql`a.backup_type = 'local'::operation_account_backup_type`)
  if (query.backType === "3")
    parts.push(sql`a.backup_type = 'private_cloud'::operation_account_backup_type`)
  if (query.backType === "4") parts.push(sql`a.backup_type = 'cloud'::operation_account_backup_type`)
  if (query.backType === "5") parts.push(sql`a.backup_type = 'full'::operation_account_backup_type`)
  for (const item of query.quick) {
    if (item === "noUsername")
      parts.push(sql`(case when a.identifier <> '' then a.identifier else a.name end) = ''`)
    if (item === "noPassword") parts.push(sql`a.encrypted_secret = ''`)
    if (item === "hasPassword") parts.push(sql`a.encrypted_secret <> ''`)
    if (item === "noTotp") parts.push(sql`a.encrypted_totp = ''`)
    if (item === "hasTotp") parts.push(sql`a.encrypted_totp <> ''`)
    if (item === "online") parts.push(sql`a.online = true`)
    if (item === "offline") parts.push(sql`a.online = false`)
    if (item === "noProxy") parts.push(sql`a.proxy_id is null`)
    if (item === "favorite") parts.push(sql`coalesce(a.favorite, 0) > 0`)
  }
  for (const region of query.region) parts.push(sql`lower(a.region) = lower(${region})`)
  if (query.deviceId !== null) parts.push(sql`a.device_id = ${query.deviceId}`)
  if (query.proxyId !== null) parts.push(sql`a.proxy_id = ${query.proxyId}`)
  if (query.identity.length > 0) {
    const tokens = query.identity.split("、")
    parts.push(sql`(
      lower(case when a.identifier <> '' then a.identifier else a.name end) = any(${tokens.map((item) => item.toLowerCase())}::text[])
      or a.platform_uid = any(${tokens}::text[])
    )`)
  }
  if (query.followerGT.length > 0)
    parts.push(sql`coalesce(a.follower, 0) >= ${Number(query.followerGT)}`)
  if (query.followingGT.length > 0)
    parts.push(sql`coalesce(a.following, 0) >= ${Number(query.followingGT)}`)
  if (transferIds !== null) parts.push(sql`a.id = any(${[...transferIds]}::uuid[])`)
  return parts.slice(1).reduce((left, right) => sql`${left} and ${right}`, parts[0] ?? sql`true`)
}

const labelsFor = async (
  sql: QuerySql,
  groupId: string,
  query: DeskPoolQuery,
): Promise<{ device: string; proxy: string }> => {
  const device =
    query.deviceId === null
      ? []
      : await sql<{ name: string; host: string }[]>`
          select name, host from device
          where id = ${query.deviceId} and group_id = ${groupId}`
  if (query.deviceId !== null && device[0] === undefined)
    throw new PoolError("account_pool_invalid_source")
  const proxy =
    query.proxyId === null
      ? []
      : await sql<{ endpoint: string }[]>`
          select endpoint from operation_proxy
          where id = ${query.proxyId} and group_id = ${groupId}`
  if (query.proxyId !== null && proxy[0] === undefined)
    throw new PoolError("account_pool_invalid_source")
  return {
    device: device[0] === undefined ? "" : `${device[0].name} - ${device[0].host}`,
    proxy: proxy[0]?.endpoint ?? "",
  }
}

export const prepareDeskPool = async (
  sql: QuerySql,
  cipher: SecretCipher | undefined,
  groupId: string,
  input: unknown,
): Promise<{ key: string; query: DeskPoolQuery }> => {
  const parsed = DeskCreateSchema.parse(input)
  const key = resolveDeskPoolName(
    deskPoolKey(parsed.query, await labelsFor(sql, groupId, parsed.query)),
    parsed.name,
  )
  if (key.length === 0 || key.length > 400 || key.includes("+"))
    throw new PoolError("account_pool_invalid_source")
  return { key, query: parsed.query }
}

export const countDeskAccounts = async (
  sql: QuerySql,
  cipher: SecretCipher | undefined,
  groupId: string,
  query: DeskPoolQuery,
): Promise<number> => {
  const transferIds = await transferAccountIds(sql, cipher, groupId, query.transferKey)
  const rows = await sql<{ total: string }[]>`
    select count(*) as total from operation_account a
    where ${where(sql, groupId, query, transferIds)}`
  return Number(rows[0]?.total ?? 0)
}

export const listDeskAccounts = async (
  sql: QuerySql,
  cipher: SecretCipher | undefined,
  groupId: string,
  query: DeskPoolQuery,
): Promise<DeskRow[]> => {
  const transferIds = await transferAccountIds(sql, cipher, groupId, query.transferKey)
  return sql<DeskRow[]>`
    select a.id, a.device_id, i.instance_index as device_seq, a.follower, a.following,
      a.favorite, a.online, a.region, a.note, a.status, a.tags, a.platform_uid,
      a.identifier, a.name, a.updated_at, p.name as proxy_name, a.extra
    from operation_account a
    left join device_instance i on i.id = a.device_instance_id
    left join operation_proxy p on p.id = a.proxy_id and p.group_id = a.group_id
    where ${where(sql, groupId, query, transferIds)}
    order by a.created_at desc, a.id
    limit 3000`
}

export const readDeskQuery = (value: unknown): DeskPoolQuery | null => {
  if (value === null || typeof value !== "object" || !("kind" in value)) return null
  if (value.kind !== "desk" || !("query" in value)) return null
  const parsed = DeskPoolQuerySchema.safeParse(value.query)
  return parsed.success ? parsed.data : null
}
