import type { Sql } from "postgres"
import { z } from "zod"
import type { GroupId } from "../../lib/authorization"
import { assertNoActiveTaskClaims } from "../../lib/operation-claim-guard"

export const ProxyIdSchema = z.string().uuid().brand<"ProxyId">()
export type ProxyId = z.infer<typeof ProxyIdSchema>
export const ProxyStatus = {
  Disabled: "disabled",
  Ready: "ready",
  Unavailable: "unavailable",
} as const
export type ProxyStatus = (typeof ProxyStatus)[keyof typeof ProxyStatus]
export const ProxyStatusSchema = z.enum([
  ProxyStatus.Ready,
  ProxyStatus.Unavailable,
  ProxyStatus.Disabled,
])
export type OperationProxy = {
  readonly createdAt: Date
  readonly credentialState: "configured" | "none"
  readonly endpoint: string
  readonly groupId: GroupId
  readonly id: ProxyId
  readonly name: string
  readonly note: string
  readonly status: ProxyStatus
  readonly tags: readonly string[]
  readonly updatedAt: Date
}
export type StoredProxy = OperationProxy & { readonly encryptedCredentials: string }
export type ProxyCreateInput = {
  readonly endpoint: string
  readonly groupId: GroupId
  readonly name: string
  readonly note: string
  readonly status: ProxyStatus
  readonly tags: readonly string[]
}
export type ProxyUpdateInput = {
  readonly endpoint?: string | undefined
  readonly name?: string | undefined
  readonly note?: string | undefined
  readonly status?: ProxyStatus | undefined
  readonly tags?: readonly string[] | undefined
}
export type ProxyFilter = {
  readonly groupId: GroupId
  readonly page: number
  readonly pageSize: number
  readonly query?: string | undefined
  readonly status?: ProxyStatus | undefined
  readonly tag?: string | undefined
}
export type ProxyPage = {
  readonly items: readonly OperationProxy[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}
export interface ProxyRepository {
  create(input: ProxyCreateInput & { readonly encryptedCredentials: string }): Promise<StoredProxy>
  delete(groupId: GroupId, ids: readonly ProxyId[]): Promise<number>
  list(filter: ProxyFilter): Promise<ProxyPage>
  update(
    groupId: GroupId,
    proxyId: ProxyId,
    input: ProxyUpdateInput & { readonly encryptedCredentials?: string },
  ): Promise<StoredProxy | null>
}

type ProxyRow = {
  readonly createdAt: Date
  readonly encryptedCredentials: string
  readonly endpoint: string
  readonly groupId: string
  readonly id: string
  readonly name: string
  readonly note: string
  readonly status: string
  readonly tags: readonly string[]
  readonly updatedAt: Date
}
const columns = (client: Sql) =>
  client`id, group_id as "groupId", name, endpoint, encrypted_credentials as "encryptedCredentials", note, tags, status, created_at as "createdAt", updated_at as "updatedAt"`
const toStored = (row: ProxyRow): StoredProxy => ({
  createdAt: row.createdAt,
  credentialState: row.encryptedCredentials.length === 0 ? "none" : "configured",
  encryptedCredentials: row.encryptedCredentials,
  endpoint: row.endpoint,
  groupId: z.string().uuid().brand<"GroupId">().parse(row.groupId),
  id: ProxyIdSchema.parse(row.id),
  name: row.name,
  note: row.note,
  status: ProxyStatusSchema.parse(row.status),
  tags: row.tags,
  updatedAt: row.updatedAt,
})
export const toPublicProxy = ({
  encryptedCredentials: _encryptedCredentials,
  ...proxy
}: StoredProxy): OperationProxy => proxy
const matches = (proxy: OperationProxy, filter: ProxyFilter): boolean => {
  const query = filter.query?.toLocaleLowerCase("zh-CN")
  return (
    (query === undefined ||
      proxy.name.toLocaleLowerCase("zh-CN").includes(query) ||
      proxy.endpoint.toLocaleLowerCase("zh-CN").includes(query)) &&
    (filter.status === undefined || proxy.status === filter.status) &&
    (filter.tag === undefined || proxy.tags.includes(filter.tag))
  )
}
export const createPostgresProxyRepository = (client: Sql): ProxyRepository => ({
  create: async (input) => {
    const rows = await client<
      ProxyRow[]
    >`insert into operation_proxy (group_id, name, endpoint, encrypted_credentials, note, tags, status) values (${input.groupId}, ${input.name}, ${input.endpoint}, ${input.encryptedCredentials}, ${input.note}, ${input.tags}, ${input.status}) returning ${columns(client)}`
    const row = rows[0]
    if (row === undefined) throw new ProxyPersistenceError()
    return toStored(row)
  },
  delete: async (groupId, ids) => {
    if (ids.length === 0) return 0
    return client.begin(async (transaction) => {
      const locked = await transaction<{ readonly id: string }[]>`
        select id from operation_proxy where group_id = ${groupId} and id = any(${ids}) for update
      `
      const entityIds = locked.map((row) => row.id)
      await assertNoActiveTaskClaims(transaction, groupId, "proxy", entityIds)
      const rows = await transaction<{ readonly id: string }[]>`
        delete from operation_proxy where group_id = ${groupId} and id = any(${entityIds}) returning id
      `
      return rows.length
    })
  },
  list: async (filter) => {
    const rows = await client<
      ProxyRow[]
    >`select ${columns(client)} from operation_proxy where group_id = ${filter.groupId} order by created_at desc, id desc`
    const all = rows
      .map(toStored)
      .map(toPublicProxy)
      .filter((proxy) => matches(proxy, filter))
    const offset = (filter.page - 1) * filter.pageSize
    return {
      items: all.slice(offset, offset + filter.pageSize),
      page: filter.page,
      pageSize: filter.pageSize,
      total: all.length,
    }
  },
  update: async (groupId, proxyId, input) => {
    const currentRows = await client<
      ProxyRow[]
    >`select ${columns(client)} from operation_proxy where group_id = ${groupId} and id = ${proxyId}`
    const current = currentRows[0]
    if (current === undefined) return null
    const stored = toStored(current)
    const next = {
      encryptedCredentials: input.encryptedCredentials ?? stored.encryptedCredentials,
      endpoint: input.endpoint ?? stored.endpoint,
      name: input.name ?? stored.name,
      note: input.note ?? stored.note,
      status: input.status ?? stored.status,
      tags: input.tags ?? stored.tags,
    }
    const rows = await client<
      ProxyRow[]
    >`update operation_proxy set name = ${next.name}, endpoint = ${next.endpoint}, encrypted_credentials = ${next.encryptedCredentials}, note = ${next.note}, tags = ${next.tags}, status = ${next.status}, updated_at = now() where group_id = ${groupId} and id = ${proxyId} returning ${columns(client)}`
    const row = rows[0]
    return row === undefined ? null : toStored(row)
  },
})
class ProxyPersistenceError extends Error {
  public constructor() {
    super("Operation proxy insert did not return a record")
    this.name = "ProxyPersistenceError"
  }
}
