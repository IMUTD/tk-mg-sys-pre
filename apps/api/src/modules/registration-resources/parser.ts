import { z } from "zod"

export const RegistrationResourceKind = {
  ApiSms: "api-sms",
  GoogleEmail: "google-email",
  MicrosoftOauth: "microsoft-oauth",
  Pop3: "pop3",
} as const

export const RegistrationResourceKindSchema = z.enum([
  RegistrationResourceKind.GoogleEmail,
  RegistrationResourceKind.ApiSms,
  RegistrationResourceKind.MicrosoftOauth,
  RegistrationResourceKind.Pop3,
])

export type RegistrationResourceKind = z.infer<typeof RegistrationResourceKindSchema>

export type ParsedRegistrationRow = {
  readonly identifier: string
  readonly kind: RegistrationResourceKind
  readonly line: number
  readonly metadata: Readonly<Record<string, string>>
  readonly secret: string
}

export type InvalidRegistrationRow = {
  readonly line: number
  readonly raw: string
  readonly reason: string
}

export type RegistrationRowPreview = {
  readonly invalid: readonly InvalidRegistrationRow[]
  readonly valid: readonly ParsedRegistrationRow[]
}

const EmailSchema = z.string().email()
const PortSchema = z.coerce.number().int().min(1).max(65_535)

const unsupported = (line: number, raw: string): InvalidRegistrationRow => ({
  line,
  raw,
  reason: "unsupported resource format",
})

const asEmail = (value: string): string | null =>
  EmailSchema.safeParse(value).success ? value.toLowerCase() : null

const parseGoogleEmail = (
  fields: readonly string[],
  line: number,
  raw: string,
): ParsedRegistrationRow | InvalidRegistrationRow => {
  const email = fields[0]
  const password = fields[1]
  if (
    fields.length !== 2 ||
    email === undefined ||
    password === undefined ||
    password.length === 0
  ) {
    return unsupported(line, raw)
  }
  const normalizedEmail = asEmail(email)
  if (normalizedEmail === null) {
    return { line, raw, reason: "Google 邮箱格式无效" }
  }
  return {
    identifier: normalizedEmail,
    kind: RegistrationResourceKind.GoogleEmail,
    line,
    metadata: {},
    secret: password,
  }
}

const parseApiSms = (
  fields: readonly string[],
  line: number,
  raw: string,
): ParsedRegistrationRow | InvalidRegistrationRow => {
  const provider = fields[1]
  const token = fields[2]
  if (
    fields.length !== 3 ||
    provider === undefined ||
    token === undefined ||
    provider.length === 0 ||
    token.length === 0
  ) {
    return unsupported(line, raw)
  }
  return {
    identifier: provider,
    kind: RegistrationResourceKind.ApiSms,
    line,
    metadata: { provider },
    secret: token,
  }
}

const parseMicrosoftOauth = (
  fields: readonly string[],
  line: number,
  raw: string,
): ParsedRegistrationRow | InvalidRegistrationRow => {
  const email = fields[1]
  const clientId = fields[2]
  const refreshToken = fields[3]
  if (
    fields.length !== 4 ||
    email === undefined ||
    clientId === undefined ||
    refreshToken === undefined ||
    clientId.length === 0 ||
    refreshToken.length === 0
  ) {
    return unsupported(line, raw)
  }
  const normalizedEmail = asEmail(email)
  if (normalizedEmail === null) {
    return { line, raw, reason: "Microsoft OAuth 邮箱格式无效" }
  }
  return {
    identifier: normalizedEmail,
    kind: RegistrationResourceKind.MicrosoftOauth,
    line,
    metadata: { clientId },
    secret: refreshToken,
  }
}

const parsePop3 = (
  fields: readonly string[],
  line: number,
  raw: string,
): ParsedRegistrationRow | InvalidRegistrationRow => {
  const email = fields[1]
  const password = fields[2]
  const host = fields[3]
  const port = fields[4]
  if (
    fields.length !== 5 ||
    email === undefined ||
    password === undefined ||
    host === undefined ||
    port === undefined ||
    password.length === 0 ||
    host.length === 0
  ) {
    return unsupported(line, raw)
  }
  const normalizedEmail = asEmail(email)
  if (normalizedEmail === null) {
    return { line, raw, reason: "POP3 邮箱格式无效" }
  }
  const normalizedPort = PortSchema.safeParse(port)
  if (!normalizedPort.success) {
    return { line, raw, reason: "POP3 port must be between 1 and 65535" }
  }
  return {
    identifier: normalizedEmail,
    kind: RegistrationResourceKind.Pop3,
    line,
    metadata: { host, port: `${normalizedPort.data}` },
    secret: password,
  }
}

const parseRow = (line: number, raw: string): ParsedRegistrationRow | InvalidRegistrationRow => {
  const fields = raw.split("----").map((field) => field.trim())
  const format = fields[0] ?? ""
  switch (format) {
    case RegistrationResourceKind.ApiSms:
      return parseApiSms(fields, line, raw)
    case RegistrationResourceKind.MicrosoftOauth:
      return parseMicrosoftOauth(fields, line, raw)
    case RegistrationResourceKind.Pop3:
      return parsePop3(fields, line, raw)
    default:
      return parseGoogleEmail(fields, line, raw)
  }
}

const duplicateKey = (row: ParsedRegistrationRow): string =>
  `${row.kind}:${row.identifier}:${JSON.stringify(row.metadata)}`

export const parseRegistrationRows = (content: string): RegistrationRowPreview => {
  const invalid: InvalidRegistrationRow[] = []
  const valid: ParsedRegistrationRow[] = []
  const seen = new Set<string>()
  const rows = content.replaceAll("\r\n", "\n").split("\n")

  for (const [index, untrimmed] of rows.entries()) {
    const raw = untrimmed.trim()
    if (raw.length === 0) {
      continue
    }
    const parsed = parseRow(index + 1, raw)
    if ("reason" in parsed) {
      invalid.push(parsed)
      continue
    }
    const key = duplicateKey(parsed)
    if (seen.has(key)) {
      invalid.push({ line: parsed.line, raw, reason: "duplicate resource" })
      continue
    }
    seen.add(key)
    valid.push(parsed)
  }

  return { invalid, valid }
}
