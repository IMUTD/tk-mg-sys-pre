import { z } from "zod"
import type { ProviderResult } from "./types"

const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const
export const normalizeIdentityNumber = (value: string): string | null => {
  const number = value.trim().toUpperCase()
  if (!/^[1-9]\d{16}[0-9X]$/.test(number)) return null
  const date = number.slice(6, 14)
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(4, 6))
  const day = Number(date.slice(6, 8))
  const birthDate = new Date(Date.UTC(year, month - 1, day))
  if (
    year < 1800 ||
    birthDate.getUTCFullYear() !== year ||
    birthDate.getUTCMonth() !== month - 1 ||
    birthDate.getUTCDate() !== day
  )
    return null
  const checksum = weights.reduce((sum, weight, index) => sum + weight * Number(number[index]), 0)
  return "10X98765432"[checksum % 11] === number[17] ? number : null
}
const responseSchema = z.object({
  code: z.string().max(100),
  requestId: z
    .string()
    .regex(/^[\w-]{1,100}$/)
    .optional(),
  resultObject: z
    .object({ bizCode: z.string().max(30), cardInfo: z.string().max(20000).optional() })
    .optional(),
})
const cardSchema = z.object({
  certName: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[\p{L}· .]+$/u),
  certNo: z.string().max(30),
})
const safeCode = (code: string): string | null =>
  /^[A-Za-z0-9_.-]{1,100}$/.test(code) ? code : null
const providerErrorCode = (code: string): string => {
  switch (code) {
    case "403":
      return "rate_limited"
    case "405":
      return "unsupported_image"
    case "420":
      return "identity_image_unusable"
    case "421":
      return "image_too_large"
    case "440":
      return "identity_ocr_failed"
    default:
      return "identity_provider_unavailable"
  }
}
export const parseProviderResponse = (value: unknown): ProviderResult => {
  const parsed = responseSchema.safeParse(value)
  if (!parsed.success)
    return {
      status: "error",
      errorCode: "identity_provider_invalid_response",
      code: null,
      bizCode: null,
      requestId: null,
    }
  const body = parsed.data
  const metadata = {
    code: safeCode(body.code),
    bizCode: body.resultObject ? safeCode(body.resultObject.bizCode) : null,
    requestId: body.requestId ?? null,
  }
  if (body.code !== "200")
    return { ...metadata, status: "error", errorCode: providerErrorCode(body.code) }
  if (body.resultObject?.bizCode === "2")
    return { ...metadata, status: "rejected", errorCode: "identity_mismatch" }
  if (body.resultObject?.bizCode !== "1" || !body.resultObject.cardInfo)
    return { ...metadata, status: "error", errorCode: "identity_provider_invalid_response" }
  try {
    const card = cardSchema.safeParse(JSON.parse(body.resultObject.cardInfo))
    const number = card.success ? normalizeIdentityNumber(card.data.certNo) : null
    if (!card.success || number === null)
      return { ...metadata, status: "error", errorCode: "identity_provider_invalid_response" }
    return { ...metadata, status: "verified", name: card.data.certName, number }
  } catch (error) {
    if (error instanceof SyntaxError)
      return { ...metadata, status: "error", errorCode: "identity_provider_invalid_response" }
    throw error
  }
}
