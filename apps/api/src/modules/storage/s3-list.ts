import { createHash, createHmac } from "node:crypto"

const emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

export type NasListItem = {
  readonly key: string
  readonly modified: string
  readonly size: number
}

export type NasListPage = {
  readonly bucket: string
  readonly buckets: readonly string[]
  readonly items: readonly NasListItem[]
  readonly nextToken: string | null
}

type Access = {
  readonly accessKey: string
  readonly bucket: string
  readonly endpoint: string
  readonly prefix: string
  readonly secret: string
  readonly token: string
}

const encodeRfc3986 = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

const hmac = (key: Buffer, value: string): Buffer => createHmac("sha256", key).update(value, "utf8").digest()

const signingKey = (secret: string, day: string): Buffer => {
  const date = hmac(Buffer.from(`AWS4${secret}`, "utf8"), day)
  const region = hmac(date, "us-east-1")
  const service = hmac(region, "s3")
  return hmac(service, "aws4_request")
}

const decodeXml = (value: string): string =>
  value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")

export const parseBucketNames = (xml: string): string[] =>
  [...xml.matchAll(/<Bucket>([\s\S]*?)<\/Bucket>/g)].flatMap((match) => {
    const name = decodeXml(match[1]?.match(/<Name>([^<]*)<\/Name>/)?.[1] ?? "")
    return name.length === 0 ? [] : [name]
  })

export const parseListObjects = (
  xml: string,
): { readonly items: NasListItem[]; readonly nextToken: string | null } => {
  const items = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].flatMap((match) => {
    const block = match[1] ?? ""
    const key = decodeXml(block.match(/<Key>([^<]*)<\/Key>/)?.[1] ?? "")
    if (key.length === 0) return []
    const size = Number(block.match(/<Size>([^<]*)<\/Size>/)?.[1] ?? "0")
    return [
      {
        key,
        modified: block.match(/<LastModified>([^<]*)<\/LastModified>/)?.[1] ?? "",
        size: Number.isFinite(size) ? size : 0,
      },
    ]
  })
  const truncated = xml.match(/<IsTruncated>([^<]*)<\/IsTruncated>/)?.[1] === "true"
  const nextToken = decodeXml(xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1] ?? "")
  return { items, nextToken: truncated && nextToken.length > 0 ? nextToken : null }
}

const signedGet = async (
  endpoint: string,
  accessKey: string,
  secret: string,
  bucket: string,
  query: Readonly<Record<string, string>>,
): Promise<string> => {
  const url = new URL(endpoint)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("NAS未配置")
  const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "")
  const day = amz.slice(0, 8)
  const canonicalUri = `/${bucket.length === 0 ? "" : encodeRfc3986(bucket)}`
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${encodeRfc3986(name)}=${encodeRfc3986(query[name] ?? "")}`)
    .join("&")
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${emptyHash}\nx-amz-date:${amz}\n`
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date"
  const canonical = `GET\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${emptyHash}`
  const scope = `${day}/us-east-1/s3/aws4_request`
  const signature = createHmac("sha256", signingKey(secret, day))
    .update(`AWS4-HMAC-SHA256\n${amz}\n${scope}\n${createHash("sha256").update(canonical, "utf8").digest("hex")}`, "utf8")
    .digest("hex")
  const target = `${url.origin}${canonicalUri}${canonicalQuery.length === 0 ? "" : `?${canonicalQuery}`}`
  let response: Response
  try {
    response = await fetch(target, {
      headers: {
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        "x-amz-content-sha256": emptyHash,
        "x-amz-date": amz,
      },
      method: "GET",
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new Error("NAS没有响应")
  }
  const text = await response.text()
  if (!response.ok) throw new Error(`NAS ${response.status}`)
  return text
}

export const listNasPage = async (access: Access): Promise<NasListPage> => {
  const query: Record<string, string> = { "list-type": "2", "max-keys": "1000" }
  if (access.prefix.length > 0) query["prefix"] = access.prefix
  if (access.token.length > 0) query["continuation-token"] = access.token
  const [listed, bucketXml] = await Promise.all([
    signedGet(access.endpoint, access.accessKey, access.secret, access.bucket, query),
    access.token.length === 0
      ? signedGet(access.endpoint, access.accessKey, access.secret, "", {}).catch(() => "")
      : Promise.resolve(""),
  ])
  const page = parseListObjects(listed)
  const names = parseBucketNames(bucketXml)
  return {
    bucket: access.bucket,
    buckets: names.length === 0 ? [access.bucket] : names,
    items: page.items,
    nextToken: page.nextToken,
  }
}
