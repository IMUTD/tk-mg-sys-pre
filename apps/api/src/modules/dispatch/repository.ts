import { createHash, randomUUID } from "node:crypto"

import type { Sql } from "postgres"

import type { SecretCipher } from "../../lib/crypto"
import { listDeskAccounts, readDeskQuery } from "../account-pool/desk-pool"
import { fingerprint } from "../box-contract"
import { remarkMap } from "../chain-remarks"
import { parseCredentials } from "../proxies/configuration"
import { skillCatalog } from "../skills"
import { nodeNameOf } from "../step-remark"
import { dirNameOk, storageCardItems } from "../storage/nas-place"
import { takeBalanced } from "./allocate"
import {
  buildSegments,
  countFinished,
  dispatchTimes,
  lastProxyHost,
  laterTask,
  progressTone,
  requesterLabel,
  rollupTone,
  stepProgress,
  stringMap,
} from "./dispatch-progress"
import {
  agentStepParameters,
  chanceAssignments,
  drawMediaIds,
  drawShareFiles,
  drawTexts,
  type FillProxy,
  fillStep,
  refreshDeviceHosts,
  relaxMailPair,
  resolveProxyLink,
  type ShareDrawFile,
  type TextMaterial,
  textAssignments,
  usesExternalChance,
  usesExternalText,
} from "./fill"
import { languageCatalog, languageCodes, languageParameter } from "./languages"
import { regionCodes, regionContinents, regionParameter } from "./regions"
import {
  applyReplayChoices,
  choicesMatch,
  isIndependentProxyStep,
  nextListedProxy,
  proxyIdForStep,
  type ReplayChoice,
  type ReplayStep,
  readReplaySelection,
  redrawFile,
  redrawMediaId,
  redrawProxy,
  redrawText,
  replayOffers,
} from "./replay"
import { rememberDrawnAccount } from "../last-account"
import { accountRunStatus, dispatchRunStatus, displayRunStatus } from "./run-status"

const skillNames = new Map(skillCatalog.map((item) => [item.code, item.name]))
const skillNodeName = (skill: string): string => nodeNameOf(skill, skillNames.get(skill))

export type TextChoice = {
  readonly ids?: readonly string[]
  readonly keyword?: string
  readonly mode: "and" | "or" | "nand" | "random" | "sequence" | "tag"
  readonly sequence: number
  readonly stage?: number
  readonly tag?: string | undefined
  readonly tags?: readonly string[]
}

export type AccountFilter = {
  readonly groups: readonly string[]
  readonly ids: readonly string[]
  readonly keyword: string
  readonly mode: "and" | "or" | "nand"
  readonly tags: readonly string[]
  readonly ungrouped: boolean
}

export type ProxyFilter = {
  readonly groups: readonly string[]
  readonly ids: readonly string[]
  readonly keyword: string
  readonly mode: "and" | "or" | "nand"
  readonly remarks: readonly string[]
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
  readonly stage?: number
}

export type MediaChoice = {
  readonly boxes?: readonly string[]
  readonly directories:
    | readonly { readonly deviceId: string; readonly directory: string }[]
    | readonly string[]
  readonly draw?: "random" | "sequence"
  readonly ids?: readonly string[]
  readonly keyword?: string
  readonly kind: "image" | "video"
  readonly limit: number
  readonly mode: "and" | "or" | "nand" | "random" | "sequence"
  readonly nasDirectories?: readonly string[]
  readonly nasId?: string
  readonly sequence: number
  readonly stage: number
}

export type RepeatChoice =
  | { readonly count: number; readonly mode: "fixed"; readonly stage: number }
  | { readonly max: number; readonly min: number; readonly mode: "range"; readonly stage: number }

export type RepeatPlanItem = RepeatChoice

export type InstanceChoice = {
  readonly deviceId: string
  readonly index: number
}

export type DispatchSelection = {
  readonly accountIds: readonly string[]
  readonly accountNote: string
  readonly accounts: AccountFilter | NamedSet | null
  readonly boxIds: readonly string[]
  readonly boxes: NamedSet | null
  readonly files: readonly FileChoice[]
  readonly media?: readonly MediaChoice[]
  readonly instances: readonly InstanceChoice[]
  readonly pitIndexes: readonly number[]
  readonly pitRange: readonly number[]
  readonly poolId: string
  readonly proxies: ProxyFilter | NamedSet | null
  readonly proxyIds: readonly string[]
  readonly proxyTag: string | null
  readonly language: string
  readonly region: string
  readonly repeats: readonly RepeatChoice[]
  readonly texts: readonly TextChoice[]
  readonly chances?: readonly {
    readonly sequence: number
    readonly stage: number
    readonly value: number
  }[]
}

type SharePaths = { readonly backup: string; readonly image: string; readonly video: string }

const emptySharePaths: SharePaths = { backup: "", image: "", video: "" }

type ChainStep = {
  readonly afterMs: number
  readonly guards: readonly string[]
  readonly input: Record<string, string>
  readonly remark?: string
  readonly localSequence?: number
  readonly repeatCount?: number
  readonly repeatIndex?: number
  readonly scopes: Record<string, string>
  readonly skill: string
  readonly sources: Record<string, string>
  readonly stageName?: string
  readonly stagePosition?: number
}

const unassignedGroup = "00000000-0000-4000-8000-000000000001"

type AccountRow = {
  readonly backupDeviceId: string | null
  readonly backupKey: string
  readonly backupName: string
  readonly deviceId: string | null
  readonly encryptedSecret: string
  readonly extra: unknown
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

const chainAnchor = (
  table: string,
  key: string,
): { readonly key: "id" | "identifier"; readonly table: "operation_account" } | null =>
  table === "operation_account" && (key === "id" || key === "identifier")
    ? { key, table: "operation_account" }
    : null

const hashValue = (value: unknown): string =>
  createHash("sha256").update(fingerprint(value)).digest("hex")

export const drawRepeatCount = (
  min: number,
  max: number,
  random: () => number = Math.random,
): number => min + Math.floor(random() * (max - min + 1))

export const resolveAccountCounts = (
  plan: readonly RepeatPlanItem[],
  random: () => number,
): Map<number, number> => {
  const counts = new Map<number, number>()
  for (const item of plan) {
    counts.set(
      item.stage,
      item.mode === "fixed" ? item.count : drawRepeatCount(item.min, item.max, random),
    )
  }
  return counts
}

const repeatPlanLabel = (name: string, item: RepeatPlanItem): string => {
  if (item.mode === "range") return `${name} ×${item.min}–${item.max}`
  return item.count > 1 ? `${name} ×${item.count}` : name
}

export const accountRepeatLabel = (
  plan: readonly RepeatPlanItem[],
  stages: readonly { readonly count: number; readonly name: string; readonly position: number }[],
): string => {
  if (plan.length === 0) return "-"
  const parts = plan.flatMap((item) => {
    const stage = stages.find((row) => row.position === item.stage)
    if (stage === undefined) return []
    const marked = item.mode === "range" || item.count > 1
    return [marked ? `${stage.name} ×${stage.count}` : stage.name]
  })
  if (!parts.some((part) => part.includes("×"))) return "-"
  return parts.join(" → ")
}

const expandStage = (
  templateSteps: readonly ChainStep[],
  count: number,
  stageName: string,
  stagePosition: number,
): ChainStep[] => {
  const expanded: ChainStep[] = []
  for (const [local, step] of templateSteps.entries()) {
    for (let repeatIndex = 0; repeatIndex < count; repeatIndex += 1) {
      expanded.push({
        ...step,
        localSequence: step.localSequence ?? local,
        repeatCount: count,
        repeatIndex,
        stageName,
        stagePosition,
      })
    }
  }
  return expanded
}

const expandForAccount = (
  templates: readonly ChainStep[],
  plan: readonly RepeatPlanItem[],
  random: () => number,
): ChainStep[] => {
  const counts = resolveAccountCounts(plan, random)
  const byStage = new Map<number, ChainStep[]>()
  for (const step of templates) {
    const stage = step.stagePosition ?? 0
    const list = byStage.get(stage) ?? []
    list.push(step)
    byStage.set(stage, list)
  }
  return plan.flatMap((item) => {
    const stageSteps = byStage.get(item.stage) ?? []
    return expandStage(
      stageSteps,
      counts.get(item.stage) ?? 1,
      stageSteps[0]?.stageName ?? "",
      item.stage,
    )
  })
}

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
  readonly remarks?: readonly string[] | null
}): ChainStep[] =>
  (row.parameters ?? []).map((item, index) => ({
    afterMs: row.delays?.[index] ?? 0,
    guards: (row.guards?.[index] ?? []).filter((code) => code !== "ad" && code !== "transcode"),
    input: asRecord(item.input),
    remark: row.remarks?.[index] ?? "",
    scopes: asRecord(row.paramScopes?.[index]),
    skill: typeof item.skill === "string" ? item.skill : "",
    sources: asRecord(row.paramSources?.[index]),
  }))

