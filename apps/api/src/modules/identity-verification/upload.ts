import sharp from "sharp"
import { IdentityError } from "./types"
export const MaxImageBytes = 2_000_000
export const MaxRequestBytes = 2_500_000
// Local CPU/memory admission is separate from the durable limits on paid cloud attempts.
const decoderAdmission = { active: 0, limit: 2 }
export const readIdentityImage = async (file: File): Promise<Buffer> => {
  if (file.size > MaxImageBytes) throw new IdentityError("image_too_large", 413)
  if (!file.size || !["image/jpeg", "image/png"].includes(file.type))
    throw new IdentityError("unsupported_image", 415)
  return Buffer.from(await file.arrayBuffer())
}
export const decodeIdentityImage = async (bytes: Buffer, mediaType: string): Promise<void> => {
  if (decoderAdmission.active >= decoderAdmission.limit)
    throw new IdentityError("rate_limited", 429)
  decoderAdmission.active++
  try {
    const decoder = sharp(bytes, { failOn: "error", limitInputPixels: 20_000_000 })
    const metadata = await decoder.metadata()
    if (
      (metadata.format !== "jpeg" && metadata.format !== "png") ||
      metadata.width < 65 ||
      metadata.height < 65 ||
      metadata.width > 8191 ||
      metadata.height > 8191 ||
      (metadata.pages ?? 1) !== 1 ||
      mediaType !== `image/${metadata.format}`
    )
      throw new IdentityError("unsupported_image", 415)
    await decoder.raw().toBuffer()
  } catch (error) {
    if (error instanceof IdentityError) throw error
    if (error instanceof Error) throw new IdentityError("unsupported_image", 415)
    throw error
  } finally {
    decoderAdmission.active--
  }
}
export const validateIdentityImage = async (file: File): Promise<Buffer> => {
  const bytes = await readIdentityImage(file)
  await decodeIdentityImage(bytes, file.type)
  return bytes
}
