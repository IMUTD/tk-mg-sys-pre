import { z } from "zod"
import { IdentityError, statuses } from "./types"
import { MaxRequestBytes } from "./upload"

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  status: z.enum(statuses).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})
export const requireSameOrigin = (request: Request): void => {
  const origin = request.headers.get("origin")
  const url = new URL(request.url)
  const forwardedProtocol = request.headers.get("x-forwarded-proto")
  const protocol =
    forwardedProtocol === "https" || forwardedProtocol === "http"
      ? forwardedProtocol
      : url.protocol.slice(0, -1)
  // The deployment proxy overwrites Host and X-Forwarded-Proto; never trust X-Forwarded-Host.
  const expected = `${protocol}://${request.headers.get("host") ?? url.host}`
  if (origin !== expected || request.headers.get("sec-fetch-site") === "cross-site")
    throw new IdentityError("forbidden", 403)
}
export const readBoundedBody = async (request: Request): Promise<Uint8Array> => {
  const length = request.headers.get("content-length")
  if (length && Number(length) > MaxRequestBytes) throw new IdentityError("image_too_large", 413)
  if (!request.body) throw new IdentityError("invalid_request", 400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      total += chunk.value.byteLength
      if (total > MaxRequestBytes) {
        await reader.cancel()
        throw new IdentityError("image_too_large", 413)
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
export const readIdentityMultipart = async (request: Request) => {
  const contentType = request.headers.get("content-type")
  if (!contentType?.startsWith("multipart/form-data;"))
    throw new IdentityError("invalid_request", 400)
  const bytes = await readBoundedBody(request)
  const form = await new Response(bytes, { headers: { "content-type": contentType } }).formData()
  const keys = [...form.keys()]
  if (
    keys.length !== 3 ||
    keys.some((key) => !["frontImage", "consentVersion", "consentAccepted"].includes(key))
  )
    throw new IdentityError("invalid_request", 400)
  const image = form.get("frontImage")
  const consentVersion = form.get("consentVersion")
  if (!(image instanceof File) || typeof consentVersion !== "string")
    throw new IdentityError("invalid_request", 400)
  return {
    frontImage: image,
    consentVersion,
    consentAccepted: form.get("consentAccepted") === "true",
  }
}
