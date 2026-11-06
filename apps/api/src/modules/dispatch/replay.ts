import { dirNameOk } from "../storage/nas-place"
import { takeBalanced } from "./allocate"
import type { FillProxy, ShareDrawFile, TextMaterial } from "./fill"
import { languageParameter } from "./languages"
import { regionParameter } from "./regions"
import type { FileChoice, NamedSet, TextChoice } from "./repository"

export type ReplayMode = "keep" | "redraw"

export type ReplayChoice =
  | { readonly kind: "proxy"; readonly mode: ReplayMode; readonly sequence?: number }
  | { readonly kind: "text"; readonly mode: ReplayMode; readonly sequence: number }
  | {
      readonly kind: "file"
      readonly mode: ReplayMode
      readonly sequence: number
      readonly source: "pool.backup" | "pool.image" | "pool.video"
    }
  | {
      readonly key: "backup_key" | "backup_name" | "identifier" | "language" | "region" | "secret"
      readonly kind: "account"
      readonly mode: ReplayMode
      readonly sequence: number
    }

export type ReplayOffer = {
  readonly current: string
  readonly key?: ReplayAccountKey
  readonly kind: ReplayChoice["kind"]
  readonly label: string
  readonly refresh?: boolean
  readonly sequence?: number
  readonly source?: "pool.backup" | "pool.image" | "pool.video"
}

type ReplayAccountKey =
  | "backup_key"
  | "backup_name"
  | "identifier"
  | "language"
  | "region"
  | "secret"

export type ReplayMediaChoice = {
  readonly directories:
    | readonly { readonly deviceId: string; readonly directory: string }[]
    | readonly string[]
  readonly draw?: "random" | "sequence"
  readonly ids?: readonly string[]
  readonly kind: "image" | "video"
  readonly limit: number
  readonly mode: "and" | "or" | "nand" | "random" | "sequence"
  readonly nasDirectories?: readonly string[]
  readonly nasId?: string
  readonly sequence: number
  readonly stage: number
}

export type ReplaySelection = {
  readonly files: readonly FileChoice[]
  readonly language: string
  readonly media?: readonly ReplayMediaChoice[]
  readonly proxies: NamedSet | null
  readonly proxyIds: readonly string[]
  readonly proxyTag: string | null
  readonly region: string
  readonly texts: readonly TextChoice[]
}

export type ReplayStep = {
  readonly parameters: Record<string, string>
  readonly scopes: Readonly<Record<string, string>>
  readonly sequence: number
  readonly skill: string
  readonly sources: Readonly<Record<string, string>>
  readonly textResourceId: string | null
}

export type ReplayProxy = FillProxy & { readonly id: string; readonly name: string }

export type ReplayDraws = {
  readonly account: Readonly<Record<ReplayAccountKey, string>>
  readonly files: ReadonlyMap<string, { readonly host: string; readonly path: string }>
  readonly proxy: ReplayProxy | null
  readonly stepProxies: ReadonlyMap<number, ReplayProxy>
  readonly texts: ReadonlyMap<number, { readonly content: string; readonly resourceId: string }>
}

const proxySources = new Set([
  "proxy.host",
  "proxy.port",
  "proxy.username",
  "proxy.password",
  "proxy.link",
  "proxy.tun",
  "proxy.safe",
])

const hiddenSources = new Set([
  "device.host",
  "account.backup_device",
  "instance.index",
  "instance.name",
])

const accountSources: Readonly<Record<string, ReplayAccountKey>> = {
  "account.backup_key": "backup_key",
  "account.backup_name": "backup_name",
  "account.identifier": "identifier",
  "account.language": "language",
  "account.region": "region",
  "account.secret": "secret",
}

const accountLabels: Readonly<Record<ReplayAccountKey, string>> = {
  backup_key: "备份密钥",
  backup_name: "备份名字",
  identifier: "账号",
  language: "账号语言",
  region: "账号地区",
  secret: "密码",
}

