const buckets = ["share", "video", "mbp", "backup"] as const

export type ShareBucket = (typeof buckets)[number]
export type ShareCategory = "video" | "text" | "image" | "other"

const videoExt = new Set(["3gp", "avi", "flv", "m4v", "mkv", "mov", "mp4", "ts", "webm"])
const imageExt = new Set(["bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "webp"])
const textExt = new Set(["csv", "htm", "html", "json", "log", "md", "srt", "txt", "vtt", "xml"])

const segmentOk = (value: string): boolean => {
  if (value.length === 0 || value.length > 180) return false
  if (value === "." || value === "..") return false
  return !value.includes("\0") && !/[/\\\t\n\r"'`$]/.test(value)
}

export const isBucket = (value: string): value is ShareBucket =>
  buckets.includes(value as ShareBucket)

export const fileCategory = (name: string): ShareCategory => {
  const ext = name.includes(".") ? (name.split(".").pop()?.toLowerCase() ?? "") : ""
  if (videoExt.has(ext)) return "video"
  if (imageExt.has(ext)) return "image"
  if (textExt.has(ext)) return "text"
  return "other"
}

export const splitRelative = (
  path: string,
): { readonly name: string; readonly parent: string } | null => {
  if (path.length === 0 || path.length > 512 || path.startsWith("/") || path.endsWith("/"))
    return null
  const parts = path.split("/")
  if (!parts.every(segmentOk)) return null
  return { name: parts[parts.length - 1] ?? "", parent: parts.slice(0, -1).join("/") }
}

export const directoryOk = (path: string): boolean => path === "" || splitRelative(path) !== null
