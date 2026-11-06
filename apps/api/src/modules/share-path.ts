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

const archiveName = /^(.+)-(\d{4})(\d{2})(\d{2})(\d{2})-([A-Za-z0-9]+)\.(tar\.gz|zip)$/i

export type BackupPhone = { readonly namedAt: Date | null; readonly phoneName: string }

// Backup files are named {云机名}-{yyyyMMddHH}-{随机}.tar.gz. The hour is China local time.
export const backupPhone = (name: string): BackupPhone => {
  const matched = archiveName.exec(name)
  if (matched === null) return { namedAt: null, phoneName: "" }
  const phoneName = matched[1] ?? ""
  const year = Number(matched[2])
  const month = Number(matched[3])
  const day = Number(matched[4])
  const hour = Number(matched[5])
  if (
    phoneName.length === 0 ||
    phoneName.length > 64 ||
    phoneName.includes("/") ||
    phoneName.includes("\\") ||
    phoneName.includes("..") ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23
  ) {
    return { namedAt: null, phoneName: "" }
  }
  const namedAt = new Date(Date.UTC(year, month - 1, day, hour - 8, 0, 0))
  const check = new Date(namedAt.getTime() + 8 * 60 * 60 * 1000)
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    return { namedAt: null, phoneName: "" }
  }
  return { namedAt, phoneName }
}

export const phoneQuery = (raw: string): string | null => {
  const name = raw.trim()
  if (name.length === 0 || name.length > 200 || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return null
  }
  const lower = name.toLowerCase()
  if (lower.endsWith(".tar.gz") || lower.endsWith(".zip")) {
    const parsed = backupPhone(name)
    return parsed.phoneName === "" ? null : parsed.phoneName
  }
  if (name.length > 64) return null
  return name
}