const fileHost: Readonly<Record<"pool.backup" | "pool.image" | "pool.video", string>> = {
  "pool.backup": "pool.backup_host",
  "pool.image": "pool.image_host",
  "pool.video": "pool.video_host",
}

const proxyField = (source: string): keyof FillProxy | null => {
  if (source === "proxy.host") return "host"
  if (source === "proxy.port") return "port"
  if (source === "proxy.username") return "username"
  if (source === "proxy.password") return "password"
  if (source === "proxy.link") return "link"
  if (source === "proxy.tun") return "tun"
  if (source === "proxy.safe") return "safe"
  return null
}

export const externalProxyEntries = (step: {
  readonly scopes: Readonly<Record<string, string>>
  readonly sources: Readonly<Record<string, string>>
}): readonly [string, string][] =>
  Object.entries(step.sources).filter(
    ([key, source]) => step.scopes[key] === "external" && proxySources.has(source),
  )

export const isIndependentProxyStep = (step: {
  readonly scopes: Readonly<Record<string, string>>
  readonly skill: string
  readonly sources: Readonly<Record<string, string>>
}): boolean => step.skill === "IndependentV5S5" && externalProxyEntries(step).length > 0

export const choiceKey = (choice: ReplayChoice | ReplayOffer): string => {
  if (choice.kind === "proxy")
    return choice.sequence === undefined ? "proxy" : `proxy:${choice.sequence}`
  if (choice.kind === "text") return `text:${choice.sequence ?? -1}`
  if (choice.kind === "file") return `file:${choice.sequence ?? -1}:${choice.source ?? ""}`
  return `account:${choice.sequence ?? -1}:${choice.key ?? ""}`
}

const covered = (step: ReplayStep, key: string, selection: ReplaySelection): boolean =>
  (selection.region.length > 0 && regionParameter(step.skill) === key) ||
  (selection.language.length > 0 && languageParameter(step.skill) === key)

const stepTitle = (sequence: number, name: string): string => `第 ${sequence + 1} 步${name}`

const uncoveredProxy = (
  step: ReplayStep,
  selection: ReplaySelection,
): readonly [string, string][] =>
  externalProxyEntries(step).filter(([key]) => !covered(step, key, selection))

const proxyCurrentOf = (step: ReplayStep): string => {
  const link = Object.entries(step.sources).find(([, source]) => source === "proxy.link")
  if (link !== undefined) return step.parameters[link[0]] ?? ""
  const hostKey = Object.entries(step.sources).find(([, source]) => source === "proxy.host")?.[0]
  const portKey = Object.entries(step.sources).find(([, source]) => source === "proxy.port")?.[0]
  const host = hostKey === undefined ? "" : (step.parameters[hostKey] ?? "")
  const port = portKey === undefined ? "" : (step.parameters[portKey] ?? "")
  return host.length > 0 && port.length > 0 ? `${host}:${port}` : host || port
}

