import { languageParameter } from "./languages"
import { regionParameter, regionPoint } from "./regions"

export type FillAccount = {
  readonly backupName: string
  readonly clientId: string
  readonly email: string
  readonly identifier: string
  readonly language: string
  readonly region: string
  readonly secret: string
  readonly token: string
}

export type FillProxy = {
  readonly host: string
  readonly link: string
  readonly password: string
  readonly port: string
  readonly safe: string
  readonly tun: string
  readonly username: string
}

export type FillContext = {
  readonly account: FillAccount
  readonly device: { readonly host: string } | null
  readonly instance: { readonly index: string; readonly name: string } | null
  readonly manualText: boolean
  readonly proxy: FillProxy | null
  readonly language: string
  readonly region: string
  readonly chance: string
  readonly backup: string
  readonly backupFileHost: string
  readonly image: string
  readonly imageHost: string
  readonly imageId: string
  readonly videoId: string
  readonly text: { readonly content: string; readonly resourceId: string } | null
  readonly video: string
  readonly videoHost: string
}

export type FillStep = {
  readonly input: Readonly<Record<string, string>>
  readonly scopes: Readonly<Record<string, string>>
  readonly skill: string
  readonly sources: Readonly<Record<string, string>>
}

export type FilledStep = {
  readonly missingKeys: readonly string[]
  readonly parameters: Readonly<Record<string, string>>
  readonly textResourceId: string | null
}

export const resolveProxyLink = (ownExtra: string, acceleratorExtra: string): string =>
  ownExtra.length > 0 ? ownExtra : acceleratorExtra

const sourceValue = (source: string, context: FillContext): string => {
  switch (source) {
    case "account.identifier":
      return context.account.identifier
    case "account.email":
      return context.account.email.length > 0 ? context.account.email : context.account.identifier
    case "account.ms_client_id":
      return context.account.clientId
    case "account.ms_token":
      return context.account.token
    case "account.secret":
      return context.account.secret
    case "account.region":
      return context.account.region
    case "account.language":
      return context.account.language
    case "account.backup_name":
      return context.account.backupName
    case "proxy.host":
      return context.proxy?.host ?? ""
    case "proxy.port":
      return context.proxy?.port ?? ""
    case "proxy.username":
      return context.proxy?.username ?? ""
    case "proxy.password":
      return context.proxy?.password ?? ""
    case "proxy.link":
      return context.proxy?.link ?? ""
    case "proxy.tun":
      return context.proxy?.tun ?? ""
    case "proxy.safe":
      return context.proxy?.safe ?? ""
    case "media.image_id":
      return context.imageId
    case "media.video_id":
      return context.videoId
    case "chance.external":
      return context.chance
    default:
      return ""
  }
}

export const externalChanceSource = "chance.external"

export const usesExternalChance = (step: {
  readonly scopes: Readonly<Record<string, string>>
  readonly skill: string
  readonly sources: Readonly<Record<string, string>>
}): boolean =>
  step.skill === "ClickJumpNodes" &&
  step.scopes["clickChance"] === "external" &&
  step.sources["clickChance"] === externalChanceSource

export const externalTextSource = "pool.text"

const externalTextSkills = new Set(["SendText", "ClickNode", "ClickJumpNodes"])

export const usesExternalText = (step: {
  readonly scopes: Readonly<Record<string, string>>
  readonly skill: string
  readonly sources: Readonly<Record<string, string>>
}): boolean =>
  externalTextSkills.has(step.skill) &&
  step.scopes["text"] === "external" &&
  step.sources["text"] === externalTextSource

export const textAssignments = (
  steps: readonly {
    readonly localSequence?: number
    readonly scopes: Readonly<Record<string, string>>
    readonly skill: string
    readonly sources: Readonly<Record<string, string>>
    readonly stagePosition?: number
  }[],
  texts: readonly {
    readonly ids?: readonly string[]
    readonly sequence: number
    readonly stage?: number
  }[],
): "ok" | "text_required" | "text_not_allowed" => {
  const wanted = steps.flatMap((step, index) =>
    usesExternalText(step) ? [`${step.stagePosition ?? 0}:${step.localSequence ?? index}`] : [],
  )
  const given = texts.map((item) => `${item.stage ?? 0}:${item.sequence}`)
  if (new Set(given).size !== given.length) return "text_not_allowed"
  if (given.some((key) => !wanted.includes(key))) return "text_not_allowed"
  if (wanted.some((key) => !given.includes(key))) return "text_required"
  if (texts.some((item) => (item.ids ?? []).length === 0)) return "text_required"
  return "ok"
}

export const chanceAssignments = (
  steps: readonly {
    readonly localSequence?: number
    readonly scopes: Readonly<Record<string, string>>
    readonly skill: string
    readonly sources: Readonly<Record<string, string>>
    readonly stagePosition?: number
  }[],
  chances: readonly { readonly sequence: number; readonly stage: number; readonly value: number }[],
): "ok" | "chance_required" | "chance_not_allowed" => {
  const wanted = steps.flatMap((step, index) =>
    usesExternalChance(step) ? [`${step.stagePosition ?? 0}:${step.localSequence ?? index}`] : [],
  )
  const given = chances.map((item) => `${item.stage}:${item.sequence}`)
  if (new Set(given).size !== given.length) return "chance_not_allowed"
  if (given.some((key) => !wanted.includes(key))) return "chance_not_allowed"
  if (wanted.some((key) => !given.includes(key))) return "chance_required"
  return "ok"
}