const proxyView = (
  cipher: SecretCipher,
  row: ProxyRow,
): FillProxy & {
  readonly id: string
  readonly name: string
  readonly tags: readonly string[]
} => {
  const readExtra = (
    value: string | null,
  ): { extra: string; password: string; username: string } => {
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

const loadSharePaths = async (
  sql: Sql,
  deviceIds: readonly string[],
): Promise<Map<string, SharePaths>> => {
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
      where device_id = any(${deviceIds}::uuid[]) and kind = 'file'
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

const loadCatalog = async (
  sql: Sql,
  deviceIds: readonly string[],
  administratorId: string | null = null,
): Promise<ShareDrawFile[]> => {
  if (deviceIds.length === 0) return []
  const rows = await sql<
    { deviceId: string; host: string; parent: string; path: string; pool: string }[]
  >`
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
    where e.device_id = any(${[...deviceIds]}::uuid[]) and e.kind = 'file'
      and (
        ${administratorId}::uuid is null
        or (
          d.assignee_user_id = ${administratorId}::uuid
          and e.assignee_user_id = ${administratorId}::uuid
          and e.box_online
          and d.enabled
          and d.group_id <> ${unassignedGroup}::uuid
        )
      )
  `
  return rows.flatMap((row) =>
    row.pool === "video" || row.pool === "image" || row.pool === "backup"
      ? [
          {
            deviceId: row.deviceId,
            host: row.host,
            parent: row.parent,
            path: row.path,
            pool: row.pool,
          },
        ]
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

const objectRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const textField = (value: unknown): string => (typeof value === "string" ? value : "")

const mailAccountFields = (
  extra: unknown,
  decrypt: (value: string) => string,
): { readonly clientId: string; readonly email: string; readonly token: string } => {
  const root = objectRecord(extra)
  const task = objectRecord(root?.["task_param_copy"])
  const parsed = objectRecord(task?.["parsed_reg_resource"])
  let token = ""
  const sealed = textField(root?.["sealed"])
  if (sealed.length > 0) {
    try {
      token = textField(objectRecord(JSON.parse(decrypt(sealed)))?.["msToken"])
    } catch {
      token = ""
    }
  }
  return {
    clientId: textField(parsed?.["msClientId"]),
    email: textField(parsed?.["email"]),
    token,
  }
}

const drawMode = (choice: MediaChoice): "random" | "sequence" =>
  choice.draw ?? (choice.mode === "random" ? "random" : "sequence")

const loadMediaFiles = async (
  sql: Sql,
  groupId: string,
  administratorId: string,
  choice: MediaChoice,
): Promise<{ host: string; id: string; path: string }[]> => {
  const picked = choice.ids ?? []
  if (picked.length > 0) {
    return sql<{ host: string; id: string; path: string }[]>`
      select e.id::text as id,
        case when e.place = 'nas' then '' else d.host end as host,
        case when e.place = 'nas' then e.nas_key else e.relative_path end as path
      from box_share_entry e
      left join device d on d.id = e.device_id
      where e.id = any(${picked}::uuid[])
        and e.assignee_user_id = ${administratorId}::uuid
        and e.kind = 'file' and e.category = ${choice.kind}
        and (
          (e.place = 'nas' and (${choice.nasId ?? null}::uuid is null or e.nas_id = ${choice.nasId ?? null}::uuid))
          or (
            e.place = 'box' and e.box_online
            and d.group_id = ${groupId}::uuid and d.enabled
            and d.group_id <> ${unassignedGroup}::uuid
            and d.assignee_user_id = ${administratorId}::uuid
          )
        )
    `
  }
  if (choice.nasId !== undefined && choice.nasId.length > 0) {
    const dirs = [...new Set((choice.nasDirectories ?? []).filter(dirNameOk))]
    if (dirs.length === 0) return []
    const expected = choice.kind === "image" ? "pictures" : "videos"
    const cards = await sql<{ value: unknown }[]>`
      select value from storage_setting where key = ${`private-cloud:${administratorId}`}
    `
    const card = storageCardItems(cards[0]?.value).find((item) => item.id === choice.nasId)
    if (card?.bucket !== expected) return []
    return sql<{ host: string; id: string; path: string }[]>`
      select e.id::text as id, '' as host, e.nas_key as path
      from box_share_entry e
      where e.place = 'nas' and e.nas_id = ${choice.nasId}::uuid
        and e.assignee_user_id = ${administratorId}::uuid
        and e.kind = 'file' and e.category = ${choice.kind}
        and split_part(e.nas_key, '/', 1) = any(${dirs}::text[])
        and split_part(e.nas_key, '/', 1) <> ${administratorId}
        and split_part(e.nas_key, '/', 2) <> ''
        and split_part(e.nas_key, '/', 3) = ''
    `
  }
  const files: { host: string; id: string; path: string }[] = []
  const directories = choice.directories.filter(
    (dir): dir is { readonly deviceId: string; readonly directory: string } =>
      typeof dir !== "string",
  )
  for (const dir of directories) {
    const rows = await sql<{ host: string; id: string; path: string }[]>`
      select e.id::text as id, d.host, e.relative_path as path
      from box_share_entry e
      join device d on d.id = e.device_id
      where d.group_id = ${groupId}::uuid and d.id = ${dir.deviceId}::uuid
        and d.enabled and d.group_id <> ${unassignedGroup}::uuid
        and d.assignee_user_id = ${administratorId}::uuid
        and e.parent_path = ${dir.directory} and e.kind = 'file'
        and e.place = 'box'
        and e.box_online and e.assignee_user_id = ${administratorId}::uuid
        and e.category = ${choice.kind}
    `
    files.push(...rows)
  }
  const seen = new Set<string>()
  return files.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
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
  instances: readonly {
    readonly deviceId: string
    readonly id: string
    readonly index: number
    readonly label: string
  }[],
  proxies: readonly ProxyRow[],
  texts: readonly TextMaterial[],
  backupHosts: ReadonlyMap<string, string>,
  sharePaths: ReadonlyMap<string, SharePaths>,
  catalog: readonly ShareDrawFile[],
  steps: readonly ChainStep[],
  repeatPlan: readonly RepeatPlanItem[] = [],
  random: () => number = Math.random,
  mediaFiles: ReadonlyMap<
    string,
    readonly { readonly host: string; readonly id: string; readonly path: string }[]
  > = new Map(),
  refreshStages: ReadonlySet<number> = new Set(),
) => {
  const chanceByKey = new Map(
    (selection.chances ?? []).map((item) => [`${item.stage}:${item.sequence}`, String(item.value)]),
  )
  const readyProxies = proxies.map((row) => proxyView(cipher, row))
  const deviceCounts = new Map<string, number>()
  const proxyCounts = new Map<string, number>()
  const pitCounts = new Map<string, number>()
  const instanceCounts = new Map<string, number>()
  const chosenInstances = selection.instances ?? []
  const machineOnly = accounts.length === 0 && chosenInstances.length > 0
  const unitCount = machineOnly ? chosenInstances.length : accounts.length
  const blankAccount: AccountRow = {
    backupDeviceId: null,
    backupKey: "",
    backupName: "",
    deviceId: null,
    encryptedSecret: "",
    extra: {},
    id: "",
    identifier: "",
    instanceIndex: null,
    language: "",
    note: "",
    proxyId: null,
    region: "",
  }
  const subjects = machineOnly
    ? chosenInstances.map((item, accountIndex) => ({
        account: blankAccount,
        accountIndex,
        pinned: item,
      }))
    : accounts.map((account, accountIndex) => ({
        account,
        accountIndex,
        pinned: null as InstanceChoice | null,
      }))
  const repeatCap = new Map<number, number>()
  for (const item of repeatPlan) {
    repeatCap.set(item.stage, item.mode === "fixed" ? item.count : item.max)
  }
  const drawSlots = (stage: number): number =>
    refreshStages.has(stage) ? unitCount * Math.max(repeatCap.get(stage) ?? 1, 1) : unitCount
  const textDraws = new Map<string, ReturnType<typeof drawTexts>>()
  for (const choice of selection.texts) {
    const stage = choice.stage ?? 0
    const picked = choice.ids ?? []
    const pool = picked.length > 0 ? texts.filter((item) => picked.includes(item.id)) : texts
    const mode =
      picked.length > 0
        ? "sequence"
        : choice.mode === "random" || choice.mode === "sequence" || choice.mode === "tag"
          ? choice.mode
          : "sequence"
    textDraws.set(
      `${stage}:${choice.sequence}`,
      drawTexts(pool, mode, choice.tag, drawSlots(stage)),
    )
  }
  const fileDraws = new Map<string, ReturnType<typeof drawShareFiles>>()
  for (const choice of selection.files) {
    const pool = filePool(choice.source)
    if (pool === null) continue
    const stage = choice.stage ?? 0
    fileDraws.set(
      `${stage}:${choice.sequence}:${choice.source}`,
      drawShareFiles(
        catalog,
        choice.deviceId,
        choice.directory,
        pool,
        choice.mode,
        drawSlots(stage),
      ),
    )
  }
  const mediaDraws = new Map<string, string[]>()
  const mediaLimits = new Map<string, number>()
  for (const choice of selection.media ?? []) {
    mediaLimits.set(`${choice.stage}:${choice.sequence}:${choice.kind}`, choice.limit)
    mediaDraws.set(
      `${choice.stage}:${choice.sequence}:${choice.kind}`,
      drawMediaIds(
        mediaFiles.get(`${choice.stage}:${choice.sequence}:${choice.kind}`) ?? [],
        drawMode(choice),
        drawSlots(choice.stage),
        random,
      ),
    )
  }
  void sharePaths
  const constrainBoxes = selection.boxes !== null || selection.boxIds.length > 0
  const constrainProxies =
    selection.proxies !== null || selection.proxyTag !== null || selection.proxyIds.length > 0
  return subjects.map(({ account, accountIndex, pinned }) => {
    const chosen = new Set(selection.boxIds)
    const grouped =
      selection.boxIds.length === 0 ? [] : devices.filter((item) => chosen.has(item.id))
    const balanced =
      pinned === null && chosenInstances.length > 0
        ? takeBalanced(
            chosenInstances.map((item) => ({
              deviceId: item.deviceId,
              id: `${item.deviceId}#${item.index}`,
              index: item.index,
            })),
            instanceCounts,
          )
        : null
    const savedDevice = devices.find((item) => item.id === account.deviceId) ?? null
    const pinnedDevice =
      pinned === null ? null : (devices.find((item) => item.id === pinned.deviceId) ?? null)
    const balancedDevice =
      balanced === null ? null : (devices.find((item) => item.id === balanced.deviceId) ?? null)
    const device =
      pinned !== null
        ? pinnedDevice
        : chosenInstances.length > 0
          ? balancedDevice
          : constrainBoxes
            ? takeBalanced(grouped, deviceCounts)
            : savedDevice !== null
              ? savedDevice
              : takeBalanced(devices, deviceCounts)
    if (
      pinned === null &&
      chosenInstances.length === 0 &&
      !constrainBoxes &&
      savedDevice !== null
    ) {
      deviceCounts.set(savedDevice.id, (deviceCounts.get(savedDevice.id) ?? 0) + 1)
    }
    const manualPits = [...new Set(selection.pitIndexes)]
    const savedPit =
      device !== null && account.deviceId === device.id ? account.instanceIndex : null
    const instanceIndex =
      pinned !== null
        ? pinned.index
        : balanced !== null
          ? balanced.index
          : manualPits.length > 0
            ? pickPit(device?.id ?? null, manualPits, pitCounts)
            : savedPit !== null
              ? savedPit
              : pickPit(device?.id ?? null, [1, 2, 3, 4, 5], pitCounts)
    if (
      pinned === null &&
      balanced === null &&
      savedPit !== null &&
      manualPits.length === 0 &&
      device !== null
    ) {
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
    const proxy =
      account.id === ""
        ? constrainProxies
          ? takeBalanced(tagged, proxyCounts)
          : null
        : constrainProxies
          ? takeBalanced(tagged, proxyCounts)
          : savedProxy !== null
            ? savedProxy
            : takeBalanced(readyProxies, proxyCounts)
    if (account.id !== "" && !constrainProxies && savedProxy !== null) {
      proxyCounts.set(savedProxy.id, (proxyCounts.get(savedProxy.id) ?? 0) + 1)
    }
    const instance =
      instances.find((item) => item.deviceId === device?.id && item.index === instanceIndex) ?? null
    const accountSteps =
      repeatPlan.length === 0 ? steps : expandForAccount(steps, repeatPlan, random)
    const repeatProxies = new Map<number, typeof proxy>()
    const filled = relaxMailPair(
      accountSteps.map((step, sequence) => {
        const stage = step.stagePosition ?? 0
        const local = step.localSequence ?? sequence
        const choice = selection.texts.some(
          (item) => (item.stage ?? 0) === stage && item.sequence === local,
        )
        const stride = Math.max(repeatCap.get(stage) ?? 1, 1)
        const slot = refreshStages.has(stage)
          ? accountIndex * stride + (step.repeatIndex ?? 0)
          : accountIndex
        const drawn = textDraws.get(`${stage}:${local}`)?.[slot]
        const text = choice && drawn !== undefined && drawn.content.length > 0 ? drawn : null
        const video = fileDraws.get(`${stage}:${local}:pool.video`)?.[slot]
        const image = fileDraws.get(`${stage}:${local}:pool.image`)?.[slot]
        const backupFile = fileDraws.get(`${stage}:${local}:pool.backup`)?.[slot]
        const mail = mailAccountFields(account.extra, (value) => decryptSecret(cipher, value))
        const result = fillStep(step, {
          account: {
            backupName: account.backupName,
            clientId: mail.clientId,
            email: mail.email,
            identifier: account.identifier,
            language: account.language,
            region: account.region,
            secret: decryptSecret(cipher, account.encryptedSecret),
            token: mail.token,
          },
          device: device === null ? null : { host: device.host },
          instance:
            instanceIndex === null
              ? null
              : { index: String(instanceIndex), name: (instance?.label ?? "").trim() },
          manualText: choice,
          proxy: (() => {
            if (!refreshStages.has(stage) || !constrainProxies) return proxy
            const repeatIndex = step.repeatIndex ?? 0
            const found = repeatProxies.get(repeatIndex)
            if (found !== undefined) return found
            const pool = tagged.length > 0 ? tagged : readyProxies
            const picked = takeBalanced(pool, proxyCounts)
            repeatProxies.set(repeatIndex, picked)
            return picked
          })(),
          language: selection.language,
          region: selection.region,
          text,
          backup: backupFile?.path ?? "",
          backupFileHost: backupFile?.host ?? "",
          image: image?.path ?? "",
          imageHost: image?.host ?? "",
          chance: usesExternalChance(step) ? (chanceByKey.get(`${stage}:${local}`) ?? "") : "",
          imageId: mediaDraws.get(`${stage}:${local}:image`)?.[slot] ?? "",
          video: video?.path ?? "",
          videoHost: video?.host ?? "",
          videoId: mediaDraws.get(`${stage}:${local}:video`)?.[slot] ?? "",
        })
        const mediaKind =
          step.skill === "UploadPitImage" ? "image" : step.skill === "UploadPitVideo" ? "video" : ""
        const mediaKey = mediaKind === "image" ? "图片ID" : mediaKind === "video" ? "视频ID" : ""
        const mediaId = mediaDraws.get(`${stage}:${local}:${mediaKind}`)?.[slot]
        const limited =
          mediaKind === "" ? undefined : mediaLimits.get(`${stage}:${local}:${mediaKind}`)
        const withMedia =
          mediaKey !== "" && mediaId !== undefined && mediaId.length > 0
            ? {
                ...result,
                missingKeys: result.missingKeys.filter((key) => key !== mediaKey),
                parameters: { ...result.parameters, [mediaKey]: mediaId },
              }
            : result
        const filled =
          limited === undefined
            ? withMedia
            : {
                ...withMedia,
                missingKeys: withMedia.missingKeys.filter((key) => key !== "上传次数"),
                parameters: { ...withMedia.parameters, 上传次数: String(limited) },
              }
        return { ...step, sequence: step.localSequence ?? sequence, ...filled }
      }),
    )
    const proxyMissing =
      proxy === null &&
      filled.some((step) =>
        step.missingKeys.some((key) => (step.sources[key] ?? "").startsWith("proxy.")),
      )
    const containerMissing =
      instanceIndex !== null &&
      filled.some((step) => step.missingKeys.some((key) => step.sources[key] === "instance.name"))
    const missing = [
      ...(device === null ? ["device"] : []),
      ...(instanceIndex === null ? ["pit"] : []),
      ...(containerMissing ? ["容器名"] : []),
      ...(proxyMissing ? ["proxy"] : []),
      ...filled.flatMap((step) =>
        usesExternalText(step) && step.missingKeys.includes("text")
          ? [
              (step.stagePosition ?? 0) === 0
                ? `text:${step.sequence}`
                : `text:${step.stagePosition}:${step.sequence}`,
            ]
          : [],
      ),
    ]
    const incomplete = missing.length > 0 || filled.some((step) => step.missingKeys.length > 0)
    return {
      accountId: account.id === "" ? null : account.id,
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

export const createDispatchRepository = (
  sql: Sql,
  cipher: SecretCipher,
  random: () => number = Math.random,
) => {
  const prepareSteps = async (
    administratorId: string,
    recipe: { readonly chainId: string | null; readonly taskChainId: string | null },
    repeats: readonly RepeatChoice[],
  ) => {
    if (recipe.taskChainId !== null) {
      const rows = await sql<
        {
          anchorTable: string
          delays: number[]
          guards: string[][]
          name: string
          parameters: { input?: unknown; skill?: unknown }[]
          paramScopes: unknown[]
          paramSources: unknown[]
          position: number
          remarks: string[] | null
        }[]
      >`
        select i.position, c.name, c.anchor_table as "anchorTable", c.parameters, c.param_scopes as "paramScopes",
          c.param_sources as "paramSources", c.guards, c.delays, c.remarks
        from task_chain tc
        join task_chain_item i on i.task_chain_id = tc.id
        join behavior_chain c on c.id = i.chain_id
        where tc.id = ${recipe.taskChainId}::uuid and tc.administrator_id = ${administratorId}::uuid
        order by i.position`
      if (rows.length === 0 || rows.some((row, index) => row.position !== index)) return null
      const specified = new Map<number, RepeatPlanItem>()
      for (const item of repeats) {
        if (specified.has(item.stage) || item.stage < 0 || item.stage >= rows.length) {
          return "invalid" as const
        }
        if (item.mode === "fixed") {
          if (item.count < 1 || item.count > 99) return "invalid" as const
          specified.set(item.stage, { count: item.count, mode: "fixed", stage: item.stage })
          continue
        }
        if (item.min < 1 || item.max > 99 || item.min > item.max) return "invalid" as const
        specified.set(
          item.stage,
          item.min === item.max
            ? { count: item.min, mode: "fixed", stage: item.stage }
            : { max: item.max, min: item.min, mode: "range", stage: item.stage },
        )
      }
      const steps: ChainStep[] = []
      const repeatPlan: RepeatPlanItem[] = []
      for (const row of rows) {
        const parsed = chainSteps(row)
        if (parsed.length === 0) return "invalid" as const
        for (const [local, step] of parsed.entries()) {
          steps.push({
            ...step,
            localSequence: local,
            stageName: row.name,
            stagePosition: row.position,
          })
        }
        repeatPlan.push(
          specified.get(row.position) ?? { count: 1, mode: "fixed", stage: row.position },
        )
      }
      const name = repeatPlan
        .map((item, index) => repeatPlanLabel(rows[index]?.name ?? "", item))
        .join(" → ")
      return {
        chainId: null,
        name,
        needsAccount: rows.some((row) => row.anchorTable === "operation_account"),
        repeatPlan,
        steps,
        taskChainId: recipe.taskChainId,
      }
    }
    if (recipe.chainId === null) return null
    if (repeats.length > 0) return "invalid" as const
    const chains = await sql<
      {
        delays: number[]
        anchorTable: string
        guards: string[][]
        id: string
        name: string
        parameters: { input?: unknown; skill?: unknown }[]
        paramScopes: unknown[]
        paramSources: unknown[]
        remarks: string[] | null
      }[]
    >`
      select id::text as id, name, anchor_table as "anchorTable", parameters, param_scopes as "paramScopes",
        param_sources as "paramSources", guards, delays, remarks
      from behavior_chain
      where id = ${recipe.chainId}::uuid and administrator_id = ${administratorId}::uuid`
    const chain = chains[0]
    if (chain === undefined) return null
    return {
      chainId: chain.id,
      name: chain.name,
      needsAccount: chain.anchorTable === "operation_account",
      repeatPlan: [] as RepeatPlanItem[],
      steps: chainSteps(chain),
      taskChainId: null,
    }
  }
  const workspace = async (
    groupId: string,
    administratorId: string,
    recipe: { readonly chainId: string | null; readonly taskChainId: string | null },
    selection: DispatchSelection,
  ) => {
    const prepared = await prepareSteps(administratorId, recipe, selection.repeats)
    if (prepared === null || prepared === "invalid") return prepared
    const accountIds = [...selection.accountIds]
    const useIds = accountIds.length > 0
    const accounts = await sql<AccountRow[]>`
      select a.id::text as id, a.identifier, a.note, a.encrypted_secret as "encryptedSecret", a.extra,
        a.region, a.language, a.backup_key as "backupKey", a.backup_name as "backupName",
        a.backup_device_id::text as "backupDeviceId",
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
        and d.group_id <> ${unassignedGroup}::uuid
        and d.assignee_user_id = ${administratorId}::uuid
        and exists (
          select 1 from device_group_history h where h.device_id = d.id and h.group_id = d.group_id
        )
      order by d.id`
    const deviceIds = devices.map((item) => item.id)
    const instances = await sql<{ deviceId: string; id: string; index: number; label: string }[]>`
      select id::text as id, device_id::text as "deviceId", instance_index as index, label
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
    const backupIds = accounts.flatMap((item) =>
      item.backupDeviceId === null ? [] : [item.backupDeviceId],
    )
    const backups = await sql<{ host: string; id: string }[]>`
      select id::text as id, host from device where id = any(${backupIds}::uuid[])`
    return {
      accounts,
      backups: new Map(backups.map((item) => [item.id, item.host])),
      chainId: prepared.chainId,
      devices,
      instances,
      name: prepared.name,
      proxies,
      catalog: await loadCatalog(
        sql,
        selection.files.map((item) => item.deviceId),
        administratorId,
      ),
      sharePaths: await loadSharePaths(
        sql,
        devices.map((item) => item.id),
      ),
      repeatPlan: prepared.repeatPlan,
      steps: prepared.steps,
      taskChainId: prepared.taskChainId,
      texts,
    }
  }

  const accountsForPool = async (
    groupId: string,
    poolId: string,
  ): Promise<readonly string[] | null> => {
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

  const accountsForIds = async (
    groupId: string,
    ids: readonly string[],
  ): Promise<readonly string[] | null> => {
    if (ids.length === 0) return []
    const rows = await sql<{ id: string }[]>`
      select id::text as id
      from operation_account
      where group_id = ${groupId}::uuid and not deleted and id = any(${ids}::uuid[])
    `
    return rows.length === ids.length ? ids : null
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

  const devicesForSet = async (
    groupId: string,
    administratorId: string,
    set: NamedSet,
  ): Promise<readonly string[]> => {
    if (set.by === "remark") {
      const rows = await sql<{ id: string }[]>`
        select d.id::text as id from device d
        join device_remark r on r.device_id = d.id
        join business_label l on l.id = r.label_id
        where d.group_id = ${groupId}::uuid and d.enabled and not d.assignment_pending
          and d.group_id <> ${unassignedGroup}::uuid
          and d.assignee_user_id = ${administratorId}::uuid
          and l.scope = 'device' and l.kind = 'remark' and l.name = ${set.name}
        order by d.id`
      return rows.map((item) => item.id)
    }
    const rows = await sql<{ id: string }[]>`
      select d.id::text as id from device d
      join business_label l on l.id = d.box_group_id
      where d.group_id = ${groupId}::uuid and d.enabled and not d.assignment_pending
        and d.group_id <> ${unassignedGroup}::uuid
        and d.assignee_user_id = ${administratorId}::uuid
        and l.scope = 'device' and l.kind = 'group' and l.name = ${set.name}
      order by d.id`
    return rows.map((item) => item.id)
  }

  const proxiesForIds = async (
    groupId: string,
    ids: readonly string[],
  ): Promise<readonly string[] | null> => {
    if (ids.length === 0) return []
    const rows = await sql<{ id: string }[]>`
      select id::text as id
      from operation_proxy
      where group_id = ${groupId}::uuid and status = 'ready' and id = any(${ids}::uuid[])
    `
    return rows.length === ids.length ? ids : null
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

  const uniqueViolation = (error: unknown): boolean =>
    typeof error === "object" && error !== null && "code" in error && error["code"] === "23505"

  const inspectReplay = async (
    tx: Sql,
    groupId: string,
    taskId: string,
    choices: readonly ReplayChoice[] | null,
  ) => {
    const locked = await tx<{ dispatchItemId: string | null; status: string }[]>`
      select status, dispatch_item_id::text as "dispatchItemId"
      from execution_task
      where id = ${taskId}::uuid and group_id = ${groupId}::uuid
      for update`
    const head = locked[0]
    if (head === undefined || head.dispatchItemId === null) return { kind: "not_found" as const }
    if (head.status !== "failed") return { kind: "replay_not_failed" as const }
    const rows = await tx<
      {
        accountId: string | null
        afterMs: number
        autoRetry: boolean
        autoRetryLimit: number
        deviceId: string
        dispatchId: string
        guards: unknown
        instanceId: string | null
        instanceIndex: number | null
        chainName: string
        name: string
        parameters: unknown
        predecessor: string | null
        remark: string
        proxyId: string | null
        refreshDraw: boolean
        refreshExternal: boolean
        repeatCount: number
        repeatIndex: number
        scopes: unknown
        selection: unknown
        sequence: number
        skill: string
        sources: unknown
        stageCount: number
        stagePosition: number
        taskChainId: string | null
        textResourceId: string | null
      }[]
    >`
      select t.name, t.stage_position as "stagePosition", t.repeat_index as "repeatIndex",
        t.repeat_count as "repeatCount", t.stage_count as "stageCount",
        t.auto_retry as "autoRetry", t.auto_retry_limit as "autoRetryLimit",
        t.predecessor_task_id::text as predecessor, t.task_chain_id::text as "taskChainId",
        coalesce(nullif(t.chain_name, ''), nullif(s.stage_name, ''), '') as "chainName",
        coalesce(s.remark, '') as remark,
        t.account_id::text as "accountId", t.device_id::text as "deviceId",
        d.id::text as "dispatchId", d.selection,
        i.proxy_id::text as "proxyId", i.instance_index as "instanceIndex",
        i.instance_id::text as "instanceId",
        s.sequence, s.skill, s.sources, s.scopes, s.parameters, s.guards,
        s.after_ms as "afterMs", s.text_resource_id::text as "textResourceId",
        s.refresh_external as "refreshExternal",
        coalesce((
          select st.refresh_draw from operation_dispatch_stage st
          where st.dispatch_id = d.id and st.stage_position = t.stage_position
        ), false) as "refreshDraw"
      from execution_task t
      join operation_dispatch_item i on i.id = t.dispatch_item_id
      join operation_dispatch d on d.id = i.dispatch_id
      join operation_dispatch_step s on s.item_id = i.id
        and s.stage_position = t.stage_position and s.repeat_index = t.repeat_index
      where t.id = ${taskId}::uuid and t.group_id = ${groupId}::uuid
      order by s.sequence
      for update of i`
    const first = rows[0]
    if (first === undefined) return { kind: "invalid_replay_request" as const }
    const active = await tx<{ id: string }[]>`
      select id::text as id from execution_task
      where dispatch_item_id = ${head.dispatchItemId}::uuid
        and stage_position = ${first.stagePosition}
        and repeat_index = ${first.repeatIndex}
        and status in ('queued', 'dispatching', 'running', 'ood')
      limit 1`
    if (active.length > 0) return { kind: "replay_in_progress" as const }
    const selection = readReplaySelection(first.selection)
    if (selection === null) return { kind: "invalid_replay_request" as const }
    const steps: ReplayStep[] = rows.map((row) => ({
      parameters: asRecord(row.parameters),
      scopes: asRecord(row.scopes),
      sequence: row.sequence,
      skill: row.skill,
      sources: asRecord(row.sources),
      textResourceId: row.textResourceId,
    }))
    const proxyRows = await tx<ProxyRow[]>`
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
    const ready = proxyRows.map((row) => proxyView(cipher, row))
    const current = ready.find((item) => item.id === first.proxyId) ?? null
    const proxyCurrent =
      current === null ? "" : `${current.name} ${current.host}:${current.port}`.trim()
    const refreshOf = new Map(
      rows.filter((row) => row.refreshExternal).map((row) => [row.sequence, true] as const),
    )
    const offers = replayOffers(
      steps,
      selection,
      proxyCurrent,
      refreshOf,
      first.refreshDraw === true,
    )
    const usedRows = await tx<{ used: number }[]>`
      select count(*)::int as used from operation_stage_replay
      where item_id = ${head.dispatchItemId}::uuid
        and stage_position = ${first.stagePosition}
        and repeat_index = ${first.repeatIndex}
        and origin = 'auto'`
    const autoUsed = usedRows[0]?.used ?? 0
    if (choices === null) {
      return {
        autoRetry: first.autoRetry,
        autoRetryLimit: first.autoRetryLimit,
        autoUsed,
        choices: offers,
        kind: "options" as const,
        name: first.name,
        repeatCount: first.repeatCount,
        repeatIndex: first.repeatIndex,
        stagePosition: first.stagePosition,
        taskId,
      }
    }
    if (!choicesMatch(offers, choices)) return { kind: "invalid_replay_request" as const }
    const constrain =
      selection.proxies !== null || selection.proxyTag !== null || selection.proxyIds.length > 0
    const tagged =
      selection.proxyIds.length > 0
        ? ready.filter((item) => selection.proxyIds.includes(item.id))
        : selection.proxyTag === null
          ? []
          : ready.filter((item) => item.tags.includes(selection.proxyTag ?? ""))
    const proxyPool = constrain ? tagged : ready
    const proxy = redrawProxy(proxyPool, first.proxyId)
    const listedOrder = selection.proxyIds.length > 0 ? selection.proxyIds : proxyPool.map((item) => item.id)
    const listed = listedOrder.flatMap((id) => {
      const item = proxyPool.find((proxyItem) => proxyItem.id === id)
      return item === undefined ? [] : [item]
    })
    const stepProxies = new Map<number, NonNullable<typeof proxy>>()
    for (const choice of choices) {
      if (choice.kind !== "proxy" || choice.mode !== "redraw" || choice.sequence === undefined)
        continue
      const step = steps.find((item) => item.sequence === choice.sequence)
      const currentId = step === undefined ? null : proxyIdForStep(step, listed, first.proxyId)
      const picked = nextListedProxy(listed, currentId)
      if (picked !== null) stepProxies.set(choice.sequence, picked)
    }
    const materials = await tx<TextMaterial[]>`
      select id::text as id, name as content, category, created_at::text as "createdAt"
      from operation_resource
      where group_id = ${groupId}::uuid and status <> 'inactive'
      order by created_at, id`
    const catalog = await loadCatalog(tx, [
      ...new Set(selection.files.map((item) => item.deviceId)),
    ])
    const accountRow =
      first.accountId === null
        ? null
        : ((
            await tx<
              {
                backupKey: string
                backupName: string
                identifier: string
                language: string
                region: string
                secret: string
              }[]
            >`
              select identifier, region, language, backup_key as "backupKey",
                backup_name as "backupName", encrypted_secret as secret
              from operation_account
              where id = ${first.accountId}::uuid and group_id = ${groupId}::uuid and not deleted`
          )[0] ?? null)
    const texts = new Map<number, { content: string; resourceId: string }>()
    const files = new Map<string, { host: string; path: string }>()
    const mediaIds = new Map<string, string>()
    for (const choice of choices) {
      if (choice.kind === "text" && choice.mode === "redraw") {
        const spec = selection.texts.find(
          (item) => item.sequence === choice.sequence && (item.stage ?? 0) === first.stagePosition,
        )
        const currentText = steps.find((item) => item.sequence === choice.sequence)
        const picked = spec?.ids ?? []
        const pool =
          picked.length > 0 ? materials.filter((item) => picked.includes(item.id)) : materials
        const mode =
          spec === undefined
            ? "sequence"
            : picked.length > 0
              ? "sequence"
              : spec.mode === "random" || spec.mode === "sequence" || spec.mode === "tag"
                ? spec.mode
                : "sequence"
        const drawn =
          spec === undefined
            ? null
            : redrawText(pool, mode, spec.tag, currentText?.textResourceId ?? "", random)
        if (drawn !== null) texts.set(choice.sequence, drawn)
      }
      if (choice.kind === "file" && choice.mode === "redraw") {
        const mediaKind =
          choice.source === "pool.image" ? "image" : choice.source === "pool.video" ? "video" : null
        const mediaSpec =
          mediaKind === null
            ? undefined
            : (selection.media ?? []).find(
                (item) =>
                  item.kind === mediaKind &&
                  item.sequence === choice.sequence &&
                  item.stage === first.stagePosition,
              )
        if (mediaSpec !== undefined && mediaKind !== null) {
          const owner = await tx<{ assigneeUserId: string | null }[]>`
            select assignee_user_id::text as "assigneeUserId" from device where id = ${first.deviceId}::uuid
          `
          const assignee = owner[0]?.assigneeUserId ?? ""
          const listed =
            assignee.length === 0 ? [] : await loadMediaFiles(tx, groupId, assignee, mediaSpec)
          const currentFile = steps.find((item) => item.sequence === choice.sequence)
          const currentId =
            currentFile?.parameters[mediaKind === "image" ? "图片ID" : "视频ID"] ?? ""
          mediaIds.set(
            `${choice.sequence}:${mediaKind}`,
            redrawMediaId(
              listed,
              mediaSpec.draw ?? (mediaSpec.mode === "random" ? "random" : "sequence"),
              currentId,
              random,
            ) ?? "",
          )
        }
        const spec = selection.files.find(
          (item) =>
            item.sequence === choice.sequence &&
            item.source === choice.source &&
            (item.stage ?? 0) === first.stagePosition,
        )
        const currentFile = steps.find((item) => item.sequence === choice.sequence)
        const currentPath =
          currentFile === undefined
            ? ""
            : (Object.entries(currentFile.sources).find(
                ([, source]) => source === choice.source,
              )?.[0] ?? "")
        const drawn =
          spec === undefined
            ? null
            : redrawFile(
                catalog,
                spec,
                currentPath.length === 0 ? "" : (currentFile?.parameters[currentPath] ?? ""),
                random,
              )
        if (drawn !== null) files.set(`${choice.sequence}:${choice.source}`, drawn)
      }
    }
    const applied = applyReplayChoices(steps, choices, {
      account: {
        backup_key: accountRow?.backupKey ?? "",
        backup_name: accountRow?.backupName ?? "",
        identifier: accountRow?.identifier ?? "",
        language: accountRow?.language ?? "",
        region: accountRow?.region ?? "",
        secret: accountRow === null ? "" : decryptSecret(cipher, accountRow.secret),
      },
      files,
      proxy,
      stepProxies,
      texts,
    })
    for (const step of applied.steps) {
      for (const kind of ["image", "video"] as const) {
        const id = mediaIds.get(`${step.sequence}:${kind}`)
        if (id === undefined) continue
        step.parameters[kind === "image" ? "图片ID" : "视频ID"] = id
      }
    }
    const mediaMissing = [...mediaIds.entries()].flatMap(([key, id]) => {
      if (id.length > 0) return []
      const [sequence, kind] = key.split(":")
      return [
        {
          keys: [kind === "image" ? "图片ID" : "视频ID"],
          sequence: Number(sequence),
        },
      ]
    })
    if (applied.missing.length > 0 || mediaMissing.length > 0) {
      return { items: [...applied.missing, ...mediaMissing], kind: "replay_incomplete" as const }
    }
    return {
      accountId: first.accountId,
      applied,
      autoRetry: first.autoRetry,
      autoRetryLimit: first.autoRetryLimit,
      choices,
      deviceId: first.deviceId,
      dispatchId: first.dispatchId,
      instanceId: first.instanceId,
      instanceIndex: first.instanceIndex,
      itemId: head.dispatchItemId,
      kind: "ready" as const,
      name: first.name,
      predecessor: first.predecessor,
      repeatCount: first.repeatCount,
      repeatIndex: first.repeatIndex,
      rows,
      stageCount: first.stageCount,
      stagePosition: first.stagePosition,
      taskChainId: first.taskChainId,
    }
  }

  const repository = {
    options: async (groupId: string, administratorId: string | null) => {
      const [
        pools,
        devices,
        proxyTags,
        textTags,
        chains,
        accountGroups,
        accountTags,
        boxGroups,
        boxRemarks,
        proxyGroups,
        proxyRemarks,
        accounts,
        proxies,
        texts,
      ] = await Promise.all([
        sql<{ id: string; key: string }[]>`
          select id::text as id, key from operation_account_pool
          where group_id = ${groupId}::uuid and deleted_at is null
          order by display_id desc`,
        administratorId === null
          ? Promise.resolve([] as { host: string; id: string; name: string }[])
          : sql<{ host: string; id: string; name: string }[]>`
          select d.id::text as id, d.name, d.host from device d
          where d.group_id = ${groupId}::uuid and d.enabled and not d.assignment_pending
            and d.group_id <> ${unassignedGroup}::uuid
            and d.assignee_user_id = ${administratorId}::uuid
            and d.status = 'online'
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
          ? Promise.resolve(
              [] as {
                anchorKey: string
                anchorTable: string
                id: string
                name: string
                parameters: unknown
                paramScopes: unknown
                paramSources: unknown
                remarks: string[] | null
              }[],
            )
          : sql<
              {
                anchorKey: string
                anchorTable: string
                id: string
                name: string
                parameters: unknown
                paramScopes: unknown
                paramSources: unknown
                remarks: string[] | null
              }[]
            >`
              select id::text as id, name, anchor_table as "anchorTable", anchor_key as "anchorKey",
                parameters, param_scopes as "paramScopes", param_sources as "paramSources", remarks
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
        sql<{ group: string; id: string; identifier: string; tags: string[] | null }[]>`
          select id::text as id, identifier, coalesce(tags[1], '') as "group",
            coalesce(tags[2:cardinality(tags)], '{}'::text[]) as tags
          from operation_account
          where group_id = ${groupId}::uuid and not deleted
          order by identifier, id`,
        sql<{ address: string; group: string; id: string; name: string; note: string }[]>`
          select id::text as id, name, endpoint as address, coalesce(tags[1], '') as "group",
            coalesce(note, '') as note
          from operation_proxy
          where group_id = ${groupId}::uuid and status = 'ready'
          order by name, id`,
        sql<
          { category: string; content: string; id: string; remark: string; tags: string[] | null }[]
        >`
          select id::text as id, category, name as content, coalesce(note, '') as remark,
            coalesce(tags, '{}'::text[]) as tags
          from operation_resource
          where group_id = ${groupId}::uuid and status <> 'inactive'
          order by created_at, id`,
      ])
      const taskChainRows =
        administratorId === null
          ? []
          : await sql<
              {
                anchorKey: string
                anchorTable: string
                chainId: string
                chainName: string
                id: string
                name: string
                parameters: { input?: unknown; skill?: unknown }[]
                paramScopes: unknown[]
                paramSources: unknown[]
                position: number
                remarks: string[] | null
              }[]
            >`
              select tc.id::text as id, tc.name, i.position, c.id::text as "chainId", c.name as "chainName",
                c.anchor_table as "anchorTable", c.anchor_key as "anchorKey",
                c.parameters, c.param_scopes as "paramScopes", c.param_sources as "paramSources",
                c.remarks
              from task_chain tc
              join task_chain_item i on i.task_chain_id = tc.id
              join behavior_chain c on c.id = i.chain_id
              where tc.administrator_id = ${administratorId}::uuid
              order by tc.updated_at desc, i.position`
      const taskChains: {
        id: string
        name: string
        remarks: { id: string; name: string }[]
        stages: {
          anchor: { key: "id" | "identifier"; table: "operation_account" } | null
          chainId: string
          chainName: string
          position: number
          steps: {
            api: string
            params: Record<string, string>
            remark: string
            scopes: Record<string, string>
            sources: Record<string, string>
          }[]
        }[]
      }[] = []
      for (const row of taskChainRows) {
        let chain = taskChains.find((item) => item.id === row.id)
        if (chain === undefined) {
          chain = { id: row.id, name: row.name, remarks: [], stages: [] }
          taskChains.push(chain)
        }
        chain.stages.push({
          anchor: chainAnchor(row.anchorTable, row.anchorKey),
          chainId: row.chainId,
          chainName: row.chainName,
          position: row.position,
          steps: chainSteps({
            delays: [],
            guards: [],
            parameters: Array.isArray(row.parameters) ? row.parameters : [],
            paramScopes: Array.isArray(row.paramScopes) ? row.paramScopes : [],
            paramSources: Array.isArray(row.paramSources) ? row.paramSources : [],
            remarks: Array.isArray(row.remarks) ? row.remarks : [],
          }).map((step) => ({
            api: step.skill,
            params: step.input,
            remark: step.remark ?? "",
            scopes: step.scopes,
            sources: step.sources,
          })),
        })
      }
      const taskRemarks = await remarkMap(
        sql,
        "task-chain",
        taskChains.map((chain) => chain.id),
      )
      for (const chain of taskChains) chain.remarks = taskRemarks.get(chain.id) ?? []
      return {
        accountGroups: accountGroups.map((row) => row.name),
        accountTags: accountTags.map((row) => row.name),
        accounts: accounts.map((row) => ({ ...row, tags: row.tags ?? [] })),
        proxies,
        texts: texts.map((row) => ({ ...row, tags: row.tags ?? [] })),
        boxGroups: boxGroups.map((row) => row.name),
        boxRemarks: boxRemarks.map((row) => row.name),
        devices,
        pools,
        chains: chains.map((row) => ({
          anchor: chainAnchor(row.anchorTable, row.anchorKey),
          id: row.id,
          name: row.name,
          steps: chainSteps({
            delays: [],
            guards: [],
            parameters: Array.isArray(row.parameters) ? row.parameters : [],
            paramScopes: Array.isArray(row.paramScopes) ? row.paramScopes : [],
            paramSources: Array.isArray(row.paramSources) ? row.paramSources : [],
            remarks: Array.isArray(row.remarks) ? row.remarks : [],
          }).map((step) => ({
            api: step.skill,
            params: step.input,
            remark: step.remark ?? "",
            scopes: step.scopes,
            sources: step.sources,
          })),
        })),
        pits: [1, 2, 3, 4, 5],
        proxyGroups: proxyGroups.map((row) => row.name),
        proxyRemarks: proxyRemarks.map((row) => row.name),
        proxyTags: proxyTags.map((row) => row.tag),
        languages: languageCatalog,
        regions: regionContinents,
        textTags: textTags.map((row) => row.category),
        taskChains,
      }
    },
    mediaFiles: async (
      groupId: string,
      administratorId: string | null,
      kind: "image" | "video",
      query: { readonly deviceId?: string; readonly nasId?: string },
    ) => {
      if (administratorId === null) return []
      if (query.nasId !== undefined && query.nasId.length > 0) {
        const expected = kind === "image" ? "pictures" : "videos"
        const cards = await sql<{ value: unknown }[]>`
          select value from storage_setting where key = ${`private-cloud:${administratorId}`}
        `
        const card = storageCardItems(cards[0]?.value).find((item) => item.id === query.nasId)
        if (card?.bucket !== expected) return []
        return sql<{ deviceId: string; directory: string; id: string; name: string }[]>`
          select e.id::text as id, '' as "deviceId",
            split_part(e.nas_key, '/', 1) as directory,
            split_part(e.nas_key, '/', 2) as name
          from box_share_entry e
          where e.place = 'nas' and e.nas_id = ${query.nasId}::uuid
            and e.assignee_user_id = ${administratorId}::uuid
            and e.kind = 'file' and e.category = ${kind}
            and split_part(e.nas_key, '/', 1) <> ${administratorId}
            and split_part(e.nas_key, '/', 2) <> ''
            and split_part(e.nas_key, '/', 3) = ''
          order by directory, name, e.id`
      }
      if (query.deviceId === undefined || query.deviceId.length === 0) return []
      return sql<{ deviceId: string; directory: string; id: string; name: string }[]>`
        select e.id::text as id, d.id::text as "deviceId", e.parent_path as directory,
          regexp_replace(e.relative_path, '^.*/', '') as name
        from box_share_entry e
        join device d on d.id = e.device_id
        where d.group_id = ${groupId}::uuid and d.id = ${query.deviceId}::uuid
          and d.enabled and d.group_id <> ${unassignedGroup}::uuid
          and d.assignee_user_id = ${administratorId}::uuid
          and e.box_online and e.assignee_user_id = ${administratorId}::uuid
          and e.place = 'box' and e.kind = 'file' and e.category = ${kind}
        order by e.parent_path, name, e.id`
    },
    directories: async (
      groupId: string,
      administratorId: string | null,
      deviceId: string,
      source: FileChoice["source"],
    ) => {
      if (administratorId === null) return []
      const rows = await sql<{ bucket: string; count: number; directory: string }[]>`
        select e.bucket, e.parent_path as directory, count(*)::int as count
        from box_share_entry e
        join device d on d.id = e.device_id
        where d.group_id = ${groupId}::uuid and d.id = ${deviceId}::uuid
          and d.enabled and d.group_id <> ${unassignedGroup}::uuid
          and d.assignee_user_id = ${administratorId}::uuid
          and e.box_online and e.assignee_user_id = ${administratorId}::uuid
          and e.kind = 'file'
          and (
            (${source} = 'pool.backup' and e.bucket = 'backup')
            or (${source} = 'pool.video' and e.category = 'video' and e.bucket <> 'backup')
            or (${source} = 'pool.image' and e.category = 'image' and e.bucket <> 'backup')
          )
        group by e.bucket, e.parent_path
        order by e.bucket, e.parent_path`
      return rows
    },
    create: async (
      groupId: string,
      actorId: string,
      administratorId: string,
      recipe: { readonly chainId: string | null; readonly taskChainId: string | null },
      selection: DispatchSelection,
      stageRetry: {
        readonly refreshes: readonly { readonly sequence: number; readonly stage: number }[]
        readonly refreshStages?: readonly number[]
        readonly retries: readonly {
          readonly auto: boolean
          readonly limit: number
          readonly stage: number
        }[]
      } = { refreshes: [], retries: [] },
    ) => {
      const prepared = await prepareSteps(administratorId, recipe, selection.repeats)
      if (prepared === null) return { kind: "missing_chain" as const }
      if (prepared === "invalid") return { kind: "invalid" as const }
      const needsRegion = prepared.steps.some((step) => regionParameter(step.skill) !== null)
      if (needsRegion && !regionCodes.has(selection.region))
        return { kind: "region_required" as const }
      if (!needsRegion && selection.region !== "") return { kind: "region_not_allowed" as const }
      const needsLanguage = prepared.steps.some((step) => languageParameter(step.skill) !== null)
      if (needsLanguage && !languageCodes.has(selection.language)) {
        return { kind: "language_required" as const }
      }
      if (!needsLanguage && selection.language !== "")
        return { kind: "language_not_allowed" as const }
      const instances = selection.instances ?? []
      const pitRange = selection.pitRange ?? []
      const usesInstances = instances.length > 0 || pitRange.length > 0
      if (usesInstances) {
        if (instances.length === 0) return { kind: "instances_required" as const }
        const range = new Set(pitRange)
        if (instances.some((item) => item.index < 1 || item.index > 5 || !range.has(item.index))) {
          return { kind: "instance_out_of_range" as const }
        }
        const deviceIds = [...new Set(instances.map((item) => item.deviceId))]
        const found = await sql<{ deviceId: string; index: number }[]>`
          select d.id::text as "deviceId", i.instance_index as index
          from device_instance i
          join device d on d.id = i.device_id
          where d.group_id = ${groupId}::uuid and d.id = any(${deviceIds}::uuid[])
            and d.enabled and d.group_id <> ${unassignedGroup}::uuid
            and d.assignee_user_id = ${administratorId}::uuid`
        const known = new Set(found.map((item) => `${item.deviceId}#${item.index}`))
        if (instances.some((item) => !known.has(`${item.deviceId}#${item.index}`))) {
          return { kind: "instance_not_found" as const }
        }
        const hasAccounts =
          selection.accounts !== null || selection.poolId !== "" || selection.accountIds.length > 0
        if (prepared.needsAccount && !hasAccounts) return { kind: "account_required" as const }
        if (!prepared.needsAccount && hasAccounts) return { kind: "account_not_allowed" as const }
      }
      const accountIds =
        usesInstances && !prepared.needsAccount
          ? []
          : selection.accounts === null
            ? await accountsForPool(groupId, selection.poolId)
            : "ids" in selection.accounts
              ? await accountsForIds(groupId, selection.accounts.ids)
              : await accountsForSet(groupId, selection.accounts)
      if (accountIds === null) {
        return selection.accounts !== null && "ids" in selection.accounts
          ? { kind: "invalid" as const }
          : { kind: "missing_pool" as const }
      }
      if (accountIds.length === 0 && !(usesInstances && !prepared.needsAccount)) {
        return { kind: "no_accounts" as const }
      }
      const boxIds =
        selection.boxes === null
          ? selection.boxIds
          : await devicesForSet(groupId, administratorId, selection.boxes)
      const proxyIds =
        selection.proxies === null
          ? selection.proxyIds
          : "ids" in selection.proxies
            ? await proxiesForIds(groupId, selection.proxies.ids)
            : await proxiesForSet(groupId, selection.proxies)
      if (proxyIds === null) return { kind: "invalid" as const }
      const selected = { ...selection, accountIds, accountNote: "", boxIds, proxyIds }
      const loaded = await workspace(groupId, administratorId, recipe, selected)
      if (loaded === "invalid") return { kind: "invalid" as const }
      if (loaded === null) return { kind: "missing_chain" as const }
      const stageCount = loaded.taskChainId === null ? 1 : loaded.repeatPlan.length
      const retryStages = stageRetry.retries.map((item) => item.stage)
      const refreshStages = stageRetry.refreshStages ?? []
      const refreshKeys = stageRetry.refreshes.map((item) => `${item.stage}:${item.sequence}`)
      const retryValid = stageRetry.retries.every(
        (item) =>
          item.stage >= 0 &&
          item.stage < stageCount &&
          (item.auto ? item.limit >= 1 && item.limit <= 9 : item.limit === 0),
      )
      const refreshValid =
        refreshStages.every((stage) => stage >= 0 && stage < stageCount) &&
        stageRetry.refreshes.every((item) =>
          loaded.steps.some(
            (step, index) =>
              (step.stagePosition ?? 0) === item.stage &&
              (step.localSequence ?? index) === item.sequence &&
              isIndependentProxyStep(step),
          ),
        )
      if (
        !retryValid ||
        !refreshValid ||
        new Set(retryStages).size !== retryStages.length ||
        new Set(refreshKeys).size !== refreshKeys.length ||
        new Set(refreshStages).size !== refreshStages.length
      ) {
        return { kind: "invalid" as const }
      }
      const mismatched = [...selected.texts, ...selected.files].some(
        (item) => (item.stage ?? 0) >= stageCount,
      )
      if (mismatched) return { kind: "invalid" as const }
      if (loaded.accounts.length === 0 && !(usesInstances && !prepared.needsAccount)) {
        return { kind: "no_accounts" as const }
      }
      const media = selected.media ?? []
      const wanted = loaded.steps.flatMap((step, index) => {
        if (step.skill !== "UploadPitImage" && step.skill !== "UploadPitVideo") return []
        return [
          {
            kind: step.skill === "UploadPitImage" ? ("image" as const) : ("video" as const),
            sequence: step.localSequence ?? index,
            stage: step.stagePosition ?? 0,
          },
        ]
      })
      if (
        media.some(
          (item) =>
            !wanted.some(
              (step) =>
                step.kind === item.kind &&
                step.sequence === item.sequence &&
                step.stage === item.stage,
            ),
        )
      ) {
        return { kind: "invalid" as const }
      }
      const missingMedia = wanted.find(
        (step) =>
          !media.some(
            (item) =>
              item.kind === step.kind &&
              item.sequence === step.sequence &&
              item.stage === step.stage,
          ),
      )
      if (missingMedia !== undefined) {
        return { kind: "media_required" as const, mediaKind: missingMedia.kind }
      }
      const chances = chanceAssignments(prepared.steps, selection.chances ?? [])
      if (chances !== "ok") return { kind: chances }
      const textPick = textAssignments(prepared.steps, selection.texts)
      if (textPick !== "ok") return { kind: textPick }
      const emptyText = selection.texts.some((item) => {
        const picked = item.ids ?? []
        if (picked.length > 0)
          return !picked.every((id) => loaded.texts.some((row) => row.id === id))
        return !loaded.texts.some((row) => row.category === (item.tag ?? ""))
      })
      if (emptyText) return { kind: "text_empty" as const }
      const mediaFiles = new Map<string, { host: string; id: string; path: string }[]>()
      for (const choice of media) {
        const files = await loadMediaFiles(sql, groupId, administratorId, choice)
        const picked = choice.ids ?? []
        if (picked.length > 0 && files.length !== picked.length) return { kind: "invalid" as const }
        if (files.length === 0) return { kind: "media_empty" as const, mediaKind: choice.kind }
        mediaFiles.set(`${choice.stage}:${choice.sequence}:${choice.kind}`, files)
      }
      const refreshStageSet = new Set(refreshStages)
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
        loaded.repeatPlan,
        random,
        mediaFiles,
        refreshStageSet,
      )
      const status = planned.some((item) => item.status === "incomplete") ? "incomplete" : "ready"
      const dispatchId = randomUUID()
      await sql.begin(async (tx) => {
        await tx`
          insert into operation_dispatch (
            id, group_id, requester_id, chain_id, task_chain_id, name, selection, status, repeat_plan
          ) values (
            ${dispatchId}::uuid, ${groupId}::uuid, ${actorId}::uuid, ${loaded.chainId}::uuid,
            ${loaded.taskChainId}::uuid, ${loaded.name}, ${tx.json(selected)}, ${status},
            ${tx.json(loaded.repeatPlan)}
          )`
        const retryOf = new Map(stageRetry.retries.map((item) => [item.stage, item]))
        for (let stage = 0; stage < stageCount; stage += 1) {
          const spec = retryOf.get(stage)
          const auto = spec?.auto === true
          const limit = auto ? (spec?.limit ?? 0) : 0
          await tx`
            insert into operation_dispatch_stage (
              dispatch_id, stage_position, auto_retry, auto_retry_limit, refresh_draw
            ) values (
              ${dispatchId}::uuid, ${stage}, ${auto}, ${limit}, ${refreshStageSet.has(stage)}
            )`
        }
        const refreshOn = refreshStageSet.size > 0 ? new Set<string>() : new Set(refreshKeys)
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
                text_resource_id, guards, after_ms, stage_position, stage_name, repeat_index, repeat_count,
                refresh_external, remark
              ) values (
                ${randomUUID()}::uuid, ${itemId}::uuid, ${step.sequence}, ${step.skill},
                ${tx.json(step.sources)}, ${tx.json(step.scopes)}, ${tx.json(step.parameters)},
                ${step.missingKeys.length === 0 ? "complete" : "incomplete"}, ${step.missingKeys},
                ${step.textResourceId === null || step.textResourceId.length === 0 ? null : step.textResourceId}::uuid,
                ${tx.json(step.guards)}, ${step.afterMs}, ${step.stagePosition ?? 0}, ${step.stageName ?? ""},
                ${step.repeatIndex ?? 0}, ${step.repeatCount ?? 1},
                ${refreshOn.has(`${step.stagePosition ?? 0}:${step.sequence}`)},
                ${step.remark ?? ""}
              )`
            await rememberDrawnAccount(
              tx,
              item.accountId,
              step.textResourceId,
              step.parameters["图片ID"],
              step.parameters["视频ID"],
            )
          }
        }
      })
      return {
        id: dispatchId,
        items: planned,
        kind: "created" as const,
        name: loaded.name,
        status,
      }
    },
    list: async (groupId: string) => {
      const rows = await sql<
        {
          account: string
          accountConstrained: boolean
          chainId: string
          chainName: string
          createdAt: Date
          deviceHost: string
          deviceId: string
          deviceName: string
          dispatchId: string
          instanceIndex: number | null
          itemId: string
          itemStatus: string
          missing: string[]
          name: string
          proxyEndpoint: string
          requesterDisplay: string
          requesterEmail: string
          status: string
        }[]
      >`
        select d.id::text as "dispatchId", d.name, d.status, d.created_at as "createdAt",
          coalesce(d.task_chain_id::text, '') as "chainId",
          coalesce(tc.name, c.name, '') as "chainName",
          coalesce(u.display_name, '') as "requesterDisplay",
          coalesce(u.email, '') as "requesterEmail",
          i.id::text as "itemId", i.status as "itemStatus", i.missing,
          i.instance_index as "instanceIndex",
          coalesce(i.device_id::text, '') as "deviceId",
          coalesce(dev.name, '') as "deviceName", coalesce(dev.host, '') as "deviceHost",
          coalesce(p.endpoint, '') as "proxyEndpoint",
          case
            when btrim(coalesce(a.identifier, '')) <> '' then a.identifier
            else coalesce(a.name, '')
          end as account,
          (
            coalesce(c.anchor_table, '') = 'operation_account'
            or exists (
              select 1 from task_chain_item tci
              join behavior_chain bc on bc.id = tci.chain_id
              where tci.task_chain_id = d.task_chain_id
                and bc.anchor_table = 'operation_account'
            )
          ) as "accountConstrained"
        from operation_dispatch d
        left join behavior_chain c on c.id = d.chain_id
        left join task_chain tc on tc.id = d.task_chain_id
        left join app_user u on u.id = d.requester_id
        join operation_dispatch_item i on i.dispatch_id = d.id
        left join device dev on dev.id = i.device_id
        left join operation_proxy p on p.id = i.proxy_id
        left join operation_account a on a.id = i.account_id
        where d.group_id = ${groupId}::uuid
        order by d.created_at desc, i.instance_index nulls last, i.id`
      const itemIds = rows.map((row) => row.itemId)
      const stepRows =
        itemIds.length === 0
          ? []
          : await sql<
              {
                itemId: string
                parameters: unknown
                repeat: number
                sequence: number
                sources: unknown
                stage: number
              }[]
            >`
              select item_id::text as "itemId", parameters, sources, sequence,
                stage_position as stage, repeat_index as repeat
              from operation_dispatch_step
              where item_id = any(${itemIds}::uuid[])`
      const plansOf = new Map<
        string,
        {
          parameters: Record<string, string>
          repeat: number
          sequence: number
          sources: Record<string, string>
          stage: number
        }[]
      >()
      for (const step of stepRows) {
        const list = plansOf.get(step.itemId) ?? []
        list.push({
          parameters: stringMap(step.parameters),
          repeat: step.repeat,
          sequence: step.sequence,
          sources: stringMap(step.sources),
          stage: step.stage,
        })
        plansOf.set(step.itemId, list)
      }
      const attemptRows =
        itemIds.length === 0
          ? []
          : await sql<
              {
                itemId: string
                priority: number
                repeat: number
                stage: number
                status: string
              }[]
            >`
              select distinct on (dispatch_item_id, stage_position, repeat_index)
                dispatch_item_id::text as "itemId",
                stage_position as stage,
                repeat_index as repeat,
                status,
                queue_priority as priority
              from execution_task
              where dispatch_item_id = any(${itemIds}::uuid[])
              order by dispatch_item_id, stage_position, repeat_index, created_at desc, id desc`
      const attemptsOf = new Map<
        string,
        { priority: number; repeat: number; stage: number; status: string }[]
      >()
      for (const attempt of attemptRows) {
        const list = attemptsOf.get(attempt.itemId) ?? []
        list.push(attempt)
        attemptsOf.set(attempt.itemId, list)
      }
      const taskRows =
        itemIds.length === 0
          ? []
          : await sql<
              {
                createdAt: Date
                finishedAt: Date | null
                id: string
                itemId: string
                repeat: number
                stage: number
              }[]
            >`
              select id::text as id, dispatch_item_id::text as "itemId",
                created_at as "createdAt", finished_at as "finishedAt",
                stage_position as stage, repeat_index as repeat
              from execution_task
              where dispatch_item_id = any(${itemIds}::uuid[])`
      const tasksOf = new Map<
        string,
        {
          createdAt: Date
          finishedAt: Date | null
          id: string
          itemId: string
          repeat: number
          stage: number
        }[]
      >()
      for (const task of taskRows) {
        const list = tasksOf.get(task.itemId) ?? []
        list.push({
          createdAt: new Date(task.createdAt),
          finishedAt: task.finishedAt === null ? null : new Date(task.finishedAt),
          id: task.id,
          itemId: task.itemId,
          repeat: task.repeat,
          stage: task.stage,
        })
        tasksOf.set(task.itemId, list)
      }
      const taskIds = taskRows.map((task) => task.id)
      const executedRows =
        taskIds.length === 0
          ? []
          : await sql<
              {
                parameters: unknown
                sequence: number
                status: string
                taskId: string
              }[]
            >`
              select task_id::text as "taskId", sequence, status, parameters
              from execution_task_step
              where task_id = any(${taskIds}::uuid[])`
      const executedOf = new Map<
        string,
        { parameters: Record<string, string>; sequence: number; status: string }[]
      >()
      for (const step of executedRows) {
        const list = executedOf.get(step.taskId) ?? []
        list.push({
          parameters: stringMap(step.parameters),
          sequence: step.sequence,
          status: step.status,
        })
        executedOf.set(step.taskId, list)
      }
      const grouped = new Map<string, (typeof rows)[number][]>()
      for (const row of rows) {
        const list = grouped.get(row.dispatchId) ?? []
        list.push(row)
        grouped.set(row.dispatchId, list)
      }
      return [...grouped.values()]
        .map((items) => {
          const first = items[0]
          if (first === undefined) return null
          const clocks: { createdAt: Date; finishedAt: Date | null }[] = []
          const accounts = items.map((item) => {
            const runStatus =
              first.status === "started" ? accountRunStatus(attemptsOf.get(item.itemId) ?? []) : ""
            const plan = plansOf.get(item.itemId) ?? []
            const tasks = tasksOf.get(item.itemId) ?? []
            for (const task of tasks) clocks.push(task)
            let latest: (typeof tasks)[number] | null = null
            const segmentTasks = new Map<string, (typeof tasks)[number]>()
            for (const task of tasks) {
              latest = laterTask(latest, task)
              const key = `${task.stage}:${task.repeat}`
              segmentTasks.set(key, laterTask(segmentTasks.get(key) ?? null, task))
            }
            const chosen = latest
            const latestSteps =
              chosen === null
                ? []
                : (executedOf.get(chosen.id) ?? []).flatMap((step) => {
                    const source = plan.find(
                      (row) =>
                        row.sequence === step.sequence &&
                        row.stage === chosen.stage &&
                        row.repeat === chosen.repeat,
                    )
                    return source === undefined
                      ? []
                      : [{ parameters: step.parameters, sources: source.sources }]
                  })
            const executed = new Map<string, { sequence: number; status: string }[]>()
            for (const [key, task] of segmentTasks) {
              executed.set(
                key,
                (executedOf.get(task.id) ?? []).map((step) => ({
                  sequence: step.sequence,
                  status: step.status,
                })),
              )
            }
            const progress = stepProgress(plan, executed)
            return {
              account: item.accountConstrained ? item.account : "",
              deviceHost: item.deviceHost,
              deviceId: item.deviceId,
              deviceName: item.deviceName,
              id: item.itemId,
              instanceIndex: item.instanceIndex,
              missing: item.missing,
              proxyEndpoint: lastProxyHost(item.proxyEndpoint, latestSteps),
              runStatus: displayRunStatus(runStatus, progress.failed, plan.length),
              status: item.itemStatus,
              stepCount: plan.length,
              stepFinished: progress.finished,
              stepTone: progressTone(progress.finished, plan.length, progress.failed),
            }
          })
          const runStatuses = accounts.map((item) => item.runStatus)
          const taskFinished = countFinished(runStatuses)
          const times = dispatchTimes(items.length, taskFinished, clocks)
          const taskTone = rollupTone(runStatuses, taskFinished)
          return {
            accountCount: items.length,
            accounts,
            chainId: first.chainId,
            chainName: first.chainName,
            createdAt: new Date(first.createdAt).toISOString(),
            finishedAt: times.finishedAt,
            id: first.dispatchId,
            missing: [...new Set(items.flatMap((item) => item.missing))],
            name: first.name,
            requesterName: requesterLabel(first.requesterDisplay, first.requesterEmail),
            runStatus:
              first.status === "started"
                ? dispatchRunStatus(accounts.map((item) => item.runStatus))
                : "",
            startedAt: times.startedAt,
            status: first.status,
            taskCount: items.length,
            taskFinished,
            taskTone,
          }
        })
        .filter((item) => item !== null)
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
          select i.dispatch_id::text as "dispatchId", coalesce(a.identifier, '') as account, s.sequence, s.missing_keys as keys
          from operation_dispatch_item i
          left join operation_account a on a.id = i.account_id
          join operation_dispatch_step s on s.item_id = i.id
          where i.dispatch_id = any(${[...ids]}::uuid[])
            and (i.status = 'incomplete' or s.fill_status = 'incomplete')
          order by coalesce(a.identifier, ''), s.sequence`
        if (gaps.length > 0) return { gaps, kind: "incomplete" as const }
        const items = await tx<
          {
            accountId: string | null
            afterMs: number
            backupDeviceId: string | null
            chainName: string
            deviceId: string
            guards: string[]
            instanceId: string | null
            instanceIndex: number
            itemId: string
            name: string
            parameters: Record<string, string>
            proxyId: string | null
            remark: string
            repeatCount: number
            repeatIndex: number
            sequence: number
            skill: string
            sources: Record<string, string>
            stageName: string
            stagePosition: number
            taskChainId: string | null
            autoRetry: boolean
            autoRetryLimit: number
          }[]
        >`
          select i.id::text as "itemId", i.account_id::text as "accountId", i.device_id::text as "deviceId",
            i.instance_index as "instanceIndex", i.instance_id::text as "instanceId", i.proxy_id::text as "proxyId",
            d.name, d.task_chain_id::text as "taskChainId",
            coalesce(case when d.task_chain_id is null then bc.name else s.stage_name end, '') as "chainName",
            coalesce(s.remark, '') as remark,
            s.sequence, s.skill, s.parameters, s.sources, s.guards, s.after_ms as "afterMs",
            s.stage_position as "stagePosition", s.stage_name as "stageName",
            s.repeat_index as "repeatIndex", s.repeat_count as "repeatCount",
            coalesce(st.auto_retry, false) as "autoRetry",
            coalesce(st.auto_retry_limit, 0) as "autoRetryLimit",
            a.backup_device_id::text as "backupDeviceId"
          from operation_dispatch_item i
          join operation_dispatch d on d.id = i.dispatch_id
          left join behavior_chain bc on bc.id = d.chain_id
          join operation_dispatch_step s on s.item_id = i.id
          left join operation_dispatch_stage st
            on st.dispatch_id = d.id and st.stage_position = s.stage_position
          left join operation_account a on a.id = i.account_id
          where i.dispatch_id = any(${[...ids]}::uuid[]) and i.status = 'ready'
          order by i.id, s.stage_position, s.repeat_index, s.sequence`
        const byItem = new Map<string, (typeof items)[number][]>()
        for (const row of items) {
          const list = byItem.get(row.itemId) ?? []
          list.push(row)
          byItem.set(row.itemId, list)
        }
        const hostIds = [
          ...new Set(
            items.flatMap((item) =>
              [item.deviceId, item.backupDeviceId].filter(
                (id): id is string => id !== null && id.length > 0,
              ),
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
          const head = steps[0]
          if (head === undefined || head.deviceId === null) continue
          const current = {
            backupHost: head.backupDeviceId === null ? "" : (hostOf.get(head.backupDeviceId) ?? ""),
            deviceHost: hostOf.get(head.deviceId) ?? "",
          }
          const refreshed = steps.map((step) => ({
            ...step,
            parameters: refreshDeviceHosts(step.parameters, step.sources, current).parameters,
          }))
          const groups: (typeof refreshed)[] = []
          for (const step of refreshed) {
            const previous = groups.at(-1)?.[0]
            const same =
              previous !== undefined &&
              previous.stagePosition === step.stagePosition &&
              previous.repeatIndex === step.repeatIndex &&
              previous.taskChainId === step.taskChainId
            if (same) groups.at(-1)?.push(step)
            else groups.push([step])
          }
          let previousTask: string | null = null
          let firstTask: string | null = null
          const stageCount = new Set(refreshed.map((step) => step.stagePosition)).size
          for (const group of groups) {
            const first = group[0]
            if (first === undefined) continue
            const legacy = first.taskChainId === null
            const taskId = randomUUID()
            const key = legacy
              ? `dispatch:${itemId}`
              : `dispatch:${itemId}:${first.stagePosition}:${first.repeatIndex}`
            const taskName = legacy ? first.name : first.stageName
            const parameters = group.map((step) => ({
              input: step.parameters,
              skill: step.skill,
            }))
            const guards = group.map((step) => step.guards)
            const delays = group.map((step) => step.afterMs)
            const digest = hashValue({
              delays,
              deviceId: first.deviceId,
              guards,
              indexNum: first.instanceIndex,
              parameters,
            })
            const stageAutoRetry: boolean = first.autoRetry
            const stageAutoLimit: number = first.autoRetryLimit
            const inserted = await tx<{ id: string }[]>`
              insert into execution_task (
                id, group_id, requester_id, device_id, account_id, idempotency_key, fingerprint,
                name, executor_key, parameters, status, predecessor_task_id, dispatch_item_id,
                task_chain_id, stage_position, stage_count, repeat_index, repeat_count,
                auto_retry, auto_retry_limit, chain_name
              ) values (
                ${taskId}::uuid, ${groupId}::uuid, ${actorId}::uuid, ${first.deviceId}::uuid,
                ${first.accountId}::uuid, ${key}, ${digest}, ${taskName}, 'box-agent',
                ${tx.json(parameters)}, 'queued', ${previousTask}::uuid, ${itemId}::uuid,
                ${first.taskChainId}::uuid, ${legacy ? 0 : first.stagePosition},
                ${legacy ? 1 : stageCount}, ${legacy ? 0 : first.repeatIndex},
                ${legacy ? 1 : first.repeatCount}, ${stageAutoRetry}, ${stageAutoLimit},
                ${first.chainName}
              ) on conflict (group_id, idempotency_key) do nothing returning id::text as id`
            const existing = inserted[0]?.id
            const resolved =
              existing ??
              (
                await tx<{ id: string }[]>`
                select id::text as id from execution_task
                where group_id = ${groupId}::uuid and idempotency_key = ${key}`
              )[0]?.id
            if (resolved === undefined) continue
            if (existing !== undefined) {
              for (const step of group) {
                await tx`
                  insert into execution_task_step (
                    id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target,
                    parameters, status, instance_id, guards, after_ms, remark, node_name
                  ) values (
                    ${randomUUID()}::uuid, ${resolved}::uuid, ${groupId}::uuid, ${step.sequence},
                    ${`${key}:${step.sequence}`}, ${key}, ${step.skill}, ${tx.json({ indexNum: step.instanceIndex })},
                    ${tx.json(agentStepParameters(step.skill, step.parameters))}, 'pending', ${step.instanceId}::uuid, ${tx.json(step.guards)},
                    ${step.afterMs}, ${step.remark}, ${skillNodeName(step.skill)}
                  )`
              }
            }
            if (firstTask === null) firstTask = resolved
            previousTask = resolved
          }
          if (firstTask === null) continue
          await tx`
            update operation_dispatch_item
            set execution_task_id = ${firstTask}::uuid, status = 'started'
            where id = ${itemId}::uuid`
          if (head.accountId !== null && head.accountId.length > 0) {
            await tx`
              update operation_account
              set device_id = ${head.deviceId}::uuid,
                device_instance_id = ${head.instanceId}::uuid,
                proxy_id = coalesce(${head.proxyId}::uuid, proxy_id),
                updated_at = now()
              where id = ${head.accountId}::uuid and group_id = ${groupId}::uuid`
          }
          devices.add(head.deviceId)
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
    replayOptions: async (groupId: string, taskId: string) =>
      inspectReplay(sql, groupId, taskId, null),
    replay: async (
      groupId: string,
      actorId: string,
      taskId: string,
      choices: readonly ReplayChoice[],
      origin: "auto" | "manual" = "manual",
    ) => {
      try {
        return await sql.begin(async (tx) => {
          const inspected = await inspectReplay(tx, groupId, taskId, choices)
          if (inspected.kind !== "ready") return inspected
          const replayId = randomUUID()
          const key = `replay:${replayId}`
          const parameters = inspected.rows.map((row) => {
            const applied = inspected.applied.steps.find((item) => item.sequence === row.sequence)
            return { input: applied?.parameters ?? asRecord(row.parameters), skill: row.skill }
          })
          const digest = hashValue({
            delays: inspected.rows.map((row) => row.afterMs),
            deviceId: inspected.deviceId,
            guards: inspected.rows.map((row) => row.guards),
            indexNum: inspected.instanceIndex,
            parameters,
          })
          const inserted = await tx<{ id: string }[]>`
            insert into execution_task (
              id, group_id, requester_id, device_id, account_id, idempotency_key, fingerprint,
              name, executor_key, parameters, status, predecessor_task_id, dispatch_item_id,
              task_chain_id, stage_position, stage_count, repeat_index, repeat_count, queue_priority,
              auto_retry, auto_retry_limit, chain_name
            ) values (
              ${randomUUID()}::uuid, ${groupId}::uuid, ${actorId}::uuid, ${inspected.deviceId}::uuid,
              ${inspected.accountId}::uuid, ${key}, ${digest}, ${inspected.name}, 'box-agent',
              ${tx.json(parameters)}, 'queued', ${inspected.predecessor}::uuid, ${inspected.itemId}::uuid,
              ${inspected.taskChainId}::uuid, ${inspected.stagePosition}, ${inspected.stageCount},
              ${inspected.repeatIndex}, ${inspected.repeatCount}, 1,
              ${inspected.autoRetry}, ${inspected.autoRetryLimit}, ${inspected.rows[0]?.chainName ?? ""}
            ) returning id::text as id`
          const createdId = inserted[0]?.id
          if (createdId === undefined) return { kind: "invalid_replay_request" as const }
          for (const row of inspected.rows) {
            const applied = inspected.applied.steps.find((item) => item.sequence === row.sequence)
            const input = applied?.parameters ?? asRecord(row.parameters)
            await tx`
              update operation_dispatch_step
              set parameters = ${tx.json(input)},
                text_resource_id = ${applied?.textResourceId ?? null}::uuid,
                missing_keys = '{}', fill_status = 'complete'
              where item_id = ${inspected.itemId}::uuid
                and stage_position = ${inspected.stagePosition}
                and repeat_index = ${inspected.repeatIndex}
                and sequence = ${row.sequence}`
            await tx`
              insert into execution_task_step (
                id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target,
                parameters, status, instance_id, guards, after_ms, remark, node_name
              ) values (
                ${randomUUID()}::uuid, ${createdId}::uuid, ${groupId}::uuid, ${row.sequence},
                ${`${key}:${row.sequence}`}, ${key}, ${row.skill},
                ${tx.json({ indexNum: inspected.instanceIndex })}, ${tx.json(agentStepParameters(row.skill, asRecord(input)))}, 'pending',
                ${inspected.instanceId}::uuid, ${tx.json(row.guards)}, ${row.afterMs},
                ${row.remark}, ${skillNodeName(row.skill)}
              )`
            await rememberDrawnAccount(
              tx,
              inspected.accountId,
              applied?.textResourceId,
              typeof input["图片ID"] === "string" ? input["图片ID"] : null,
              typeof input["视频ID"] === "string" ? input["视频ID"] : null,
            )
          }
          if (inspected.applied.proxyId !== null) {
            await tx`
              update operation_dispatch_item
              set proxy_id = ${inspected.applied.proxyId}::uuid
              where id = ${inspected.itemId}::uuid`
            if (inspected.accountId !== null) {
              await tx`
                update operation_account
                set proxy_id = ${inspected.applied.proxyId}::uuid, updated_at = now()
                where id = ${inspected.accountId}::uuid and group_id = ${groupId}::uuid`
            }
          }
          const restored = await tx<{ id: string }[]>`
            with recursive later as (
              select id from execution_task
              where predecessor_task_id = ${taskId}::uuid
                and status = 'cancelled' and terminal_reason = 'previous_stage_stopped'
              union all
              select t.id from execution_task t
              join later on t.predecessor_task_id = later.id
              where t.status = 'cancelled' and t.terminal_reason = 'previous_stage_stopped'
            )
            update execution_task task
            set predecessor_task_id = case
                  when task.predecessor_task_id = ${taskId}::uuid then ${createdId}::uuid
                  else task.predecessor_task_id
                end,
              status = 'queued', finished_at = null, terminal_reason = null,
              error_code = null, error_message = null, updated_at = now()
            from later
            where task.id = later.id
            returning later.id::text as id`
          const restoredIds = restored.map((item) => item.id)
          if (restoredIds.length > 0) {
            await tx`
              update execution_task_step
              set status = 'pending', started_at = null, finished_at = null,
                result = null, error_code = null, error_message = null
              where task_id = any(${restoredIds}::uuid[]) and status = 'cancelled'`
          }
          await tx`
            insert into operation_stage_replay (
              id, group_id, dispatch_id, item_id, source_task_id, replay_task_id,
              stage_position, repeat_index, choices, created_by, origin
            ) values (
              ${replayId}::uuid, ${groupId}::uuid, ${inspected.dispatchId}::uuid,
              ${inspected.itemId}::uuid, ${taskId}::uuid, ${createdId}::uuid,
              ${inspected.stagePosition}, ${inspected.repeatIndex}, ${tx.json(inspected.choices)},
              ${actorId}::uuid, ${origin}
            )`
          return {
            deviceId: inspected.deviceId,
            kind: "created" as const,
            replayId,
            taskId: createdId,
          }
        })
      } catch (error) {
        if (uniqueViolation(error)) return { kind: "replay_in_progress" as const }
        throw error
      }
    },
    clearRecords: async (
      groupId: string,
      deviceIds: readonly string[],
      unassigned: boolean,
      dispatchIds: readonly string[] = [],
    ) => {
      if (dispatchIds.length === 0 && deviceIds.length === 0 && !unassigned) return 0
      const ids = deviceIds.length === 0 ? ["00000000-0000-0000-0000-000000000000"] : [...deviceIds]
      const hasDevices = deviceIds.length > 0
      const selected =
        dispatchIds.length === 0 ? ["00000000-0000-0000-0000-000000000000"] : [...dispatchIds]
      const byDispatch = dispatchIds.length > 0
      return sql.begin(async (tx) => {
        const itemFilter = byDispatch
          ? tx`
          group_id = ${groupId}::uuid
            and dispatch_id = any(${selected}::uuid[])`
          : tx`
          group_id = ${groupId}::uuid
            and (
              (${hasDevices} and device_id = any(${ids}::uuid[]))
              or (${unassigned} and device_id is null)
            )`
        const tasks = await tx<{ id: string }[]>`
          select id::text as id from execution_task
          where group_id = ${groupId}::uuid and ${!byDispatch} and ${hasDevices} and device_id = any(${ids}::uuid[])
          union
          select execution_task_id::text as id from operation_dispatch_item
          where execution_task_id is not null and ${itemFilter}
          union
          select id::text as id from execution_task
          where group_id = ${groupId}::uuid and dispatch_item_id in (
            select id from operation_dispatch_item where ${itemFilter}
          )`
        const taskIds = tasks.map((task) => task.id)
        let removed = 0
        if (taskIds.length > 0) {
          await tx`
            update execution_task set predecessor_task_id = null
            where group_id = ${groupId}::uuid and predecessor_task_id = any(${taskIds}::uuid[])`
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
          await tx`
            delete from operation_stage_replay
            where source_task_id = any(${taskIds}::uuid[])
              or replay_task_id = any(${taskIds}::uuid[])`
          const deleted = await tx<{ id: string }[]>`
            delete from execution_task
            where group_id = ${groupId}::uuid and id = any(${taskIds}::uuid[])
            returning id::text as id`
          removed = deleted.length
        }
        const removedItems = await tx<{ dispatchId: string }[]>`
          delete from operation_dispatch_item
          where ${itemFilter}
          returning dispatch_id::text as "dispatchId"`
        const dispatchIds = [...new Set(removedItems.map((item) => item.dispatchId))]
        if (dispatchIds.length > 0) {
          await tx`
            delete from operation_dispatch d
            where d.group_id = ${groupId}::uuid and d.id = any(${dispatchIds}::uuid[])
              and not exists (select 1 from operation_dispatch_item i where i.dispatch_id = d.id)`
        }
        return removed
      })
    },
    itemSteps: async (groupId: string, dispatchId: string, itemId: string) => {
      const owned = await sql<{ ok: number }[]>`
        select 1 as ok
        from operation_dispatch_item i
        join operation_dispatch d on d.id = i.dispatch_id
        where i.id = ${itemId}::uuid
          and d.id = ${dispatchId}::uuid
          and d.group_id = ${groupId}::uuid`
      if (owned.length === 0) return null
      const plan = await sql<
        {
          fillStatus: string
          parameters: unknown
          repeatCount: number
          repeatIndex: number
          sequence: number
          skill: string
          sources: unknown
          stageName: string
          stagePosition: number
        }[]
      >`
        select sequence, skill, parameters, sources, fill_status as "fillStatus",
          stage_position as "stagePosition", stage_name as "stageName",
          repeat_index as "repeatIndex", repeat_count as "repeatCount"
        from operation_dispatch_step
        where item_id = ${itemId}::uuid
        order by stage_position, repeat_index, sequence`
      const tasks = await sql<
        {
          autoLimit: number
          createdAt: Date
          id: string
          repeatIndex: number
          stagePosition: number
        }[]
      >`
        select id::text as id, created_at as "createdAt",
          stage_position as "stagePosition", repeat_index as "repeatIndex",
          auto_retry_limit as "autoLimit"
        from execution_task
        where dispatch_item_id = ${itemId}::uuid`
      const taskIds = tasks.map((task) => task.id)
      const executed =
        taskIds.length === 0
          ? []
          : await sql<
              {
                errorCode: string
                parameters: unknown
                sequence: number
                status: string
                taskId: string
              }[]
            >`
              select task_id::text as "taskId", sequence, status,
                coalesce(error_code, '') as "errorCode", parameters
              from execution_task_step
              where task_id = any(${taskIds}::uuid[])`
      const replays = await sql<
        {
          createdAt: Date
          id: string
          origin: string
          repeatIndex: number
          stagePosition: number
        }[]
      >`
        select id::text as id, origin, created_at as "createdAt",
          stage_position as "stagePosition", repeat_index as "repeatIndex"
        from operation_stage_replay
        where item_id = ${itemId}::uuid`
      return {
        segments: buildSegments({
          executed: executed.map((step) => ({
            errorCode: step.errorCode,
            parameters: stringMap(step.parameters),
            sequence: step.sequence,
            status: step.status,
            taskId: step.taskId,
          })),
          plan: plan.map((step) => ({
            fillStatus: step.fillStatus,
            parameters: stringMap(step.parameters),
            repeatCount: step.repeatCount,
            repeatIndex: step.repeatIndex,
            sequence: step.sequence,
            skill: step.skill,
            sources: stringMap(step.sources),
            stageName: step.stageName,
            stagePosition: step.stagePosition,
          })),
          replays: replays.map((replay) => ({
            createdAt: new Date(replay.createdAt),
            id: replay.id,
            origin: replay.origin,
            repeatIndex: replay.repeatIndex,
            stagePosition: replay.stagePosition,
          })),
          tasks: tasks.map((task) => ({
            autoLimit: task.autoLimit,
            createdAt: new Date(task.createdAt),
            id: task.id,
            repeatIndex: task.repeatIndex,
            stagePosition: task.stagePosition,
          })),
        }),
      }
    },
    records: async (groupId: string) => {
      const dispatchRows = await sql<
        {
          account: string
          deviceHost: string
          deviceId: string | null
          deviceName: string
          instanceIndex: number | null
          itemId: string
          itemStatus: string
          name: string
          parameters: Record<string, string>
          queuePriority: number
          repeatCount: number
          repeatIndex: number
          sequence: number
          skill: string
          stageName: string
          stagePosition: number
          stepStatus: string
          taskId: string
          taskStatus: string
          attempt: number
          autoRetry: boolean
          autoRetryLimit: number
          autoUsed: number
          refreshExternal: boolean
          replayActive: boolean
          replayOrigin: string
        }[]
      >`
        select i.id::text as "itemId", d.name, i.status as "itemStatus", coalesce(a.identifier, '') as account,
          i.instance_index as "instanceIndex",
          i.device_id::text as "deviceId", coalesce(dev.name, '') as "deviceName",
          coalesce(dev.host, '') as "deviceHost", s.sequence, s.skill,
          s.stage_position as "stagePosition", s.stage_name as "stageName",
          s.repeat_index as "repeatIndex", s.repeat_count as "repeatCount",
          coalesce(es.parameters, s.parameters) as parameters,
          coalesce(es.status, s.fill_status) as "stepStatus",
          coalesce(et.id::text, '') as "taskId",
          coalesce(et.status, '') as "taskStatus",
          coalesce(et.queue_priority, 0) as "queuePriority",
          coalesce(et.attempt, 1) as attempt,
          coalesce(et.auto_retry, false) as "autoRetry",
          coalesce(et.auto_retry_limit, 0) as "autoRetryLimit",
          coalesce(s.refresh_external, false) as "refreshExternal",
          coalesce((
            select count(*)::int from operation_stage_replay replay
            where replay.item_id = i.id
              and replay.stage_position = s.stage_position
              and replay.repeat_index = s.repeat_index
              and replay.origin = 'auto'
          ), 0) as "autoUsed",
          coalesce((
            select replay.origin from operation_stage_replay replay
            where replay.item_id = i.id
              and replay.stage_position = s.stage_position
              and replay.repeat_index = s.repeat_index
            order by replay.created_at desc, replay.id desc
            limit 1
          ), '') as "replayOrigin",
          exists (
            select 1 from execution_task active
            where active.dispatch_item_id = i.id
              and active.stage_position = s.stage_position
              and active.repeat_index = s.repeat_index
              and active.status in ('queued', 'dispatching', 'running', 'ood')
          ) as "replayActive"
        from operation_dispatch_item i
        join operation_dispatch d on d.id = i.dispatch_id
        left join operation_account a on a.id = i.account_id
        join operation_dispatch_step s on s.item_id = i.id
        left join device dev on dev.id = i.device_id
        left join lateral (
          select t.id, t.status, t.queue_priority, t.auto_retry, t.auto_retry_limit, t.created_at,
            row_number() over (order by t.created_at, t.id)::int as attempt
          from execution_task t
          where t.dispatch_item_id = i.id
            and t.stage_position = s.stage_position
            and t.repeat_index = s.repeat_index
        ) et on true
        left join execution_task_step es
          on es.task_id = et.id and es.sequence = s.sequence
        where d.group_id = ${groupId}::uuid
        order by dev.host, coalesce(a.identifier, ''), i.instance_index, i.id,
          s.stage_position, s.repeat_index, et.created_at, s.sequence`
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
          and t.dispatch_item_id is null
        order by dev.host, t.created_at, s.sequence`
      return { dispatchRows, legacy }
    },
  }
  return {
    ...repository,
    autoReplay: async (groupId: string, taskId: string) => {
      const gate = await sql<
        {
          autoRetry: boolean
          autoRetryLimit: number
          deviceId: string
          dispatchItemId: string | null
          requesterId: string | null
          status: string
          used: number
        }[]
      >`
        select t.status, t.auto_retry as "autoRetry", t.auto_retry_limit as "autoRetryLimit",
          t.dispatch_item_id::text as "dispatchItemId", t.device_id::text as "deviceId",
          d.requester_id::text as "requesterId",
          (
            select count(*)::int from operation_stage_replay replay
            where replay.item_id = t.dispatch_item_id
              and replay.stage_position = t.stage_position
              and replay.repeat_index = t.repeat_index
              and replay.origin = 'auto'
          ) as used
        from execution_task t
        left join operation_dispatch_item i on i.id = t.dispatch_item_id
        left join operation_dispatch d on d.id = i.dispatch_id
        where t.id = ${taskId}::uuid and t.group_id = ${groupId}::uuid`
      const row = gate[0]
      if (
        row === undefined ||
        row.status !== "failed" ||
        row.dispatchItemId === null ||
        row.requesterId === null ||
        !row.autoRetry ||
        row.used >= row.autoRetryLimit
      ) {
        return
      }
      const preview = await inspectReplay(sql, groupId, taskId, null)
      if (preview.kind !== "options") return
      const choices: ReplayChoice[] = preview.choices.flatMap((offer): ReplayChoice[] => {
        const redraw = offer.refresh === true
        const mode = redraw ? "redraw" : "keep"
        if (offer.kind === "proxy") {
          return offer.sequence === undefined
            ? [{ kind: "proxy", mode }]
            : [{ kind: "proxy", mode, sequence: offer.sequence }]
        }
        if (offer.kind === "text") return [{ kind: "text", mode, sequence: offer.sequence ?? 0 }]
        if (offer.kind === "file") {
          return [
            {
              kind: "file",
              mode,
              sequence: offer.sequence ?? 0,
              source: offer.source ?? "pool.video",
            },
          ]
        }
        return [
          {
            key: offer.key ?? "identifier",
            kind: "account",
            mode,
            sequence: offer.sequence ?? 0,
          },
        ]
      })
      const result = await repository.replay(groupId, row.requesterId, taskId, choices, "auto")
      if (result.kind === "created") {
        await sql`select pg_notify('agent_task', ${result.deviceId})`
        return
      }
      if (result.kind !== "replay_incomplete") return
      await sql`
        insert into operation_log (group_id, actor_id, device_id, level, text)
        values (
          ${groupId}::uuid, ${row.requesterId}::uuid, ${row.deviceId}::uuid, 'error',
          ${"自动重试未执行：同条件没有新的外部参数"}
        )`
    },
  }
}