export const replayOffers = (
  steps: readonly ReplayStep[],
  selection: ReplaySelection,
  proxyCurrent: string,
  refreshOf: ReadonlyMap<number, boolean> = new Map(),
  refreshDraw = false,
): ReplayOffer[] => {
  const offers: ReplayOffer[] = []
  const owned = new Set(
    steps
      .filter((step) => uncoveredProxy(step, selection).length > 0 && isIndependentProxyStep(step))
      .map((step) => step.sequence),
  )
  const proxy = steps.some(
    (step) => !owned.has(step.sequence) && uncoveredProxy(step, selection).length > 0,
  )
  if (proxy)
    offers.push({ current: proxyCurrent, kind: "proxy", label: "代理", refresh: refreshDraw })
  for (const step of steps) {
    if (!owned.has(step.sequence)) continue
    offers.push({
      current: proxyCurrentOf(step),
      kind: "proxy",
      label: "V2+S5 外部参数",
      refresh: refreshDraw || refreshOf.get(step.sequence) === true,
      sequence: step.sequence,
    })
  }
  if (refreshDraw) {
    for (const step of steps) {
      if (Object.values(step.sources).includes("pool.text")) {
        offers.push({
          current: step.parameters["text"] ?? "",
          kind: "text",
          label: stepTitle(step.sequence, "文本"),
          refresh: true,
          sequence: step.sequence,
        })
      }
      const sources = Object.values(step.sources)
      for (const source of ["pool.image", "pool.video"] as const) {
        const mediaSource = source === "pool.image" ? "media.image_id" : "media.video_id"
        if (!sources.includes(source) && !sources.includes(mediaSource)) continue
        const key = source === "pool.image" ? "图片ID" : "视频ID"
        offers.push({
          current: step.parameters[key] ?? "",
          kind: "file",
          label: stepTitle(step.sequence, source === "pool.image" ? "图片" : "视频"),
          refresh: true,
          sequence: step.sequence,
          source,
        })
      }
    }
  }
  for (const step of steps) {
    for (const [key, source] of Object.entries(step.sources)) {
      const account = accountSources[source]
      if (
        account === undefined ||
        step.scopes[key] !== "external" ||
        hiddenSources.has(source) ||
        covered(step, key, selection)
      ) {
        continue
      }
      offers.push({
        current:
          account === "secret" || account === "backup_key"
            ? "已保存"
            : (step.parameters[key] ?? ""),
        key: account,
        kind: "account",
        label: stepTitle(step.sequence, accountLabels[account]),
        sequence: step.sequence,
      })
    }
  }
  return offers
}

export const choicesMatch = (
  offers: readonly ReplayOffer[],
  choices: readonly ReplayChoice[],
): boolean => {
  const wanted = offers.map(choiceKey)
  const given = choices.map(choiceKey)
  if (new Set(given).size !== given.length || wanted.length !== given.length) return false
  const keys = new Set(given)
  return wanted.every((key) => keys.has(key))
}

export const redrawProxy = <T extends { readonly id: string }>(
  candidates: readonly T[],
  currentId: string | null,
): T | null => {
  const counts = new Map<string, number>()
  if (currentId !== null) counts.set(currentId, 1)
  return takeBalanced(candidates, counts)
}

const shuffle = <T>(items: readonly T[], random: () => number): T[] => {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    const current = copy[index]
    const other = copy[swap]
    if (current === undefined || other === undefined) continue
    copy[index] = other
    copy[swap] = current
  }
  return copy
}

export const redrawText = (
  materials: readonly TextMaterial[],
  mode: TextChoice["mode"],
  tag: string | undefined,
  currentId: string,
  random: () => number = Math.random,
): { readonly content: string; readonly resourceId: string } | null => {
  const filtered =
    mode === "tag" ? materials.filter((item) => item.category === tag) : [...materials]
  if (filtered.length === 0) return null
  if (mode === "random") {
    const shuffled = shuffle(filtered, random)
    const pool = shuffled.length > 1 ? shuffled.filter((item) => item.id !== currentId) : shuffled
    const picked = pool[0]
    return picked === undefined ? null : { content: picked.content, resourceId: picked.id }
  }
  const ordered = [...filtered].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  )
  const index = ordered.findIndex((item) => item.id === currentId)
  const picked = ordered[(index < 0 ? 0 : index + 1) % ordered.length]
  return picked === undefined ? null : { content: picked.content, resourceId: picked.id }
}

export const redrawMediaId = (
  files: readonly { readonly host: string; readonly id: string; readonly path: string }[],
  mode: "random" | "sequence",
  currentId: string,
  random: () => number = Math.random,
): string | null => {
  if (files.length === 0) return null
  if (mode === "random") {
    const pool = files.length > 1 ? files.filter((item) => item.id !== currentId) : [...files]
    return shuffle(pool, random)[0]?.id ?? null
  }
  const ordered = [...files].sort(
    (left, right) =>
      left.host.localeCompare(right.host) ||
      left.path.localeCompare(right.path) ||
      left.id.localeCompare(right.id),
  )
  const index = ordered.findIndex((item) => item.id === currentId)
  return ordered[(index < 0 ? 0 : index + 1) % ordered.length]?.id ?? null
}

