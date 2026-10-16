import { directoryOk, fileCategory, isBucket, splitRelative } from "./share-path"

const copySkill = "CopyVideoOnly"
const moveSkill = "UploadVideoThenDelete"
const videoPull = "PullShareVideo"
const imagePull = "PullShareImage"
const backupPull = "PullShareBackup"

const segmentOk = (value: string): boolean => {
  if (value.length === 0 || value.length > 180) return false
  if (value === "." || value === "..") return false
  return !value.includes("/") && !value.includes("\\") && !value.includes("\u0000")
}

const printfArg = (value: string): string => {
  const hex = Buffer.from(value, "utf8")
  let out = ""
  for (const byte of hex) out += `\\x${byte.toString(16).padStart(2, "0")}`
  return `$(printf '${out}')`
}

export const isSharedVideoSkill = (skill: string): boolean => skill === copySkill || skill === moveSkill

export const isCatalogPullSkill = (skill: string): boolean =>
  skill === videoPull || skill === imagePull || skill === backupPull

export const transferShareCode = "TransferShare"
export const stageShareCode = "StageShare"

const pullSkillFor = (
  bucket: string,
  name: string,
): "PullShareBackup" | "PullShareImage" | "PullShareVideo" | null => {
  if (bucket === "backup") return backupPull
  const category = fileCategory(name)
  if (category === "image") return imagePull
  if (category === "video") return videoPull
  return null
}

export const stageShareReady = (input: Record<string, string> | null | undefined): boolean => {
  const raw = input?.["路径"] ?? ""
  const slash = raw.indexOf("/")
  if (slash < 1) return false
  const bucket = raw.slice(0, slash)
  const relative = raw.slice(slash + 1)
  const parsed = splitRelative(relative)
  if (!isBucket(bucket) || parsed === null || pullSkillFor(bucket, parsed.name) === null) return false
  return hostOk((input?.["源主机"] ?? "").trim())
}

export type StageShareAction =
  | {
      readonly action: "pull"
      readonly path: string
      readonly skill: "PullShareBackup" | "PullShareImage" | "PullShareVideo"
    }
  | {
      readonly action: "wait"
      readonly bucket: string
      readonly relative: string
      readonly sha256: string
      readonly size: number
      readonly targetDirectory: string
    }
  | { readonly action: "fail" }

// Same-box stage becomes the existing pull. Another box waits until that box's copy lands with the same hash.
export const stageShareAction = (input: {
  readonly localHost: string
  readonly localSha: string
  readonly moveStatus: string | null
  readonly path: string
  readonly size: number
  readonly sourceHost: string
  readonly sourceSha: string
}): StageShareAction => {
  const slash = input.path.indexOf("/")
  const bucket = slash < 1 ? "" : input.path.slice(0, slash)
  const relative = slash < 1 ? "" : input.path.slice(slash + 1)
  const parsed = splitRelative(relative)
  const skill = parsed === null ? null : pullSkillFor(bucket, parsed.name)
  if (!isBucket(bucket) || parsed === null || skill === null) return { action: "fail" }
  if (input.sourceHost === input.localHost) return { action: "pull", path: input.path, skill }
  if (!/^[0-9a-f]{64}$/.test(input.sourceSha)) return { action: "fail" }
  if (input.localSha === input.sourceSha) return { action: "pull", path: input.path, skill }
  if (input.moveStatus === "failed" || input.moveStatus === "cancelled" || input.moveStatus === "succeeded") {
    return { action: "fail" }
  }
  const targetDirectory = parsed.parent
  return {
    action: "wait",
    bucket,
    relative,
    sha256: input.sourceSha,
    size: input.size,
    targetDirectory,
  }
}

const hostOk = (value: string): boolean => value.length > 0 && value.length <= 80 && /^[0-9A-Za-z.:-]+$/.test(value)

// Behavior-center transfer uses the same catalog path as the pull skills, plus the target box host.
export const transferShareReady = (input: Record<string, string> | null | undefined): boolean => {
  const raw = input?.["路径"] ?? ""
  const slash = raw.indexOf("/")
  if (slash < 1) return false
  const bucket = raw.slice(0, slash)
  const relative = raw.slice(slash + 1)
  const parsed = splitRelative(relative)
  if (!isBucket(bucket) || parsed === null) return false
  if (bucket !== "backup" && fileCategory(parsed.name) !== "video" && fileCategory(parsed.name) !== "image")
    return false
  if (!hostOk((input?.["目标主机"] ?? "").trim())) return false
  return directoryOk((input?.["目标目录"] ?? "").trim())
}

const pullDestination = (skill: string): string => {
  if (skill === imagePull) return "/sdcard/Pictures"
  if (skill === backupPull) return "/sdcard/Download"
  return "/sdcard/Movies"
}

const quotedPath = (path: string): string => path.split("/").map(printfArg).join("/")

// Catalog rows store bucket and relative_path separately. The pull parameter joins them as 桶/相对路径.
export const sharedPullCommand = (
  skill: string,
  input: Record<string, string> | null | undefined,
): string | null => {
  if (!isCatalogPullSkill(skill)) return null
  const raw = input?.["路径"] ?? ""
  const slash = raw.indexOf("/")
  if (slash < 1) return null
  const bucket = raw.slice(0, slash)
  const relative = raw.slice(slash + 1)
  const parsed = splitRelative(relative)
  if (!isBucket(bucket) || parsed === null) return null
  if (skill === backupPull && bucket !== "backup") return null
  if (skill !== backupPull && bucket === "backup") return null
  const source =
    skill === backupPull ? `/dev/hmg/share/.pull/${quotedPath(parsed.name)}` : `/dev/hmg/${bucket}/${quotedPath(relative)}`
  return `cp "${source}" "${pullDestination(skill)}/${quotedPath(parsed.name)}" 2>&1; echo EXIT:$?`
}

// The folder and file names are passed as printf hex so DoCmd's URL does not corrupt Chinese.
export const sharedVideoCommand = (skill: string, input: Record<string, string> | null | undefined): string | null => {
  const mode = skill === moveSkill ? "mv" : skill === copySkill ? "cp" : ""
  if (mode === "") return null
  const folder = input?.["视频目录"] ?? ""
  const file = input?.["视频名"] ?? ""
  if (!segmentOk(folder) || !segmentOk(file)) return null
  const dir = printfArg(folder)
  const name = printfArg(file)
  return `${mode} "/dev/hmg/video/${dir}/${name}" "/sdcard/Movies/${name}" 2>&1; echo EXIT:$?`
}

export const agentSkillStep = (
  kind: string,
  parameters: Record<string, string> | null | undefined,
): { readonly input: Record<string, string>; readonly skill: string } => {
  if (kind === backupPull) {
    const command = sharedPullCommand(kind, parameters)
    const relative = (parameters?.["路径"] ?? "").slice("backup/".length)
    return {
      input: {
        cmdline: command ?? "echo invalid backup path; echo EXIT:1",
        路径: command === null ? "" : relative,
      },
      skill: backupPull,
    }
  }
  if (isCatalogPullSkill(kind)) {
    return {
      input: { cmdline: sharedPullCommand(kind, parameters) ?? "echo invalid share path; echo EXIT:1" },
      skill: "DoCmd",
    }
  }
  if (!isSharedVideoSkill(kind)) return { input: parameters ?? {}, skill: kind }
  return { input: { cmdline: sharedVideoCommand(kind, parameters) ?? "echo invalid video path; echo EXIT:1" }, skill: "DoCmd" }
}
