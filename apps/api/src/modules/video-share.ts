const copySkill = "CopyVideoOnly"
const moveSkill = "UploadVideoThenDelete"

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
  if (!isSharedVideoSkill(kind)) return { input: parameters ?? {}, skill: kind }
  return { input: { cmdline: sharedVideoCommand(kind, parameters) ?? "echo invalid video path; echo EXIT:1" }, skill: "DoCmd" }
}