export const redrawFile = (
  files: readonly ShareDrawFile[],
  choice: FileChoice,
  currentPath: string,
  random: () => number = Math.random,
): { readonly host: string; readonly path: string } | null => {
  const matched = files.filter(
    (item) =>
      item.deviceId === choice.deviceId &&
      item.parent === choice.directory &&
      item.pool === filePool(choice.source),
  )
  if (matched.length === 0) return null
  if (choice.mode === "random") {
    const shuffled = shuffle(matched, random)
    const pool =
      shuffled.length > 1 ? shuffled.filter((item) => item.path !== currentPath) : shuffled
    const picked = pool[0]
    return picked === undefined ? null : { host: picked.host, path: picked.path }
  }
  const ordered = [...matched].sort(
    (left, right) => left.path.localeCompare(right.path) || left.host.localeCompare(right.host),
  )
  const index = ordered.findIndex((item) => item.path === currentPath)
  const picked = ordered[(index < 0 ? 0 : index + 1) % ordered.length]
  return picked === undefined ? null : { host: picked.host, path: picked.path }
}

const filePool = (source: FileChoice["source"]): ShareDrawFile["pool"] => {
  if (source === "pool.backup") return "backup"
  if (source === "pool.image") return "image"
  return "video"
}

const choiceFor = <T extends ReplayChoice>(
  choices: readonly ReplayChoice[],
  key: string,
): T | undefined => choices.find((choice) => choiceKey(choice) === key) as T | undefined

