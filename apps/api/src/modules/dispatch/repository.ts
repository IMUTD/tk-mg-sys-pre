import { createHash, randomUUID } from "node:crypto"

import type { Sql } from "postgres"

import type { SecretCipher } from "../../lib/crypto"
import { listDeskAccounts, readDeskQuery } from "../account-pool/desk-pool"
import { fingerprint } from "../box-contract"
import { parseCredentials } from "../proxies/configuration"
import { takeBalanced } from "./allocate"
import {
  drawShareFiles,
  drawTexts,
  fillStep,
  type FillProxy,
  refreshDeviceHosts,
  resolveProxyLink,
  type ShareDrawFile,
  type TextMaterial,
} from "./fill"

export type TextChoice = {
  readonly mode: "random" | "sequence" | "tag"
  readonly sequence: number
  readonly tag?: string
}

export type NamedSet = {
  readonly by: "group" | "remark" | "tag"
  readonly name: string
}

export type FileChoice = {
  readonly deviceId: string
  readonly directory: string
  readonly mode: "random" | "sequence"
  readonly sequence: number
  readonly source: "pool.backup" | "pool.image" | "pool.video"
}

export type DispatchSelection = {
  readonly accountIds: readonly string[]
  readonly accountNote: string
  readonly accounts: NamedSet | null
  readonly boxIds: readonly string[]
  readonly boxes: NamedSet | null
  readonly files: readonly FileChoice[]
  readonly pitIndexes: readonly number[]
  readonly poolId: string
  readonly proxies: NamedSet | null
  readonly proxyIds: readonly string[]
  readonly proxyTag: string | null
  readonly texts: readonly TextChoice[]
}

type SharePaths = { readonly backup: string; readonly image: string; readonly video: string }

const emptySharePaths: SharePaths = { backup: "", image: "", video: "" }

type ChainStep = {
  readonly afterMs: number
  readonly guards: readonly string[]
  readonly input: Record<string, string>
  readonly scopes: Record<string, string>
  readonly skill: string
  readonly sources: Record<string, string>
}

type AccountRow = {
  readonly backupDeviceId: string | null
  readonly backupKey: string
  readonly deviceId: string | null
  readonly encryptedSecret: string
  readonly id: string
  readonly identifier: string
  readonly instanceIndex: number | null
  readonly language: string
  readonly note: string
  readonly proxyId: string | null
  readonly region: string
}

type DeviceRow = {
  readonly host: string
  readonly id: string
  readonly name: string
}

type ProxyRow = {
  readonly configuration: {
    readonly host?: string
    readonly port?: number
    readonly safe?: boolean
    readonly tun?: boolean
  } | null
  readonly credentials: string
  readonly endpoint: string
  readonly id: string
  readonly linkCredentials: string | null
  readonly name: string
  readonly tags: readonly string[]
}

export type PlannedItem = ReturnType<typeof planDispatch>[number]

const hashValue = (value: unknown): string =>
  createHash("sha256").update(fingerprint(value)).digest("hex")

const asRecord = (value: unknown): Record<string, string> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {}
  const record: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") record[key] = item
  }
  return record
}

const chainSteps = (row: {
  readonly delays: readonly number[] | null
  readonly guards: readonly (readonly string[])[] | null
  readonly parameters: readonly { readonly input?: unknown; readonly skill?: unknown }[] | null
  readonly paramScopes: readonly unknown[] | null
  readonly paramSources: readonly unknown[] | null
}): ChainStep[] =>
  (row.parameters ?? []).map((item, index) => ({
    afterMs: row.delays?.[index] ?? 0,
    guards: row.guards?.[index] ?? [],
    input: asRecord(item.input),
    scopes: asRecord(row.paramScopes?.[index]),
    skill: typeof item.skill === "string" ? item.skill : "",
    sources: asRecord(row.paramSources?.[index]),
  }))

const proxyView = (cipher: SecretCipher, row: ProxyRow): FillProxy & {
  readonly id: string
  readonly name: string
  readonly tags: readonly string[]
} => {
  const readExtra = (value: string | null): { extra: string; password: string; username: string } => {
    if (value === null || value === "") return { extra: "", password: "", username: "" }
    try {
      return parseCredentials(cipher.decrypt(value))
    } catch {
      return { extra: "", password: "", username: "" }
    }
  }
  const secret = readExtra(row.credentials)
  const acceleratorExtra = readExtra(row.linkCredentials).extra
  const endpoint = row.endpoint.split(":")
  const host = row.configuration?.host || endpoint[0] || ""
  const port = row.configuration?.port ?? Number(endpoint[1] ?? "")
  return {
    host,
    id: row.id,
    link: resolveProxyLink(secret.extra, acceleratorExtra),
    name: row.name,
    password: secret.password,
    port: Number.isInteger(port) && port > 0 ? String(port) : "",
    safe: row.configuration?.safe === true ? "true" : "false",
    tags: row.tags,
    tun: row.configuration?.tun === true ? "true" : "false",
    username: secret.username,
  }
}

const pickPit = (
  deviceId: string | null,
  indexes: readonly number[],
  counts: Map<string, number>,
): number | null => {
  if (deviceId === null || indexes.length === 0) return null
  const ranked = [...indexes].sort((left, right) => {
    const used =
      (counts.get(`${deviceId}#${left}`) ?? 0) - (counts.get(`${deviceId}#${right}`) ?? 0)
    return used === 0 ? left - right : used
  })
  const index = ranked[0]
  if (index === undefined) return null
  counts.set(`${deviceId}#${index}`, (counts.get(`${deviceId}#${index}`) ?? 0) + 1)
  return index
}

