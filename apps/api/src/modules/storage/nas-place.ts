export type NasKind = "backup" | "image" | "video"
export type NasAction = "drop" | "replace" | "stop" | "upload"

const bucketPattern = /^[a-z0-9-]{3,63}$/

export const bucketOk = (value: string): boolean => bucketPattern.test(value)

export const fileNameOk = (name: string): boolean =>
  name.length > 0 &&
  name.length <= 200 &&
  !name.includes("/") &&
  !name.includes("\\") &&
  !name.includes("..")

export const dirNameOk = (name: string): boolean =>
  name.length > 0 &&
  name.length <= 80 &&
  name === name.trim() &&
  name !== "." &&
  name !== ".." &&
  !name.includes("/") &&
  !name.includes("\\") &&
  !name.includes("..")

export const nasObjectKey = (administratorId: string, name: string): string | null =>
  fileNameOk(name) ? `${administratorId}/${name}` : null

export const nasDirKey = (directory: string, name: string): string | null =>
  dirNameOk(directory) && fileNameOk(name) ? `${directory}/${name}` : null

export const nasDeleteKeyOk = (key: string): boolean => {
  const slash = key.indexOf("/")
  if (slash <= 0 || slash !== key.lastIndexOf("/") || key.length > 1024) return false
  if (key.endsWith(".uploading") || key.includes("\\") || key.includes("..")) return false
  return dirNameOk(key.slice(0, slash)) && fileNameOk(key.slice(slash + 1))
}

export const nasAddress = (endpoint: string, loginUrl: string): string => {
  const primary = endpoint.trim().replace(/\/+$/, "")
  return primary.length > 0 ? primary : loginUrl.trim().replace(/\/+$/, "")
}

export const boxDirForNasBucket = (
  bucket: string,
): { readonly bucket: "backup" | "share" | "video"; readonly category: "image" | "other" | "video" } | null => {
  if (bucket === "pictures") return { bucket: "share", category: "image" }
  if (bucket === "videos") return { bucket: "video", category: "video" }
  if (bucket === "backup") return { bucket: "backup", category: "other" }
  return null
}

export const nasTransferAction = (
  kind: NasKind,
  existingSha: string | null,
  _sha256: string,
): NasAction => {
  if (existingSha === null) return "upload"
  if (kind === "backup") return "replace"
  return "drop"
}

export const nasCommitShaOk = (place: string, kind: NasKind, _storedSha: string, _sha256: string): boolean =>
  place === "box" || (place === "nas" && kind === "backup")

export const storageCardItems = (raw: unknown): readonly { readonly bucket: string; readonly id: string }[] => {
  let parsed = raw
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown
    } catch {
      return []
    }
  }
  if (typeof parsed !== "object" || parsed === null || !("items" in parsed)) return []
  const items = parsed["items"]
  if (!Array.isArray(items)) return []
  return items.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || !("id" in entry) || !("bucket" in entry)) return []
    const id = entry["id"]
    const bucket = entry["bucket"]
    return typeof id === "string" && typeof bucket === "string" ? [{ bucket, id }] : []
  })
}
