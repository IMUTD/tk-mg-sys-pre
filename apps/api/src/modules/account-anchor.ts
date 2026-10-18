export const accountAnchorFields = [
  { label: "账号", source: "account.identifier" },
  { label: "密码", source: "account.secret" },
  { label: "地区", source: "account.region" },
  { label: "语言", source: "account.language" },
  { label: "代理地址", source: "proxy.host" },
  { label: "代理端口", source: "proxy.port" },
  { label: "代理账号", source: "proxy.username" },
  { label: "代理密码", source: "proxy.password" },
  { label: "V2链接", source: "proxy.link" },
  { label: "TUN模式", source: "proxy.tun" },
  { label: "强力安全模式", source: "proxy.safe" },
  { label: "盒子", source: "device.host" },
  { label: "坑位", source: "instance.index" },
  { label: "备份路径", source: "account.backup_key" },
  { label: "备份盒子", source: "account.backup_device" },
  { label: "文本池", source: "pool.text" },
  { label: "视频池", source: "pool.video" },
  { label: "视频盒子", source: "pool.video_host" },
  { label: "图片池", source: "pool.image" },
  { label: "图片盒子", source: "pool.image_host" },
  { label: "备份池", source: "pool.backup" },
  { label: "备份文件盒子", source: "pool.backup_host" },
] as const

const fieldSources = new Set<string>(accountAnchorFields.map((item) => item.source))

export const accountAnchorKeys = [
  { key: "id", label: "编号" },
  { key: "identifier", label: "账号" },
] as const

const anchorKeys = new Set<string>(accountAnchorKeys.map((item) => item.key))

export const accountAnchorCatalog = {
  anchors: [
    {
      fields: accountAnchorFields.map((item) => ({ label: item.label, source: item.source })),
      keys: accountAnchorKeys.map((item) => ({ key: item.key, label: item.label })),
      label: "账号表",
      table: "operation_account",
    },
  ],
} as const

export type AccountAnchorKey = (typeof accountAnchorKeys)[number]["key"]

export type ChainAnchor = { readonly key: AccountAnchorKey; readonly table: "operation_account" }

export const readAnchor = (raw: unknown): ChainAnchor | null | "invalid" => {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== "object" || Array.isArray(raw)) return "invalid"
  const { key, table } = raw as { key?: unknown; table?: unknown }
  if (table === "operation_account" && typeof key === "string" && anchorKeys.has(key)) {
    return { key: key as AccountAnchorKey, table: "operation_account" }
  }
  return "invalid"
}

export const readStepSources = (
  input: Readonly<Record<string, string>>,
  scopes: Readonly<Record<string, "external" | "internal">>,
  raw: unknown,
  anchor: ChainAnchor | null,
  skill: string,
): Record<string, string> | null => {
  if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw)))
    return null
  const given = (raw ?? {}) as Record<string, unknown>
  for (const key of Object.keys(given)) {
    if (!(key in input)) return null
  }
  const sources: Record<string, string> = {}
  for (const key of Object.keys(input)) {
    const declared = given[key]
    if (skill === "JumpNodes" && key === "steps") {
      if (scopes[key] === "external") return null
      if (declared !== undefined && declared !== "literal") return null
      sources[key] = "literal"
      continue
    }
    if (scopes[key] !== "external") {
      if (declared !== undefined && declared !== "literal") return null
      sources[key] = "literal"
      continue
    }
    if (anchor === null || typeof declared !== "string" || !fieldSources.has(declared)) return null
    sources[key] = declared
  }
  return sources
}
