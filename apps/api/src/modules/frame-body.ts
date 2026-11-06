export type FrameBody =
  | { readonly bytes: Uint8Array; readonly kind: "bytes" }
  | { readonly kind: "empty" }
  | { readonly kind: "overflow" }

export const frameBodyLimit = 2 * 1024 * 1024

export const readFrameBody = async (
  body: ReadableStream<Uint8Array> | null | undefined,
  limit = frameBodyLimit,
): Promise<FrameBody> => {
  if (body == null) return { kind: "empty" }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    length += chunk.value.byteLength
    if (length > limit) {
      await reader.cancel()
      return { kind: "overflow" }
    }
    chunks.push(chunk.value)
  }
  if (length === 0) return { kind: "empty" }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, kind: "bytes" }
}
