import type { Sql, TransactionSql } from "postgres"
import { z } from "zod"
import { type GroupId, GroupIdSchema } from "../../lib/authorization"
import {
  assertNoActiveTaskClaims,
  OperationDeleteConflictError,
} from "../../lib/operation-claim-guard"
import {
  legacyConfiguration,
  type ProxyCheck,
  ProxyCheckSchema,
  type ProxyConfiguration,
  ProxyConfigurationError,
  ProxyConfigurationSchema,
} from "./configuration"

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
  readonly configuration?: ProxyConfiguration | undefined
  readonly displayId?: number
  readonly revision?: number
  readonly checkResult?: ProxyCheck | null
  readonly bindingCount?: number
}
export type StoredProxy = OperationProxy & { readonly encryptedCredentials: string }
export type ProxyCreateInput = {
  readonly endpoint: string
  readonly groupId: GroupId
  readonly name: string
  readonly note: string
  readonly status: ProxyStatus
  readonly tags: readonly string[]
  readonly configuration?: ProxyConfiguration | undefined
}
export type ProxyUpdateInput = {
  readonly expectedRevision?: number | undefined
  readonly endpoint?: string | undefined
  readonly name?: string | undefined
  readonly note?: string | undefined
  readonly status?: ProxyStatus | undefined
  readonly tags?: readonly string[] | undefined
  readonly configuration?: ProxyConfiguration | undefined
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
export type ProbeSnapshot = {
  readonly token: string
  readonly proxy: StoredProxy
  readonly nodes: readonly StoredProxy[]
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
  get?(groupId: GroupId, proxyId: ProxyId): Promise<StoredProxy | null>
  startProbe?(groupId: GroupId, proxyId: ProxyId, useTurbo: boolean): Promise<ProbeSnapshot | null>
  finishProbe?(groupId: GroupId, snapshot: ProbeSnapshot, result: ProxyCheck): Promise<boolean>
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
  readonly configuration: unknown
  readonly displayId: string
  readonly revision: string
  readonly checkResult: unknown
  readonly bindingCount: string
}
type Edge = { readonly proxyId: string; readonly acceleratorId: string; readonly position: number }
const columns = (client: Sql | TransactionSql) => client`
  p.id, p.group_id as "groupId", p.name, p.endpoint, p.encrypted_credentials as "encryptedCredentials",
  p.note, p.tags, p.status, p.created_at as "createdAt", p.updated_at as "updatedAt",
  p.configuration, p.display_id as "displayId", p.revision, p.check_result as "checkResult",
  (select count(*) from operation_account a where a.proxy_id = p.id and not a.deleted) as "bindingCount"
`
const toStored = (row: ProxyRow, edges: readonly Edge[] = []): StoredProxy => {
  const configuration =
    row.configuration === null
      ? legacyConfiguration(row.endpoint)
      : ProxyConfigurationSchema.parse(row.configuration)
  const targets = edges.filter((edge) => edge.proxyId === row.id)
  return {
    ...row,
    configuration: {
      ...configuration,
      acceleratorId: targets.find((edge) => edge.position === 0)?.acceleratorId ?? null,
      acceleratorIds: targets.filter((edge) => edge.position > 0).map((edge) => edge.acceleratorId),
    },
    displayId: Number(row.displayId),
    revision: Number(row.revision),
    bindingCount: Number(row.bindingCount),
    checkResult: row.checkResult === null ? null : ProxyCheckSchema.parse(row.checkResult),
    credentialState: row.encryptedCredentials.length === 0 ? "none" : "configured",
    groupId: GroupIdSchema.parse(row.groupId),
    id: ProxyIdSchema.parse(row.id),
    status: ProxyStatusSchema.parse(row.status),
  }
}
export const toPublicProxy = ({
  encryptedCredentials: _secret,
  ...proxy
}: StoredProxy): OperationProxy => ({
  ...proxy,
  ...(proxy.configuration === undefined
    ? {}
    : { configuration: { ...proxy.configuration, refreshUrl: "" } }),
})

export class ProxyConflictError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = "ProxyConflictError"
  }
}
export const lockGroup = async (tx: TransactionSql, groupId: string): Promise<void> => {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`proxy:${groupId}`}, 0))`
}
const loadGroup = async (tx: Sql | TransactionSql, groupId: string): Promise<StoredProxy[]> => {
  const rows = await tx<ProxyRow[]>`select ${columns(tx)} from operation_proxy p
    where p.group_id = ${groupId} order by p.created_at desc, p.id desc`
  const edges = await tx<
    Edge[]
  >`select proxy_id as "proxyId", accelerator_id as "acceleratorId", position
    from operation_proxy_accelerator where group_id = ${groupId} order by position`
  return rows.map((row) => toStored(row, edges))
}
const targetIds = (configuration: ProxyConfiguration): string[] => [
  ...(configuration.acceleratorId === null ? [] : [configuration.acceleratorId]),
  ...configuration.acceleratorIds,
]
const assertGraph = (proxies: readonly StoredProxy[]): void => {
  const byId = new Map<string, StoredProxy>(proxies.map((proxy) => [proxy.id, proxy]))
  for (const proxy of proxies) {
    const configuration = proxy.configuration
    if (configuration === undefined) continue
    const targets = targetIds(configuration)
    if (new Set(targets).size !== targets.length)
      throw new ProxyConfigurationError("duplicate_accelerator")
    for (const id of targets) {
      const node = byId.get(id)
      if (
        node === undefined ||
        node.id === proxy.id ||
        !node.configuration?.turbo ||
        node.status === "disabled"
      )
        throw new ProxyConflictError("invalid_accelerator")
    }
  }
  const depths = new Map<string, number>()
  const visit = (id: string, path: ReadonlySet<string>): number => {
    if (path.has(id)) throw new ProxyConflictError("accelerator_cycle")
    const cached = depths.get(id)
    if (cached !== undefined) return cached
    const configuration = byId.get(id)?.configuration
    if (configuration === undefined) return 1
    const next = new Set([...path, id])
    let depth = 1
    for (const target of targetIds(configuration)) depth = Math.max(depth, 1 + visit(target, next))
    if (depth > 8) throw new ProxyConflictError("accelerator_chain_too_long")
    depths.set(id, depth)
    return depth
  }
  for (const proxy of proxies) visit(proxy.id, new Set())
}
const writeEdges = async (
  tx: TransactionSql,
  groupId: string,
  proxyId: string,
  configuration: ProxyConfiguration,
): Promise<void> => {
  await tx`delete from operation_proxy_accelerator where proxy_id = ${proxyId} and group_id = ${groupId}`
  const targets = [
    ...(configuration.acceleratorId === null
      ? []
      : [{ id: configuration.acceleratorId, position: 0 }]),
    ...configuration.acceleratorIds.map((id, index) => ({ id, position: index + 1 })),
  ]
  for (const target of targets) {
    await tx`insert into operation_proxy_accelerator (group_id, proxy_id, accelerator_id, position)
      values (${groupId}, ${proxyId}, ${target.id}, ${target.position})`
  }
}
const persistedConfiguration = (configuration: ProxyConfiguration): ProxyConfiguration => ({
  ...configuration,
  acceleratorId: null,
  acceleratorIds: [],
})
export const createPostgresProxyRepository = (client: Sql): ProxyRepository => ({
  create: (input) =>
    client.begin(async (tx) => {
      await lockGroup(tx, input.groupId)
      const configuration = input.configuration ?? legacyConfiguration(input.endpoint)
      const rows = await tx<ProxyRow[]>`insert into operation_proxy as p
      (group_id, name, endpoint, encrypted_credentials, note, tags, status, configuration)
      values (${input.groupId}, ${input.name}, ${input.endpoint}, ${input.encryptedCredentials},
        ${input.note}, ${input.tags}, ${input.status}, ${tx.json(persistedConfiguration(configuration))})
      returning ${columns(tx)}`
      const row = rows[0]
      if (row === undefined) throw new Error("Proxy insert did not return a record")
      const proxy = { ...toStored(row), configuration }
      const proxies = await loadGroup(tx, input.groupId)
      assertGraph(proxies.map((item) => (item.id === proxy.id ? proxy : item)))
      await writeEdges(tx, input.groupId, proxy.id, configuration)
      return proxy
    }),
  delete: (groupId, ids) =>
    client.begin(async (tx) => {
      if (ids.length === 0) return 0
      await lockGroup(tx, groupId)
      const locked = await tx<{ id: string }[]>`select id from operation_proxy
      where group_id = ${groupId} and id = any(${ids}) for update`
      const entityIds = locked.map((row) => row.id)
      await assertNoActiveTaskClaims(tx, groupId, "proxy", entityIds)
      const accounts = await tx`select id from operation_account where proxy_id = any(${entityIds})
      and not deleted limit 1`
      if (accounts.length > 0) throw new OperationDeleteConflictError()
      const dependents = await tx`select proxy_id from operation_proxy_accelerator
      where group_id = ${groupId} and accelerator_id = any(${entityIds})
        and not (proxy_id = any(${entityIds})) limit 1`
      if (dependents.length > 0) throw new ProxyConflictError("accelerator_in_use")
      await tx`delete from operation_proxy_accelerator where group_id = ${groupId} and proxy_id = any(${entityIds})`
      const rows = await tx`delete from operation_proxy where group_id = ${groupId}
      and id = any(${entityIds}) returning id`
      return rows.length
    }),
  list: (filter) =>
    client.begin("isolation level repeatable read read only", async (tx) => {
      const query = filter.query?.toLocaleLowerCase("zh-CN") ?? null
      const where = tx`p.group_id = ${filter.groupId}
      and (${filter.status ?? null}::text is null or p.status::text = ${filter.status ?? null})
      and (${filter.tag ?? null}::text is null or ${filter.tag ?? null} = any(p.tags))
      and (${query}::text is null or strpos(lower(p.name), ${query}) > 0
        or strpos(lower(p.endpoint), ${query}) > 0 or strpos(lower(p.note), ${query}) > 0)`
      const rows = await tx<ProxyRow[]>`select ${columns(tx)} from operation_proxy p where ${where}
      order by p.created_at desc, p.id desc limit ${filter.pageSize} offset ${(filter.page - 1) * filter.pageSize}`
      const counts = await tx<
        { total: string }[]
      >`select count(*) as total from operation_proxy p where ${where}`
      const edges = await tx<
        Edge[]
      >`select proxy_id as "proxyId", accelerator_id as "acceleratorId", position
      from operation_proxy_accelerator where group_id = ${filter.groupId} and proxy_id = any(${rows.map((row) => row.id)})
      order by position`
      return {
        items: rows.map((row) => toPublicProxy(toStored(row, edges))),
        page: filter.page,
        pageSize: filter.pageSize,
        total: Number(counts[0]?.total ?? 0),
      }
    }),
  get: (groupId, proxyId) =>
    client.begin("isolation level repeatable read read only", async (tx) => {
      const rows = await tx<
        ProxyRow[]
      >`select ${columns(tx)} from operation_proxy p where p.group_id = ${groupId} and p.id = ${proxyId}`
      const row = rows[0]
      if (row === undefined) return null
      const edges = await tx<
        Edge[]
      >`select proxy_id as "proxyId", accelerator_id as "acceleratorId", position
      from operation_proxy_accelerator where group_id = ${groupId} and proxy_id = ${proxyId} order by position`
      return toStored(row, edges)
    }),
  update: (groupId, proxyId, input) =>
    client.begin(async (tx) => {
      await lockGroup(tx, groupId)
      const proxies = await loadGroup(tx, groupId)
      const current = proxies.find((item) => item.id === proxyId)
      if (current === undefined) return null
      if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision)
        throw new ProxyConflictError("proxy_configuration_changed")
      const configuration =
        input.configuration ??
        (input.endpoint === undefined
          ? current.configuration
          : legacyConfiguration(input.endpoint)) ??
        legacyConfiguration(current.endpoint)
      const next: StoredProxy = {
        ...current,
        configuration,
        endpoint: input.endpoint ?? current.endpoint,
        name: input.name ?? current.name,
        note: input.note ?? current.note,
        status: input.status ?? current.status,
        tags: input.tags ?? current.tags,
        encryptedCredentials: input.encryptedCredentials ?? current.encryptedCredentials,
      }
      assertGraph(proxies.map((item) => (item.id === proxyId ? next : item)))
      const connectionChanged =
        next.encryptedCredentials !== current.encryptedCredentials ||
        next.endpoint !== current.endpoint ||
        next.status !== current.status
      const changed =
        connectionChanged || JSON.stringify(configuration) !== JSON.stringify(current.configuration)
      const probeChanged =
        connectionChanged ||
        JSON.stringify({ ...configuration, favorite: false }) !==
          JSON.stringify({ ...current.configuration, favorite: false })
      const rows = await tx<ProxyRow[]>`update operation_proxy as p
      set name = ${next.name}, endpoint = ${next.endpoint}, encrypted_credentials = ${next.encryptedCredentials},
        note = ${next.note}, tags = ${next.tags}, status = ${next.status},
        configuration = ${tx.json(persistedConfiguration(configuration))},
        revision = revision + ${changed ? 1 : 0},
        check_result = case when ${probeChanged} then null else check_result end, updated_at = now()
      where group_id = ${groupId} and id = ${proxyId} returning ${columns(tx)}`
      await writeEdges(tx, groupId, proxyId, configuration)
      if (probeChanged) {
        await tx`with recursive dependents(id) as (
        select proxy_id from operation_proxy_accelerator where group_id = ${groupId} and accelerator_id = ${proxyId}
        union
        select edge.proxy_id from operation_proxy_accelerator edge join dependents d on edge.accelerator_id = d.id
          where edge.group_id = ${groupId}
      ) update operation_proxy set check_result = null
        where group_id = ${groupId} and id in (select id from dependents)`
      }
      const row = rows[0]
      return row === undefined ? null : { ...toStored(row), configuration }
    }),
  startProbe: (groupId, proxyId, useTurbo) =>
    client.begin(async (tx) => {
      await lockGroup(tx, groupId)
      const proxies = await loadGroup(tx, groupId)
      const proxy = proxies.find((item) => item.id === proxyId)
      if (proxy === undefined) return null
      if (proxy.status === "disabled") throw new ProxyConflictError("proxy_disabled")
      const busy = await tx`select id from operation_proxy where group_id = ${groupId}
      and probe_token is not null and probe_started_at > now() - interval '60 seconds'`
      if (busy.length >= 4) throw new ProxyConflictError("proxy_probe_busy")
      const token = crypto.randomUUID()
      const claimed =
        await tx`update operation_proxy set probe_token = ${token}, probe_started_at = now()
      where group_id = ${groupId} and id = ${proxyId}
        and (probe_token is null or probe_started_at < now() - interval '60 seconds')
        and (probe_started_at is null or probe_started_at < now() - interval '10 seconds')
      returning id`
      if (claimed.length === 0) throw new ProxyConflictError("proxy_probe_busy")
      const nodes: StoredProxy[] = []
      const collect = (item: StoredProxy): void => {
        if (nodes.some((node) => node.id === item.id)) return
        nodes.push(item)
        if (!useTurbo || item.configuration === undefined) return
        for (const id of targetIds(item.configuration)) {
          const target = proxies.find((node) => node.id === id)
          if (target === undefined || !target.configuration?.turbo || target.status === "disabled")
            throw new ProxyConflictError("invalid_accelerator")
          collect(target)
        }
      }
      assertGraph(proxies)
      collect(proxy)
      return { token, proxy, nodes }
    }),
  finishProbe: (groupId, snapshot, result) =>
    client.begin(async (tx) => {
      await lockGroup(tx, groupId)
      const nodes = await loadGroup(tx, groupId)
      const unchanged = snapshot.nodes.every((before) =>
        nodes.some((after) => after.id === before.id && after.revision === before.revision),
      )
      const updated = await tx`update operation_proxy set probe_token = null,
      check_result = case when ${unchanged} then ${tx.json(result)} else check_result end
      where group_id = ${groupId} and id = ${snapshot.proxy.id} and probe_token = ${snapshot.token} returning id`
      return unchanged && updated.length > 0
    }),
})