const loadSharePaths = async (sql: Sql, deviceIds: readonly string[]): Promise<Map<string, SharePaths>> => {
  const paths = new Map<string, SharePaths>()
  if (deviceIds.length === 0) return paths
  const rows = await sql<{ deviceId: string; path: string; pool: string }[]>`
    select distinct on (device_id, pool)
      device_id::text as "deviceId",
      pool,
      bucket || '/' || relative_path as path
    from (
      select device_id, bucket, relative_path, seen_at,
        case
          when bucket = 'backup' then 'backup'
          when category = 'video' and bucket <> 'backup' then 'video'
          when category = 'image' and bucket <> 'backup' then 'image'
          else ''
        end as pool
      from box_share_entry
      where device_id = any(${deviceIds}::uuid[]) and kind = 'file' and sha256 <> ''
    ) listed
    where pool <> ''
    order by device_id, pool, seen_at desc, relative_path
  `
  for (const row of rows) {
    const current = { ...(paths.get(row.deviceId) ?? emptySharePaths) }
    if (row.pool === "video") paths.set(row.deviceId, { ...current, video: row.path })
    if (row.pool === "image") paths.set(row.deviceId, { ...current, image: row.path })
    if (row.pool === "backup") paths.set(row.deviceId, { ...current, backup: row.path })
  }
  return paths
}

const loadCatalog = async (sql: Sql, deviceIds: readonly string[]): Promise<ShareDrawFile[]> => {
  if (deviceIds.length === 0) return []
  const rows = await sql<{ deviceId: string; host: string; parent: string; path: string; pool: string }[]>`
    select e.device_id::text as "deviceId", d.host, e.parent_path as parent,
      e.bucket || '/' || e.relative_path as path,
      case
        when e.bucket = 'backup' then 'backup'
        when e.category = 'video' and e.bucket <> 'backup' then 'video'
        when e.category = 'image' and e.bucket <> 'backup' then 'image'
        else ''
      end as pool
    from box_share_entry e
    join device d on d.id = e.device_id
    where e.device_id = any(${[...deviceIds]}::uuid[]) and e.kind = 'file' and e.sha256 <> ''
  `
  return rows.flatMap((row) =>
    row.pool === "video" || row.pool === "image" || row.pool === "backup"
      ? [{ deviceId: row.deviceId, host: row.host, parent: row.parent, path: row.path, pool: row.pool }]
      : [],
  )
}

const decryptSecret = (cipher: SecretCipher, value: string): string => {
  if (value.length === 0) return ""
  try {
    return cipher.decrypt(value)
  } catch {
    return ""
  }
}

const filePool = (source: string): ShareDrawFile["pool"] | null => {
  if (source === "pool.video") return "video"
  if (source === "pool.image") return "image"
  if (source === "pool.backup") return "backup"
  return null
}