export const applyReplayChoices = (
  steps: readonly ReplayStep[],
  choices: readonly ReplayChoice[],
  draws: ReplayDraws,
): {
  readonly missing: readonly { readonly keys: readonly string[]; readonly sequence: number }[]
  readonly proxyId: string | null
  readonly steps: readonly {
    readonly parameters: Record<string, string>
    readonly sequence: number
    readonly textResourceId: string | null
  }[]
} => {
  const missing: { keys: string[]; sequence: number }[] = []
  const note = (sequence: number, key: string): void => {
    const row = missing.find((item) => item.sequence === sequence)
    if (row === undefined) missing.push({ keys: [key], sequence })
    else row.keys.push(key)
  }
  const next = steps.map((step) => ({
    parameters: { ...step.parameters },
    sequence: step.sequence,
    textResourceId: step.textResourceId,
  }))
  const bySequence = new Map(next.map((step) => [step.sequence, step]))
  const owned = new Set(
    steps.filter((step) => isIndependentProxyStep(step)).map((step) => step.sequence),
  )
  const writeProxy = (
    step: ReplayStep,
    written: { parameters: Record<string, string> },
    proxy: ReplayProxy | null,
  ): void => {
    for (const [key, source] of Object.entries(step.sources)) {
      const field = proxyField(source)
      if (step.scopes[key] !== "external" || field === null) continue
      const value = proxy?.[field] ?? ""
      written.parameters[key] = value
      if (value.length === 0) note(step.sequence, key)
    }
  }
  const proxyChoice = choiceFor<Extract<ReplayChoice, { kind: "proxy" }>>(choices, "proxy")
  if (proxyChoice?.mode === "redraw") {
    for (const step of steps) {
      if (owned.has(step.sequence)) continue
      const written = bySequence.get(step.sequence)
      if (written === undefined) continue
      writeProxy(step, written, draws.proxy)
    }
  }
  const sequenced = choices
    .filter(
      (choice): choice is Extract<ReplayChoice, { kind: "proxy" }> =>
        choice.kind === "proxy" && choice.mode === "redraw" && choice.sequence !== undefined,
    )
    .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))
  for (const choice of sequenced) {
    const step = steps.find((item) => item.sequence === choice.sequence)
    const written = step === undefined ? undefined : bySequence.get(step.sequence)
    if (step === undefined || written === undefined || choice.sequence === undefined) continue
    writeProxy(step, written, draws.stepProxies.get(choice.sequence) ?? null)
  }
  for (const step of steps) {
    const written = bySequence.get(step.sequence)
    if (written === undefined) continue
    const text = choiceFor<Extract<ReplayChoice, { kind: "text" }>>(
      choices,
      `text:${step.sequence}`,
    )
    if (text?.mode === "redraw") {
      const drawn = draws.texts.get(step.sequence)
      for (const [key, source] of Object.entries(step.sources)) {
        if (step.scopes[key] !== "external" || source !== "pool.text") continue
        written.parameters[key] = drawn?.content ?? ""
        if ((drawn?.content ?? "").length === 0) note(step.sequence, key)
      }
      written.textResourceId = drawn?.resourceId ?? null
    }
    for (const source of ["pool.video", "pool.image", "pool.backup"] as const) {
      const file = choiceFor<Extract<ReplayChoice, { kind: "file" }>>(
        choices,
        `file:${step.sequence}:${source}`,
      )
      if (file?.mode !== "redraw") continue
      const drawn = draws.files.get(`${step.sequence}:${source}`)
      for (const [key, value] of Object.entries(step.sources)) {
        if (step.scopes[key] !== "external") continue
        if (value === source) {
          written.parameters[key] = drawn?.path ?? ""
          if ((drawn?.path ?? "").length === 0) note(step.sequence, key)
        }
        if (value === fileHost[source]) {
          written.parameters[key] = drawn?.host ?? ""
          if ((drawn?.host ?? "").length === 0) note(step.sequence, key)
        }
      }
    }
    for (const [key, source] of Object.entries(step.sources)) {
      const account = accountSources[source]
      if (account === undefined || step.scopes[key] !== "external") continue
      const picked = choiceFor<Extract<ReplayChoice, { kind: "account" }>>(
        choices,
        `account:${step.sequence}:${account}`,
      )
      if (picked?.mode !== "redraw") continue
      const value = draws.account[account]
      written.parameters[key] = value
      if (value.length === 0) note(step.sequence, key)
    }
  }
  const stepProxyId = sequenced
    .map((choice) =>
      choice.sequence === undefined ? null : (draws.stepProxies.get(choice.sequence)?.id ?? null),
    )
    .find((id) => id !== null)
  return {
    missing,
    proxyId: stepProxyId ?? (proxyChoice?.mode === "redraw" ? (draws.proxy?.id ?? null) : null),
    steps: next,
  }
}

const asString = (value: unknown): string => (typeof value === "string" ? value : "")

const namedBy = (value: unknown): NamedSet["by"] | null =>
  value === "group" || value === "remark" || value === "tag" ? value : null

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

