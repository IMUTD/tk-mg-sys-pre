import { createHash, randomUUID } from "node:crypto"

import type { Sql } from "postgres"

import type { SecretCipher } from "../../lib/crypto"
import { fingerprint } from "../box-contract"
import { parseCredentials } from "../proxies/configuration"
import { takeBalanced } from "./allocate"
import { drawTexts, fillStep, type FillProxy, resolveProxyLink, type TextMaterial } from "./fill"

export type TextChoice = {
  readonly mode: "random" | "sequence" | "tag"
  readonly sequence: number
  readonly tag?: string
}

export type DispatchSelection = {
  readonly accountIds: readonly string[]
  readonly accountNote: string
  readonly boxIds: readonly string[]
  readonly pitIndexes: readonly number[]
  readonly proxyTag: string | null
  readonly texts: readonly TextChoice[]
}

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

const decryptSecret = (cipher: SecretCipher, value: string): string => {
  if (value.length === 0) return ""
  try {
    return cipher.decrypt(value)
  } catch {
    return ""
  }
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
  return accounts.map((account, accountIndex) => {
    const chosen = new Set(selection.boxIds)
    const grouped = selection.boxIds.length === 0 ? [] : devices.filter((item) => chosen.has(item.id))
    const savedDevice = devices.find((item) => item.id === account.deviceId) ?? null
    const device =
      selection.boxIds.length > 0
        ? takeBalanced(grouped, deviceCounts)
        : savedDevice !== null
          ? savedDevice
          : takeBalanced(devices, deviceCounts)
    if (selection.boxIds.length === 0 && savedDevice !== null) {
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
      selection.proxyTag === null
        ? []
        : readyProxies.filter((item) => item.tags.includes(selection.proxyTag ?? ""))
    const savedProxy = readyProxies.find((item) => item.id === account.proxyId) ?? null
    const proxy =
      selection.proxyTag !== null
        ? takeBalanced(tagged, proxyCounts)
        : savedProxy !== null
          ? savedProxy
          : takeBalanced(readyProxies, proxyCounts)
    if (selection.proxyTag === null && savedProxy !== null) {
      proxyCounts.set(savedProxy.id, (proxyCounts.get(savedProxy.id) ?? 0) + 1)
    }
    const instance =
      instances.find((item) => item.deviceId === device?.id && item.index === instanceIndex) ??
      null
    const filled = steps.map((step, sequence) => {
      const choice = selection.texts.some((item) => item.sequence === sequence)
      const drawn = textDraws.get(sequence)?.[accountIndex]
      const text = choice && drawn !== undefined && drawn.content.length > 0 ? drawn : null
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
        video: "",
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
      steps: chainSteps(chain),
      texts,
    }
  }

  return {
    options: async (groupId: string, administratorId: string | null) => {
      const [accounts, notes, devices, proxyTags, textTags, chains] = await Promise.all([
        sql<{ id: string; identifier: string; note: string }[]>`
          select id::text as id, identifier, note from operation_account
          where group_id = ${groupId}::uuid and not deleted
          order by identifier, id`,
        sql<{ note: string }[]>`
          select distinct note from operation_account
          where group_id = ${groupId}::uuid and not deleted and note <> '' order by note`,
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
      ])
      return {
        accountNotes: notes.map((row) => row.note),
        accounts: accounts.map((row) => ({ id: row.id, identifier: row.identifier, note: row.note })),
        devices,
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
        proxyTags: proxyTags.map((row) => row.tag),
        textTags: textTags.map((row) => row.category),
      }
    },
    create: async (groupId: string, actorId: string, administratorId: string, chainId: string, selection: DispatchSelection) => {
      const loaded = await workspace(groupId, administratorId, chainId, selection)
      if (loaded === null) return { kind: "missing_chain" as const }
      if (loaded.accounts.length === 0) return { kind: "no_accounts" as const }
      const planned = planDispatch(
        cipher,
        selection,
        loaded.accounts,
        loaded.devices,
        loaded.instances,
        loaded.proxies,
        loaded.texts,
        loaded.backups,
        loaded.steps,
      )
      const status = planned.some((item) => item.status === "incomplete") ? "incomplete" : "ready"
      const dispatchId = randomUUID()
      await sql.begin(async (tx) => {
        await tx`
          insert into operation_dispatch (id, group_id, requester_id, chain_id, name, selection, status)
          values (
            ${dispatchId}::uuid, ${groupId}::uuid, ${actorId}::uuid, ${chainId}::uuid,
            ${loaded.chain.name}, ${tx.json(selection)}, ${status}
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
          a.identifier, a.note, coalesce(dev.name, '') as "deviceName", coalesce(dev.host, '') as "deviceHost",
          coalesce(p.name, '') as "proxyName"
        from operation_dispatch d
        join behavior_chain c on c.id = d.chain_id
        join operation_dispatch_item i on i.dispatch_id = d.id
        join operation_account a on a.id = i.account_id
        left join device dev on dev.id = i.device_id
        left join operation_proxy p on p.id = i.proxy_id
        where d.group_id = ${groupId}::uuid
        order by d.created_at desc, a.identifier`
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
            id: item.itemId,
            identifier: item.identifier,
            instanceIndex: item.instanceIndex,
            missing: item.missing,
            note: item.note,
            proxyName: item.proxyName,
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
          }[]
        >`
          select i.id::text as "itemId", i.account_id::text as "accountId", i.device_id::text as "deviceId",
            i.instance_index as "instanceIndex", i.instance_id::text as "instanceId", i.proxy_id::text as "proxyId",
            d.name, s.sequence, s.skill, s.parameters, s.guards, s.after_ms as "afterMs"
          from operation_dispatch_item i
          join operation_dispatch d on d.id = i.dispatch_id
          join operation_dispatch_step s on s.item_id = i.id
          where i.dispatch_id = any(${[...ids]}::uuid[]) and i.status = 'ready'
          order by i.id, s.sequence`
        const byItem = new Map<string, typeof items>()
        for (const row of items) {
          const list = byItem.get(row.itemId) ?? []
          list.push(row)
          byItem.set(row.itemId, list)
        }
        const devices = new Set<string>()
        for (const [itemId, steps] of byItem) {
          const first = steps[0]
          if (first === undefined || first.deviceId === null) continue
          const taskId = randomUUID()
          const key = `dispatch:${itemId}`
          const parameters = steps.map((step) => ({ input: step.parameters, skill: step.skill }))
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
            for (const [sequence, step] of steps.entries()) {
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