export const planDispatch = (
  cipher: SecretCipher,
  selection: DispatchSelection,
  accounts: readonly AccountRow[],
  devices: readonly DeviceRow[],
  instances: readonly { readonly deviceId: string; readonly id: string; readonly index: number }[],
  proxies: readonly ProxyRow[],
  texts: readonly TextMaterial[],
  backupHosts: ReadonlyMap<string, string>,
  sharePaths: ReadonlyMap<string, SharePaths>,
  catalog: readonly ShareDrawFile[],
  steps: readonly ChainStep[],
) => {
  const readyProxies = proxies.map((row) => proxyView(cipher, row))
  const deviceCounts = new Map<string, number>()
  const proxyCounts = new Map<string, number>()
  const pitCounts = new Map<string, number>()
  const textDraws = new Map<number, ReturnType<typeof drawTexts>>()
  for (const choice of selection.texts) {
    textDraws.set(choice.sequence, drawTexts(texts, choice.mode, choice.tag, accounts.length))
  }
  const fileDraws = new Map<string, ReturnType<typeof drawShareFiles>>()
  for (const choice of selection.files) {
    const pool = filePool(choice.source)
    if (pool === null) continue
    fileDraws.set(
      `${choice.sequence}:${choice.source}`,
      drawShareFiles(catalog, choice.deviceId, choice.directory, pool, choice.mode, accounts.length),
    )
  }
  void sharePaths
  const constrainBoxes = selection.boxes !== null || selection.boxIds.length > 0
  const constrainProxies = selection.proxies !== null || selection.proxyTag !== null || selection.proxyIds.length > 0
  return accounts.map((account, accountIndex) => {
    const chosen = new Set(selection.boxIds)
    const grouped = selection.boxIds.length === 0 ? [] : devices.filter((item) => chosen.has(item.id))
    const savedDevice = devices.find((item) => item.id === account.deviceId) ?? null
    const device = constrainBoxes
      ? takeBalanced(grouped, deviceCounts)
      : savedDevice !== null
        ? savedDevice
        : takeBalanced(devices, deviceCounts)
    if (!constrainBoxes && savedDevice !== null) {
      deviceCounts.set(savedDevice.id, (deviceCounts.get(savedDevice.id) ?? 0) + 1)
    }
    const manualPits = [...new Set(selection.pitIndexes)]
    const savedPit =
      device !== null && account.deviceId === device.id ? account.instanceIndex : null
    const instanceIndex =
      manualPits.length > 0
        ? pickPit(device?.id ?? null, manualPits, pitCounts)
        : savedPit !== null
          ? savedPit
          : pickPit(device?.id ?? null, [1, 2, 3, 4, 5], pitCounts)
    if (savedPit !== null && manualPits.length === 0 && device !== null) {
      const pitKey = `${device.id}#${savedPit}`
      pitCounts.set(pitKey, (pitCounts.get(pitKey) ?? 0) + 1)
    }
    const tagged =
      selection.proxyIds.length > 0
        ? readyProxies.filter((item) => selection.proxyIds.includes(item.id))
        : selection.proxyTag === null
          ? []
          : readyProxies.filter((item) => item.tags.includes(selection.proxyTag ?? ""))
    const savedProxy = readyProxies.find((item) => item.id === account.proxyId) ?? null
    const proxy = constrainProxies
      ? takeBalanced(tagged, proxyCounts)
      : savedProxy !== null
        ? savedProxy
        : takeBalanced(readyProxies, proxyCounts)
    if (!constrainProxies && savedProxy !== null) {
      proxyCounts.set(savedProxy.id, (proxyCounts.get(savedProxy.id) ?? 0) + 1)
    }
    const instance =
      instances.find((item) => item.deviceId === device?.id && item.index === instanceIndex) ??
      null
    const filled = steps.map((step, sequence) => {
      const choice = selection.texts.some((item) => item.sequence === sequence)
      const drawn = textDraws.get(sequence)?.[accountIndex]
      const text = choice && drawn !== undefined && drawn.content.length > 0 ? drawn : null
      const video = fileDraws.get(`${sequence}:pool.video`)?.[accountIndex]
      const image = fileDraws.get(`${sequence}:pool.image`)?.[accountIndex]
      const backupFile = fileDraws.get(`${sequence}:pool.backup`)?.[accountIndex]
      const result = fillStep(step, {
        account: {
          backupDevice:
            account.backupDeviceId === null ? "" : (backupHosts.get(account.backupDeviceId) ?? ""),
          backupKey: account.backupKey,
          identifier: account.identifier,
          language: account.language,
          region: account.region,
          secret: decryptSecret(cipher, account.encryptedSecret),
        },
        device: device === null ? null : { host: device.host },
        instance: instanceIndex === null ? null : { index: String(instanceIndex) },
        manualText: choice,
        proxy,
        text,
        backup: backupFile?.path ?? "",
        backupFileHost: backupFile?.host ?? "",
        image: image?.path ?? "",
        imageHost: image?.host ?? "",
        video: video?.path ?? "",
        videoHost: video?.host ?? "",
      })
      return { ...step, sequence, ...result }
    })
    const proxyMissing =
      proxy === null &&
      filled.some((step) => step.missingKeys.some((key) => (step.sources[key] ?? "").startsWith("proxy.")))
    const missing = [
      ...(device === null ? ["device"] : []),
      ...(instanceIndex === null ? ["pit"] : []),
      ...(proxyMissing ? ["proxy"] : []),
      ...filled.flatMap((step) =>
        step.skill === "SendText" && step.missingKeys.includes("text") ? [`text:${step.sequence}`] : [],
      ),
    ]
    const incomplete = missing.length > 0 || filled.some((step) => step.missingKeys.length > 0)
    return {
      accountId: account.id,
      deviceHost: device?.host ?? "",
      deviceId: device?.id ?? null,
      deviceName: device?.name ?? "",
      filled,
      identifier: account.identifier,
      instanceId: instance?.id ?? null,
      instanceIndex,
      missing,
      note: account.note,
      proxyId: proxy?.id ?? null,
      proxyName: proxy?.name ?? "",
      status: incomplete ? ("incomplete" as const) : ("ready" as const),
    }
  })
}

