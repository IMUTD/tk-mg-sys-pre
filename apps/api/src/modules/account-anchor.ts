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
  { label: "备份名字", source: "account.backup_name" },
  { label: "邮箱", source: "account.email" },
  { label: "客户端ID", source: "account.ms_client_id" },
  { label: "令牌TOKEN", source: "account.ms_token" },
  { label: "视频ID", source: "media.video_id" },
  { label: "图片ID", source: "media.image_id" },
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
    if (
      ((skill === "JumpNodes" || skill === "ClickJumpNodes" || skill === "CheckLive") &&
        (key === "steps" || key === "jumpWhen")) ||
      ((skill === "JumpNodes" || skill === "ClickJumpNodes") &&
        (key === "tagOnSuccess" ||
          key === "tagOnFailure" ||
          key === "writeOnSuccessField" ||
          key === "writeOnSuccessValue" ||
          key === "writeOnFailureField" ||
          key === "writeOnFailureValue"))
    ) {
      if (scopes[key] === "external") return null
      if (declared !== undefined && declared !== "literal") return null
      sources[key] = "literal"
      continue
    }
    if (skill === "ClickJumpNodes" && key === "clickChance") {
      if (scopes[key] !== "external") {
        if (declared !== undefined && declared !== "literal") return null
        sources[key] = "literal"
        continue
      }
      if (declared !== "chance.external") return null
      sources[key] = "chance.external"
      continue
    }
    if (
      (skill === "SendText" || skill === "ClickNode" || skill === "ClickJumpNodes") &&
      key === "text" &&
      scopes[key] === "external" &&
      declared === "pool.text"
    ) {
      sources[key] = "pool.text"
      continue
    }
    if (scopes[key] !== "external") {
      if (declared !== undefined && declared !== "literal") return null
      sources[key] = "literal"
      continue
    }
    if (declared === undefined || declared === "") {
      sources[key] = ""
      continue
    }
    if (typeof declared !== "string" || !fieldSources.has(declared)) return null
    sources[key] = declared
  }
  return sources
}
