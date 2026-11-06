const emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

export type NasCard = {
  readonly bucket: string
  readonly endpoint: string
  readonly id: string
  readonly loginUrl: string
  readonly name: string
  readonly password: string
  readonly prefix: string
  readonly username: string
}

export type NasAccess = {
  readonly accessKey: string
  readonly bucket: string
  readonly endpoint: string
  readonly secret: string
}

export const readNasCards = (payload: unknown): NasCard[] => {
  if (typeof payload !== "object" || payload === null || !("items" in payload)) return []
  const items = payload["items"]
  if (!Array.isArray(items)) return []
  return items.flatMap((item) => {
    if (typeof item !== "object" || item === null) return []
    const row = item as Partial<NasCard>
    if (
      typeof row.id !== "string" ||
      typeof row.loginUrl !== "string" ||
      typeof row.name !== "string" ||
      typeof row.password !== "string" ||
      typeof row.username !== "string"
    ) {
      return []
    }
    return [
      {
        bucket: typeof row.bucket === "string" ? row.bucket : "",
        endpoint: typeof row.endpoint === "string" ? row.endpoint : "",
        id: row.id,
        loginUrl: row.loginUrl,
        name: row.name,
        password: row.password,
        prefix: typeof row.prefix === "string" ? row.prefix : "",
        username: row.username,
      },
    ]
  })
}

const encodeRfc3986 = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

const hex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("")

const sha256Hex = async (value: string): Promise<string> =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))

const hmac = async (key: BufferSource, value: string): Promise<ArrayBuffer> => {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value))
}

const signingKey = async (secret: string, stamp: string): Promise<ArrayBuffer> => {
  const date = await hmac(new TextEncoder().encode(`AWS4${secret}`), stamp)
  const region = await hmac(date, "us-east-1")
  const service = await hmac(region, "s3")
  return hmac(service, "aws4_request")
}

export const signedNasRequest = async (
  config: NasAccess,
  method: string,
  query: Readonly<Record<string, string>>,
  key = "",
): Promise<Response> => {
  const endpoint = new URL(config.endpoint)
  const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "")
  const stamp = amz.slice(0, 8)
  const canonicalUri = `/${[config.bucket, ...key.split("/")].filter((part) => part.length > 0).map(encodeRfc3986).join("/")}`
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${encodeRfc3986(name)}=${encodeRfc3986(query[name] ?? "")}`)
    .join("&")
  const canonicalHeaders = `host:${endpoint.host}\nx-amz-content-sha256:${emptyHash}\nx-amz-date:${amz}\n`
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date"
  const canonical = `${method}\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${emptyHash}`
  const scope = `${stamp}/us-east-1/s3/aws4_request`
  const signature = hex(await hmac(await signingKey(config.secret, stamp), `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${await sha256Hex(canonical)}`))
  const url = `${endpoint.origin}${canonicalUri}${canonicalQuery.length === 0 ? "" : `?${canonicalQuery}`}`
  return fetch(url, {
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-content-sha256": emptyHash,
      "x-amz-date": amz,
    },
    method,
    targetAddressSpace: "local",
  } as RequestInit)
}

const loginAddress = (address: string): URL | null => {
  try {
    const url = new URL(address.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (url.hostname.length === 0) return null
    return url
  } catch {
    return null
  }
}

export const readNasPrefix = (payload: unknown): string => {
  if (typeof payload !== "object" || payload === null || !("prefix" in payload)) return ""
  const prefix = payload["prefix"]
  return typeof prefix === "string" ? prefix : ""
}

export const probeNasLogin = async (
  address: string,
  username: string,
  password: string,
  bucket: string,
  prefix: string,
): Promise<{ readonly endpoint: string; readonly message: string; readonly ok: boolean }> => {
  const url = loginAddress(address)
  const name = bucket.trim()
  if (
    url === null ||
    username.trim().length === 0 ||
    password.length === 0 ||
    !/^[a-z0-9-]{3,63}$/.test(name) ||
    prefix.length === 0 ||
    prefix.includes("..")
  ) {
    return { endpoint: "", message: "地址、用户名、密码、目录都要填", ok: false }
  }
  const endpoint = `${url.protocol}//${url.host}`
  try {
    const response = await signedNasRequest(
      { accessKey: username.trim(), bucket: name, endpoint, secret: password },
      "GET",
      { "list-type": "2", "max-keys": "1", prefix },
    )
    if (response.ok) return { endpoint, message: "已连通", ok: true }
  } catch {
    return { endpoint: "", message: "没有连通", ok: false }
  }
  return { endpoint: "", message: "没有连通", ok: false }
}