export const createDispatchRepository = (sql: Sql, cipher: SecretCipher) => {
  const workspace = async (
    groupId: string,
    administratorId: string,
    chainId: string,
    selection: DispatchSelection,
  ) => {
    const chains = await sql<
      {
        delays: number[]
        guards: string[][]
        id: string
        name: string
        parameters: { input?: unknown; skill?: unknown }[]
        paramScopes: unknown[]
        paramSources: unknown[]
      }[]
    >`
      select id::text as id, name, parameters, param_scopes as "paramScopes",
        param_sources as "paramSources", guards, delays
      from behavior_chain
      where id = ${chainId}::uuid and administrator_id = ${administratorId}::uuid`
    const chain = chains[0]
    if (chain === undefined) return null
    const accountIds = [...selection.accountIds]
    const useIds = accountIds.length > 0
    const accounts = await sql<AccountRow[]>`
      select a.id::text as id, a.identifier, a.note, a.encrypted_secret as "encryptedSecret",
        a.region, a.language, a.backup_key as "backupKey", a.backup_device_id::text as "backupDeviceId",
        a.device_id::text as "deviceId", a.proxy_id::text as "proxyId", i.instance_index as "instanceIndex"
      from operation_account a
      left join device_instance i on i.id = a.device_instance_id
      where a.group_id = ${groupId}::uuid and not a.deleted
        and (
          (${useIds} and a.id = any(${accountIds}::uuid[]))
          or (not ${useIds} and ${selection.accountNote} <> '' and a.note = ${selection.accountNote})
        )
      order by a.identifier, a.id`
    const devices = await sql<DeviceRow[]>`
      select d.id::text as id, d.host, d.name
      from device d
      where d.group_id = ${groupId}::uuid and d.enabled and not d.assignment_pending
        and exists (
          select 1 from device_group_history h where h.device_id = d.id and h.group_id = d.group_id
        )
      order by d.id`
    const deviceIds = devices.map((item) => item.id)
    const instances = await sql<{ deviceId: string; id: string; index: number }[]>`
      select id::text as id, device_id::text as "deviceId", instance_index as index
      from device_instance where device_id = any(${deviceIds}::uuid[])`
    const proxies = await sql<ProxyRow[]>`
      select p.id::text as id, p.name, p.endpoint, p.configuration,
        p.encrypted_credentials as credentials, p.tags, link.credentials as "linkCredentials"
      from operation_proxy p
      left join lateral (
        select accel.encrypted_credentials as credentials
        from operation_proxy_accelerator edge
        join operation_proxy accel on accel.id = edge.accelerator_id
        where edge.proxy_id = p.id and edge.group_id = p.group_id
        order by edge.position
        limit 1
      ) link on true
      where p.group_id = ${groupId}::uuid and p.status = 'ready'
      order by p.id`
    const texts = await sql<TextMaterial[]>`
      select id::text as id, name as content, category, created_at::text as "createdAt"
      from operation_resource
      where group_id = ${groupId}::uuid and status <> 'inactive'
      order by created_at, id`
    const backupIds = accounts.flatMap((item) => (item.backupDeviceId === null ? [] : [item.backupDeviceId]))
    const backups = await sql<{ host: string; id: string }[]>`
      select id::text as id, host from device where id = any(${backupIds}::uuid[])`
    return {
      accounts,
      backups: new Map(backups.map((item) => [item.id, item.host])),
      chain,
      devices,
      instances,
      proxies,
      catalog: await loadCatalog(sql, selection.files.map((item) => item.deviceId)),
      sharePaths: await loadSharePaths(sql, devices.map((item) => item.id)),
      steps: chainSteps(chain),
      texts,
    }
  }

  const accountsForPool = async (groupId: string, poolId: string): Promise<readonly string[] | null> => {
    const rows = await sql<{ filter_condition: unknown }[]>`
      select filter_condition from operation_account_pool
      where group_id = ${groupId}::uuid and id = ${poolId}::uuid and deleted_at is null`
    const row = rows[0]
    if (row === undefined) return null
    const query = readDeskQuery(row.filter_condition)
    if (query !== null) {
      const matched = await listDeskAccounts(sql, cipher, groupId, query)
      return matched.map((item) => item.id)
    }
    const members = await sql<{ id: string }[]>`
      select account_id::text as id from operation_account_pool_member
      where pool_id = ${poolId}::uuid
      order by position`
    return members.map((item) => item.id)
  }

  const accountsForSet = async (groupId: string, set: NamedSet): Promise<readonly string[]> => {
    if (set.by === "group") {
      const rows = await sql<{ id: string }[]>`
        select id::text as id from operation_account
        where group_id = ${groupId}::uuid and not deleted and coalesce(tags[1], '') = ${set.name}
        order by identifier, id`
      return rows.map((item) => item.id)
    }
    const rows = await sql<{ id: string }[]>`
      select id::text as id from operation_account
      where group_id = ${groupId}::uuid and not deleted
        and ${set.name} = any(tags[2:cardinality(tags)])
      order by identifier, id`
    return rows.map((item) => item.id)
  }

  const devicesForSet = async (groupId: string, set: NamedSet): Promise<readonly string[]> => {
    if (set.by === "remark") {
      const rows = await sql<{ id: string }[]>`
        select d.id::text as id from device d
        join device_remark r on r.device_id = d.id
        join business_label l on l.id = r.label_id
        where d.group_id = ${groupId}::uuid and d.enabled and not d.assignment_pending
          and l.scope = 'device' and l.kind = 'remark' and l.name = ${set.name}
        order by d.id`
      return rows.map((item) => item.id)
    }
    const rows = await sql<{ id: string }[]>`
      select d.id::text as id from device d
      join business_label l on l.id = d.box_group_id
      where d.group_id = ${groupId}::uuid and d.enabled and not d.assignment_pending
        and l.scope = 'device' and l.kind = 'group' and l.name = ${set.name}
      order by d.id`
    return rows.map((item) => item.id)
  }

  const proxiesForSet = async (groupId: string, set: NamedSet): Promise<readonly string[]> => {
    if (set.by === "remark") {
      const rows = await sql<{ id: string }[]>`
        select id::text as id from operation_proxy
        where group_id = ${groupId}::uuid and status = 'ready' and exists (
          select 1 from unnest(string_to_array(btrim(coalesce(note, '')), ${"\u001e"})) as part(name)
          where btrim(name) = ${set.name}
        )
        order by id`
      return rows.map((item) => item.id)
    }
    const rows = await sql<{ id: string }[]>`
      select id::text as id from operation_proxy
      where group_id = ${groupId}::uuid and status = 'ready' and coalesce(tags[1], '') = ${set.name}
      order by id`
    return rows.map((item) => item.id)
  }

  return {
    options: async (groupId: string, administratorId: string | null) => {
      const [pools, devices, proxyTags, textTags, chains, accountGroups, accountTags, boxGroups, boxRemarks, proxyGroups, proxyRemarks] = await Promise.all([
        sql<{ id: string; key: string }[]>`
          select id::text as id, key from operation_account_pool
          where group_id = ${groupId}::uuid and deleted_at is null
          order by display_id desc`,
        sql<{ host: string; id: string; name: string }[]>`
          select d.id::text as id, d.name, d.host from device d
          where d.group_id = ${groupId}::uuid and d.enabled and not d.assignment_pending
            and exists (
              select 1 from device_group_history h where h.device_id = d.id and h.group_id = d.group_id
            )
          order by d.host, d.id`,
        sql<{ tag: string }[]>`
          select distinct tag from operation_proxy, unnest(tags) as tag
          where group_id = ${groupId}::uuid and status = 'ready' order by tag`,
        sql<{ category: string }[]>`
          select distinct category from operation_resource
          where group_id = ${groupId}::uuid and category <> '' order by category`,
        administratorId === null
          ? Promise.resolve([] as { id: string; name: string; parameters: unknown; paramScopes: unknown; paramSources: unknown }[])
          : sql<{ id: string; name: string; parameters: unknown; paramScopes: unknown; paramSources: unknown }[]>`
              select id::text as id, name, parameters, param_scopes as "paramScopes", param_sources as "paramSources"
              from behavior_chain where administrator_id = ${administratorId}::uuid
              order by updated_at desc`,
        sql<{ name: string }[]>`
          select distinct coalesce(tags[1], '') as name from operation_account
          where group_id = ${groupId}::uuid and not deleted and coalesce(tags[1], '') <> ''
          order by name`,
        sql<{ name: string }[]>`
          select distinct tag as name from operation_account, unnest(tags[2:cardinality(tags)]) as tag
          where group_id = ${groupId}::uuid and not deleted and tag <> ''
          order by name`,
        sql<{ name: string }[]>`
          select distinct l.name from device d
          join business_label l on l.id = d.box_group_id
          where d.group_id = ${groupId}::uuid and l.scope = 'device' and l.kind = 'group'
          order by l.name`,
        sql<{ name: string }[]>`
          select distinct l.name from device d
          join device_remark r on r.device_id = d.id
          join business_label l on l.id = r.label_id
          where d.group_id = ${groupId}::uuid and l.scope = 'device' and l.kind = 'remark'
          order by l.name`,
        sql<{ name: string }[]>`
          select distinct coalesce(tags[1], '') as name from operation_proxy
          where group_id = ${groupId}::uuid and status = 'ready' and coalesce(tags[1], '') <> ''
          order by name`,
        sql<{ name: string }[]>`
          select distinct btrim(part.name) as name from operation_proxy,
            unnest(string_to_array(btrim(coalesce(note, '')), ${"\u001e"})) as part(name)
          where group_id = ${groupId}::uuid and status = 'ready' and btrim(part.name) <> ''
          order by name`,
      ])
      return {
        accountGroups: accountGroups.map((row) => row.name),
        accountTags: accountTags.map((row) => row.name),
        boxGroups: boxGroups.map((row) => row.name),
        boxRemarks: boxRemarks.map((row) => row.name),
        devices,
        pools,
        chains: chains.map((row) => ({
          id: row.id,
          name: row.name,
          steps: chainSteps({
            delays: [],
            guards: [],
            parameters: Array.isArray(row.parameters) ? row.parameters : [],
            paramScopes: Array.isArray(row.paramScopes) ? row.paramScopes : [],
            paramSources: Array.isArray(row.paramSources) ? row.paramSources : [],
          }).map((step) => ({ api: step.skill, scopes: step.scopes, sources: step.sources })),
        })),
        pits: [1, 2, 3, 4, 5],
        proxyGroups: proxyGroups.map((row) => row.name),
        proxyRemarks: proxyRemarks.map((row) => row.name),
        proxyTags: proxyTags.map((row) => row.tag),
        textTags: textTags.map((row) => row.category),
      }
    },
    directories: async (groupId: string, deviceId: string, source: FileChoice["source"]) => {
      const rows = await sql<{ bucket: string; count: number; directory: string }[]>`
        select e.bucket, e.parent_path as directory, count(*)::int as count
        from box_share_entry e
        join device d on d.id = e.device_id
        where d.group_id = ${groupId}::uuid and d.id = ${deviceId}::uuid
          and e.kind = 'file' and e.sha256 <> ''
          and (
            (${source} = 'pool.backup' and e.bucket = 'backup')
            or (${source} = 'pool.video' and e.category = 'video' and e.bucket <> 'backup')
            or (${source} = 'pool.image' and e.category = 'image' and e.bucket <> 'backup')
          )
        group by e.bucket, e.parent_path
        order by e.bucket, e.parent_path`
      return rows
    },
    create: async (groupId: string, actorId: string, administratorId: string, chainId: string, selection: DispatchSelection) => {
      const accountIds =
        selection.accounts === null
          ? await accountsForPool(groupId, selection.poolId)
          : await accountsForSet(groupId, selection.accounts)
      if (accountIds === null) return { kind: "missing_pool" as const }
      if (accountIds.length === 0) return { kind: "no_accounts" as const }
      const boxIds = selection.boxes === null ? selection.boxIds : await devicesForSet(groupId, selection.boxes)
      const proxyIds = selection.proxies === null ? selection.proxyIds : await proxiesForSet(groupId, selection.proxies)
      const selected = { ...selection, accountIds, accountNote: "", boxIds, proxyIds }
      const loaded = await workspace(groupId, administratorId, chainId, selected)
      if (loaded === null) return { kind: "missing_chain" as const }
      if (loaded.accounts.length === 0) return { kind: "no_accounts" as const }
      const planned = planDispatch(
        cipher,
        selected,
        loaded.accounts,
        loaded.devices,
        loaded.instances,
        loaded.proxies,
        loaded.texts,
        loaded.backups,
        loaded.sharePaths,
        loaded.catalog,
        loaded.steps,
      )
      const status = planned.some((item) => item.status === "incomplete") ? "incomplete" : "ready"
      const dispatchId = randomUUID()
      await sql.begin(async (tx) => {
        await tx`
          insert into operation_dispatch (id, group_id, requester_id, chain_id, name, selection, status)
          values (
            ${dispatchId}::uuid, ${groupId}::uuid, ${actorId}::uuid, ${chainId}::uuid,
            ${loaded.chain.name}, ${tx.json(selected)}, ${status}
          )`
        for (const item of planned) {
          const itemId = randomUUID()
          await tx`
            insert into operation_dispatch_item (
              id, dispatch_id, group_id, account_id, device_id, instance_index, instance_id, proxy_id, missing, status
            ) values (
              ${itemId}::uuid, ${dispatchId}::uuid, ${groupId}::uuid, ${item.accountId}::uuid,
              ${item.deviceId}::uuid, ${item.instanceIndex}, ${item.instanceId}::uuid, ${item.proxyId}::uuid,
              ${tx.json(item.missing)}, ${item.status}
            )`
          for (const step of item.filled) {
            await tx`
              insert into operation_dispatch_step (
                id, item_id, sequence, skill, sources, scopes, parameters, fill_status, missing_keys,
                text_resource_id, guards, after_ms
              ) values (
                ${randomUUID()}::uuid, ${itemId}::uuid, ${step.sequence}, ${step.skill},
                ${tx.json(step.sources)}, ${tx.json(step.scopes)}, ${tx.json(step.parameters)},
                ${step.missingKeys.length === 0 ? "complete" : "incomplete"}, ${step.missingKeys},
                ${step.textResourceId === null || step.textResourceId.length === 0 ? null : step.textResourceId}::uuid,
                ${tx.json(step.guards)}, ${step.afterMs}
              )`
          }
        }
      })
      return { id: dispatchId, items: planned, kind: "created" as const, name: loaded.chain.name, status }
    },
    list: async (groupId: string) => {
      const rows = await sql<
        {
          account: string
          accountId: string
          chainName: string
          createdAt: Date
          deviceHost: string
          deviceName: string
          dispatchId: string
          identifier: string
          instanceIndex: number | null
          itemId: string
          itemStatus: string
          missing: string[]
          name: string
          note: string
          proxyName: string
          status: string
        }[]
      >`
        select d.id::text as "dispatchId", d.name, d.status, d.created_at as "createdAt", c.name as "chainName",
          i.id::text as "itemId", i.status as "itemStatus", i.missing, i.instance_index as "instanceIndex",
          a.id::text as "accountId", a.identifier, a.note, coalesce(dev.name, '') as "deviceName", coalesce(dev.host, '') as "deviceHost",
          coalesce(p.name, '') as "proxyName"
        from operation_dispatch d
        join behavior_chain c on c.id = d.chain_id
        join operation_dispatch_item i on i.dispatch_id = d.id
        join operation_account a on a.id = i.account_id
        left join device dev on dev.id = i.device_id
        left join operation_proxy p on p.id = i.proxy_id
        where d.group_id = ${groupId}::uuid
        order by d.created_at desc, a.identifier`
      const itemIds = rows.map((row) => row.itemId)
      const stepRows =
        itemIds.length === 0
          ? []
          : await sql<{ itemId: string; parameters: Record<string, string>; sources: Record<string, string> }[]>`
              select item_id::text as "itemId", parameters, sources
              from operation_dispatch_step
              where item_id = any(${itemIds}::uuid[])`
      const filesOf = new Map<string, { backupHost: string; backupPath: string; videoHost: string; videoPath: string }>()
      for (const step of stepRows) {
        const current = filesOf.get(step.itemId) ?? { backupHost: "", backupPath: "", videoHost: "", videoPath: "" }
        for (const [key, source] of Object.entries(step.sources ?? {})) {
          const value = step.parameters?.[key] ?? ""
          if (source === "pool.video") current.videoPath = value
          if (source === "pool.video_host") current.videoHost = value
          if (source === "pool.backup") current.backupPath = value
          if (source === "pool.backup_host") current.backupHost = value
        }
        filesOf.set(step.itemId, current)
      }
      const grouped = new Map<string, (typeof rows)[number][]>()
      for (const row of rows) {
        const list = grouped.get(row.dispatchId) ?? []
        list.push(row)
        grouped.set(row.dispatchId, list)
      }
      return [...grouped.values()].map((items) => {
        const first = items[0]
        if (first === undefined) return null
        return {
          accountCount: items.length,
          accounts: items.map((item) => ({
            deviceHost: item.deviceHost,
            deviceName: item.deviceName,
            accountId: item.accountId,
            id: item.itemId,
            identifier: item.identifier,
            instanceIndex: item.instanceIndex,
            missing: item.missing,
            note: item.note,
            proxyName: item.proxyName,
            ...(filesOf.get(item.itemId) ?? { backupHost: "", backupPath: "", videoHost: "", videoPath: "" }),
            status: item.itemStatus,
          })),
          chainName: first.chainName,
          createdAt: first.createdAt,
          id: first.dispatchId,
          missing: [...new Set(items.flatMap((item) => item.missing))],
          name: first.name,
          status: first.status,
        }
      }).filter((item) => item !== null)
    },
    start: async (groupId: string, actorId: string, ids: readonly string[]) => {
      return sql.begin(async (tx) => {
        const locked = await tx<{ id: string; status: string }[]>`
          select id::text as id, status from operation_dispatch
          where group_id = ${groupId}::uuid and id = any(${[...ids]}::uuid[])
          for update`
        if (locked.length !== ids.length) return { kind: "missing" as const }
        const gaps = await tx<
          { account: string; dispatchId: string; keys: string[]; sequence: number }[]
        >`
          select i.dispatch_id::text as "dispatchId", a.identifier as account, s.sequence, s.missing_keys as keys
          from operation_dispatch_item i
          join operation_account a on a.id = i.account_id
          join operation_dispatch_step s on s.item_id = i.id
          where i.dispatch_id = any(${[...ids]}::uuid[])
            and (i.status = 'incomplete' or s.fill_status = 'incomplete')
          order by a.identifier, s.sequence`
        if (gaps.length > 0) return { gaps, kind: "incomplete" as const }
        const items = await tx<
          {
            accountId: string
            afterMs: number
            deviceId: string
            guards: string[]
            instanceId: string | null
            instanceIndex: number
            itemId: string
            name: string
            parameters: Record<string, string>
            proxyId: string | null
            sequence: number
            skill: string
            sources: Record<string, string>
            backupDeviceId: string | null
          }[]
        >`
          select i.id::text as "itemId", i.account_id::text as "accountId", i.device_id::text as "deviceId",
            i.instance_index as "instanceIndex", i.instance_id::text as "instanceId", i.proxy_id::text as "proxyId",
            d.name, s.sequence, s.skill, s.parameters, s.sources, s.guards, s.after_ms as "afterMs",
            a.backup_device_id::text as "backupDeviceId"
          from operation_dispatch_item i
          join operation_dispatch d on d.id = i.dispatch_id
          join operation_dispatch_step s on s.item_id = i.id
          join operation_account a on a.id = i.account_id
          where i.dispatch_id = any(${[...ids]}::uuid[]) and i.status = 'ready'
          order by i.id, s.sequence`
        const byItem = new Map<string, typeof items>()
        for (const row of items) {
          const list = byItem.get(row.itemId) ?? []
          list.push(row)
          byItem.set(row.itemId, list)
        }
        const hostIds = [
          ...new Set(
            items.flatMap((item) =>
              [item.deviceId, item.backupDeviceId].filter((id): id is string => id !== null && id.length > 0),
            ),
          ),
        ]
        const hostRows =
          hostIds.length === 0
            ? []
            : await tx<{ host: string; id: string }[]>`
                select id::text as id, host from device where id = any(${hostIds}::uuid[])`
        const hostOf = new Map(hostRows.map((item) => [item.id, item.host]))
        const devices = new Set<string>()
        for (const [itemId, steps] of byItem) {
          const first = steps[0]
          if (first === undefined || first.deviceId === null) continue
          const current = {
            backupHost: first.backupDeviceId === null ? "" : (hostOf.get(first.backupDeviceId) ?? ""),
            deviceHost: hostOf.get(first.deviceId) ?? "",
          }
          const refreshed = steps.map((step) => ({
            ...step,
            parameters: refreshDeviceHosts(step.parameters, step.sources, current).parameters,
          }))
          const taskId = randomUUID()
          const key = `dispatch:${itemId}`
          const parameters = refreshed.map((step) => ({ input: step.parameters, skill: step.skill }))
          const guards = steps.map((step) => step.guards)
          const delays = steps.map((step) => step.afterMs)
          const digest = hashValue({
            delays,
            deviceId: first.deviceId,
            guards,
            indexNum: first.instanceIndex,
            parameters,
          })
          const inserted = await tx<{ id: string }[]>`
            insert into execution_task (
              id, group_id, requester_id, device_id, account_id, idempotency_key, fingerprint,
              name, executor_key, parameters, status
            ) values (
              ${taskId}::uuid, ${groupId}::uuid, ${actorId}::uuid, ${first.deviceId}::uuid,
              ${first.accountId}::uuid, ${key}, ${digest}, ${first.name}, 'box-agent',
              ${tx.json(parameters)}, 'queued'
            ) on conflict (group_id, idempotency_key) do nothing returning id::text as id`
          const existing = inserted[0]?.id
          const resolved = existing ?? (
            await tx<{ id: string }[]>`
              select id::text as id from execution_task
              where group_id = ${groupId}::uuid and idempotency_key = ${key}`
          )[0]?.id
          if (resolved === undefined) continue
          if (existing !== undefined) {
            for (const [sequence, step] of refreshed.entries()) {
              await tx`
                insert into execution_task_step (
                  id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target,
                  parameters, status, instance_id, guards, after_ms
                ) values (
                  ${randomUUID()}::uuid, ${resolved}::uuid, ${groupId}::uuid, ${sequence},
                  ${`${key}:${sequence}`}, ${key}, ${step.skill}, ${tx.json({ indexNum: step.instanceIndex })},
                  ${tx.json(step.parameters)}, 'pending', ${step.instanceId}::uuid, ${tx.json(step.guards)},
                  ${step.afterMs}
                )`
            }
          }
          await tx`
            update operation_dispatch_item
            set execution_task_id = ${resolved}::uuid, status = 'started'
            where id = ${itemId}::uuid`
          await tx`
            update operation_account
            set device_id = ${first.deviceId}::uuid,
              device_instance_id = ${first.instanceId}::uuid,
              proxy_id = coalesce(${first.proxyId}::uuid, proxy_id),
              updated_at = now()
            where id = ${first.accountId}::uuid and group_id = ${groupId}::uuid`
          devices.add(first.deviceId)
        }
        await tx`
          update operation_dispatch set status = 'started', updated_at = now()
          where id = any(${[...ids]}::uuid[]) and group_id = ${groupId}::uuid`
        return { devices: [...devices], kind: "started" as const }
      })
    },
    notify: async (deviceIds: readonly string[]) => {
      for (const deviceId of deviceIds) await sql`select pg_notify('agent_task', ${deviceId})`
    },
    clearRecords: async (groupId: string, deviceIds: readonly string[], unassigned: boolean) => {
      if (deviceIds.length === 0 && !unassigned) return 0
      const ids = deviceIds.length === 0 ? ["00000000-0000-0000-0000-000000000000"] : [...deviceIds]
      const hasDevices = deviceIds.length > 0
      return sql.begin(async (tx) => {
        const tasks = await tx<{ id: string }[]>`
          select id::text as id from execution_task
          where group_id = ${groupId}::uuid and ${hasDevices} and device_id = any(${ids}::uuid[])
          union
          select execution_task_id::text as id from operation_dispatch_item
          where group_id = ${groupId}::uuid and execution_task_id is not null
            and (
              (${hasDevices} and device_id = any(${ids}::uuid[]))
              or (${unassigned} and device_id is null)
            )`
        const taskIds = tasks.map((task) => task.id)
        const removedItems = await tx<{ dispatchId: string }[]>`
          delete from operation_dispatch_item
          where group_id = ${groupId}::uuid
            and (
              (${hasDevices} and device_id = any(${ids}::uuid[]))
              or (${unassigned} and device_id is null)
            )
          returning dispatch_id::text as "dispatchId"`
        const dispatchIds = [...new Set(removedItems.map((item) => item.dispatchId))]
        if (dispatchIds.length > 0) {
          await tx`
            delete from operation_dispatch d
            where d.group_id = ${groupId}::uuid and d.id = any(${dispatchIds}::uuid[])
              and not exists (select 1 from operation_dispatch_item i where i.dispatch_id = d.id)`
        }
        if (taskIds.length === 0) return 0
        await tx`
          delete from execution_task_outbox
          where group_id = ${groupId}::uuid and task_id = any(${taskIds}::uuid[])`
        await tx`
          delete from execution_task_run
          where group_id = ${groupId}::uuid and task_id = any(${taskIds}::uuid[])`
        await tx`
          delete from execution_task_device_lease
          where group_id = ${groupId}::uuid and task_id = any(${taskIds}::uuid[])`
        await tx`
          delete from execution_task_event
          where group_id = ${groupId}::uuid and task_id = any(${taskIds}::uuid[])`
        await tx`
          update execution_task_step set parent_step_id = null
          where parent_step_id in (
            select id from execution_task_step
            where group_id = ${groupId}::uuid and task_id = any(${taskIds}::uuid[])
          )`
        await tx`
          delete from execution_task_step
          where group_id = ${groupId}::uuid and task_id = any(${taskIds}::uuid[])`
        const deleted = await tx<{ id: string }[]>`
          delete from execution_task
          where group_id = ${groupId}::uuid and id = any(${taskIds}::uuid[])
          returning id::text as id`
        return deleted.length
      })
    },
    records: async (groupId: string) => {
      const dispatchRows = await sql<
        {
          account: string
          deviceHost: string
          deviceId: string | null
          deviceName: string
          itemId: string
          itemStatus: string
          name: string
          parameters: Record<string, string>
          sequence: number
          skill: string
          stepStatus: string
        }[]
      >`
        select i.id::text as "itemId", d.name, i.status as "itemStatus", a.identifier as account,
          i.device_id::text as "deviceId", coalesce(dev.name, '') as "deviceName",
          coalesce(dev.host, '') as "deviceHost", s.sequence, s.skill,
          coalesce(es.parameters, s.parameters) as parameters,
          coalesce(es.status, s.fill_status) as "stepStatus"
        from operation_dispatch_item i
        join operation_dispatch d on d.id = i.dispatch_id
        join operation_account a on a.id = i.account_id
        join operation_dispatch_step s on s.item_id = i.id
        left join device dev on dev.id = i.device_id
        left join execution_task_step es on es.task_id = i.execution_task_id and es.sequence = s.sequence
        where d.group_id = ${groupId}::uuid
        order by dev.host, a.identifier, s.sequence`
      const legacy = await sql<
        {
          account: string
          deviceHost: string
          deviceId: string
          deviceName: string
          name: string
          parameters: Record<string, string>
          sequence: number
          skill: string
          status: string
          stepStatus: string
          taskId: string
        }[]
      >`
        select t.id::text as "taskId", t.name, t.status, t.device_id::text as "deviceId",
          coalesce(dev.name, '') as "deviceName", coalesce(dev.host, '') as "deviceHost",
          coalesce(a.identifier, '') as account, s.sequence, s.kind as skill, s.parameters, s.status as "stepStatus"
        from execution_task t
        join execution_task_step s on s.task_id = t.id
        left join device dev on dev.id = t.device_id
        left join operation_account a on a.id = t.account_id
        where t.group_id = ${groupId}::uuid
          and not exists (
            select 1 from operation_dispatch_item i where i.execution_task_id = t.id
          )
        order by dev.host, t.created_at, s.sequence`
      return { dispatchRows, legacy }
    },
  }
}