export const refreshDeviceHosts = (
  parameters: Readonly<Record<string, string>>,
  sources: unknown,
  hosts: { readonly backupHost: string; readonly deviceHost: string },
): { readonly changed: boolean; readonly parameters: Record<string, string> } => {
  const sourceMap =
    sources !== null && typeof sources === "object" && !Array.isArray(sources)
      ? Object.entries(sources).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        )
      : []
  const next = { ...parameters }
  let changed = false
  for (const [key, source] of sourceMap) {
    if (!(key in next)) continue
    const host = source === "device.host" ? hosts.deviceHost : ""
    if (host.length === 0 || next[key] === host) continue
    next[key] = host
    changed = true
  }
  return { changed, parameters: next }
}

export const agentStepParameters = (
  skill: string,
  parameters: Readonly<Record<string, string>>,
): Record<string, string> => {
  if (skill !== "FetchMailCode") return { ...parameters }
  const next = { ...parameters }
  delete next["email"]
  delete next["clientId"]
  delete next["refreshToken"]
  return next
}

export const relaxMailPair = <
  T extends { readonly missingKeys: readonly string[]; readonly skill: string },
>(
  steps: readonly T[],
): T[] =>
  steps.map((step, index) => {
    if (step.skill !== "SendText" || steps[index - 1]?.skill !== "FetchMailCode") return step
    return { ...step, missingKeys: step.missingKeys.filter((key) => key !== "text") }
  })

export const fillStep = (step: FillStep, context: FillContext): FilledStep => {
  const parameters: Record<string, string> = {}
  const missingKeys: string[] = []
  let textResourceId: string | null = null
  for (const key of Object.keys(step.input)) {
    if (regionParameter(step.skill) === key && context.region.length > 0) {
      parameters[key] = context.region
      continue
    }
    if (languageParameter(step.skill) === key && context.language.length > 0) {
      parameters[key] = context.language
      continue
    }
    if (step.scopes[key] !== "external") {
      parameters[key] = step.input[key] ?? ""
      continue
    }
    if (key === "text" && usesExternalText(step)) {
      parameters[key] = context.text?.content ?? ""
      textResourceId = context.text?.resourceId ?? null
      if (parameters[key].length === 0) missingKeys.push(key)
      continue
    }
    parameters[key] = sourceValue(step.sources[key] ?? "", context)
    if (parameters[key].length === 0) missingKeys.push(key)
  }
  const point =
    step.skill === "CreateAndroid" || step.skill === "ResetAndroidContainer"
      ? regionPoint(context.region)
      : null
  if (
    point !== null &&
    (parameters["latitude"] ?? "").trim().length === 0 &&
    (parameters["longitude"] ?? "").trim().length === 0
  ) {
    parameters["latitude"] = point.latitude
    parameters["longitude"] = point.longitude
    return {
      missingKeys: missingKeys.filter((key) => key !== "latitude" && key !== "longitude"),
      parameters,
      textResourceId,
    }
  }
  return { missingKeys, parameters, textResourceId }
}

export type TextMaterial = {
  readonly category: string
  readonly content: string
  readonly createdAt: string
  readonly id: string
}

const byAge = (left: TextMaterial, right: TextMaterial): number =>
  left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)

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

export const drawTexts = (
  materials: readonly TextMaterial[],
  mode: "random" | "sequence" | "tag",
  tag: string | undefined,
  count: number,
  random: () => number = Math.random,
): { readonly content: string; readonly resourceId: string }[] => {
  const filtered =
    mode === "tag" ? materials.filter((item) => item.category === tag) : [...materials]
  const ordered = mode === "random" ? shuffle(filtered, random) : [...filtered].sort(byAge)
  return cycleDraw(ordered, count).map((item) => ({
    content: item?.content ?? "",
    resourceId: item?.id ?? "",
  }))
}

const cycleDraw = <T>(ordered: readonly T[], count: number): (T | undefined)[] =>
  Array.from({ length: count }, (_, index) =>
    ordered.length === 0 ? undefined : ordered[index % ordered.length],
  )

export type ShareDrawFile = {
  readonly deviceId: string
  readonly host: string
  readonly parent: string
  readonly path: string
  readonly pool: "backup" | "image" | "video"
}

export const drawMediaIds = (
  files: readonly { readonly host: string; readonly id: string; readonly path: string }[],
  mode: "random" | "sequence",
  count: number,
  random: () => number = Math.random,
): string[] => {
  const ordered =
    mode === "random"
      ? shuffle(files, random)
      : [...files].sort(
          (left, right) =>
            left.host.localeCompare(right.host) || left.path.localeCompare(right.path),
        )
  return cycleDraw(ordered, count).map((item) => item?.id ?? "")
}

export const drawShareFiles = (
  files: readonly ShareDrawFile[],
  deviceId: string,
  directory: string,
  pool: ShareDrawFile["pool"],
  mode: "random" | "sequence",
  count: number,
  random: () => number = Math.random,
): { readonly host: string; readonly path: string }[] => {
  const matched = files.filter(
    (item) => item.deviceId === deviceId && item.parent === directory && item.pool === pool,
  )
  const ordered =
    mode === "random"
      ? shuffle(matched, random)
      : [...matched].sort(
          (left, right) =>
            left.path.localeCompare(right.path) || left.host.localeCompare(right.host),
        )
  return cycleDraw(ordered, count).map((item) => ({
    host: item?.host ?? "",
    path: item?.path ?? "",
  }))
}
