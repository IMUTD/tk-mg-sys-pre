export type FillAccount = {
  readonly backupDevice: string
  readonly backupKey: string
  readonly identifier: string
  readonly language: string
  readonly region: string
  readonly secret: string
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
  readonly instance: { readonly index: string } | null
  readonly manualText: boolean
  readonly proxy: FillProxy | null
  readonly text: { readonly content: string; readonly resourceId: string } | null
  readonly video: string
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
    case "account.secret":
      return context.account.secret
    case "account.region":
      return context.account.region
    case "account.language":
      return context.account.language
    case "account.backup_key":
      return context.account.backupKey
    case "account.backup_device":
      return context.account.backupDevice
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
    case "device.host":
      return context.device?.host ?? ""
    case "instance.index":
      return context.instance?.index ?? ""
    case "pool.text":
      return context.text?.content ?? ""
    case "pool.video":
      return context.video
    default:
      return ""
  }
}

export const fillStep = (step: FillStep, context: FillContext): FilledStep => {
  const parameters: Record<string, string> = {}
  const missingKeys: string[] = []
  let textResourceId: string | null = null
  for (const key of Object.keys(step.input)) {
    const manual = step.skill === "SendText" && key === "text" && context.manualText
    if (step.scopes[key] !== "external") {
      parameters[key] = step.input[key] ?? ""
      continue
    }
    if (manual) {
      parameters[key] = context.text?.content ?? ""
      textResourceId = context.text?.resourceId ?? null
      if (parameters[key].length === 0) missingKeys.push(key)
      continue
    }
    parameters[key] = sourceValue(step.sources[key] ?? "", context)
    if (parameters[key].length === 0) missingKeys.push(key)
    if (step.sources[key] === "pool.text" && context.text !== null) textResourceId = context.text.resourceId
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

const shuffle = (items: readonly TextMaterial[], random: () => number): TextMaterial[] => {
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
  const filtered = mode === "tag" ? materials.filter((item) => item.category === tag) : [...materials]
  const ordered = mode === "random" ? shuffle(filtered, random) : [...filtered].sort(byAge)
  return Array.from({ length: count }, (_, index) => {
    const item = ordered.length === 0 ? undefined : ordered[index % ordered.length]
    return { content: item?.content ?? "", resourceId: item?.id ?? "" }
  })
}