export const readReplaySelection = (value: unknown): ReplaySelection | null => {
  const record = asRecord(value)
  if (record === null) return null
  const proxies = asRecord(record["proxies"])
  const proxyBy = namedBy(proxies?.["by"])
  const proxyName = proxies?.["name"]
  const proxySet: NamedSet | null =
    proxyBy !== null && typeof proxyName === "string" ? { by: proxyBy, name: proxyName } : null
  const texts = Array.isArray(record["texts"])
    ? record["texts"].flatMap((item): TextChoice[] => {
        const row = asRecord(item)
        if (row === null) return []
        const mode = row["mode"]
        const sequence = row["sequence"]
        const known =
          mode === "and" ||
          mode === "or" ||
          mode === "nand" ||
          mode === "random" ||
          mode === "sequence" ||
          mode === "tag"
        if (!known || typeof sequence !== "number") return []
        const ids = Array.isArray(row["ids"])
          ? row["ids"].filter((item): item is string => typeof item === "string")
          : []
        const tags = Array.isArray(row["tags"])
          ? row["tags"].filter((item): item is string => typeof item === "string")
          : []
        const tag = typeof row["tag"] === "string" ? row["tag"] : undefined
        const stage = typeof row["stage"] === "number" ? row["stage"] : undefined
        const keyword = typeof row["keyword"] === "string" ? row["keyword"] : ""
        return [
          {
            ids,
            keyword,
            mode,
            sequence,
            tags,
            ...(stage === undefined ? {} : { stage }),
            ...(tag === undefined ? {} : { tag }),
          },
        ]
      })
    : []
  const files = Array.isArray(record["files"])
    ? record["files"].flatMap((item): FileChoice[] => {
        const row = asRecord(item)
        if (row === null) return []
        const source = row["source"]
        const mode = row["mode"]
        if (
          (source !== "pool.video" && source !== "pool.image" && source !== "pool.backup") ||
          (mode !== "random" && mode !== "sequence") ||
          typeof row["deviceId"] !== "string" ||
          typeof row["directory"] !== "string" ||
          typeof row["sequence"] !== "number"
        ) {
          return []
        }
        const stage = typeof row["stage"] === "number" ? row["stage"] : undefined
        return [
          {
            deviceId: row["deviceId"],
            directory: row["directory"],
            mode,
            sequence: row["sequence"],
            source,
            ...(stage === undefined ? {} : { stage }),
          },
        ]
      })
    : []
  const media = Array.isArray(record["media"])
    ? record["media"].flatMap((item): ReplayMediaChoice[] => {
        const row = asRecord(item)
        if (row === null) return []
        const kind = row["kind"]
        const mode = row["mode"]
        const known =
          mode === "and" ||
          mode === "or" ||
          mode === "nand" ||
          mode === "random" ||
          mode === "sequence"
        if (
          (kind !== "image" && kind !== "video") ||
          !known ||
          typeof row["sequence"] !== "number" ||
          typeof row["stage"] !== "number" ||
          typeof row["limit"] !== "number" ||
          !Array.isArray(row["directories"])
        ) {
          return []
        }
        const ids = Array.isArray(row["ids"])
          ? row["ids"].filter((item): item is string => typeof item === "string")
          : []
        const names = row["directories"].filter((item): item is string => typeof item === "string")
        const directories =
          names.length > 0
            ? names
            : row["directories"].flatMap((dir): { deviceId: string; directory: string }[] => {
                const entry = asRecord(dir)
                if (
                  entry === null ||
                  typeof entry["deviceId"] !== "string" ||
                  typeof entry["directory"] !== "string"
                ) {
                  return []
                }
                return [{ deviceId: entry["deviceId"], directory: entry["directory"] }]
              })
        const nasId = typeof row["nasId"] === "string" ? row["nasId"] : ""
        const nasDirectories = Array.isArray(row["nasDirectories"])
          ? [
              ...new Set(
                row["nasDirectories"].filter(
                  (item): item is string => typeof item === "string" && dirNameOk(item),
                ),
              ),
            ]
          : []
        const draw =
          row["draw"] === "random" || row["draw"] === "sequence"
            ? row["draw"]
            : mode === "random"
              ? "random"
              : "sequence"
        if (ids.length === 0 && directories.length === 0 && nasId.length === 0) return []
        return [
          {
            directories,
            draw,
            ids,
            kind,
            limit: row["limit"],
            mode,
            sequence: row["sequence"],
            stage: row["stage"],
            ...(nasId.length > 0 ? { nasDirectories, nasId } : {}),
          },
        ]
      })
    : []
  return {
    files,
    language: asString(record["language"]),
    media,
    proxies: proxySet,
    proxyIds: Array.isArray(record["proxyIds"])
      ? record["proxyIds"].filter((item): item is string => typeof item === "string")
      : [],
    proxyTag: typeof record["proxyTag"] === "string" ? record["proxyTag"] : null,
    region: asString(record["region"]),
    texts,
  }
}
