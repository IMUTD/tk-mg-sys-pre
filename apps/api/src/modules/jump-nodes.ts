export type JumpWhen = "off" | "success" | "failure"

export const jumpWhenMode = (raw: unknown, missing: JumpWhen = "success"): JumpWhen | null => {
  if (raw === undefined || raw === "") return missing
  if (raw === "success" || raw === "failure" || raw === "off") return raw
  return null
}

export const jumpNodesShouldSkip = (found: number, when: JumpWhen): boolean => {
  if (!Number.isInteger(found) || found < 0) return false
  if (when === "off") return false
  if (when === "failure") return found === 0
  return found > 0
}

export const statusShouldJump = (ok: boolean, when: JumpWhen): boolean => {
  if (when === "off") return false
  if (when === "failure") return !ok
  return ok
}

export const clickChanceReady = (raw: unknown): boolean => {
  if (raw === undefined || raw === "") return true
  return typeof raw === "string" && /^(100|[1-9]?\d)$/.test(raw.trim())
}

export const clickJumpPassed = (raw: unknown): boolean => raw === true || raw === "true"

export const jumpFoundCount = (raw: unknown): number | null => {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw
  if (typeof raw !== "string" || !/^(0|[1-9]\d*)$/.test(raw)) return null
  return Number(raw)
}

export const jumpTag = (raw: unknown): string | null => {
  if (raw === undefined || raw === "") return ""
  if (typeof raw !== "string") return null
  const tag = raw.trim()
  if (tag.length > 64) return null
  return tag
}

export const jumpWriteFieldLabels = {
  avatar: "头像地址",
  favorite: "获赞",
  follower: "粉丝量",
  following: "关注数",
  name: "展示名",
  note: "备注",
  platformUid: "平台数字 ID",
  region: "归属地",
  tags: "标签",
} as const

export type JumpWriteField = keyof typeof jumpWriteFieldLabels

const jumpWriteFieldSet = new Set<string>(Object.keys(jumpWriteFieldLabels))

const jumpWriteTextMax: Partial<Record<JumpWriteField, number>> = {
  avatar: 2000,
  name: 160,
  note: 2000,
  platformUid: 64,
  region: 64,
  tags: 64,
}

const maxSafe = BigInt(Number.MAX_SAFE_INTEGER)

export const jumpWriteKeys = [
  "tagOnFailure",
  "tagOnSuccess",
  "writeOnFailureField",
  "writeOnFailureValue",
  "writeOnSuccessField",
  "writeOnSuccessValue",
] as const

export const jumpWritePair = (
  fieldRaw: unknown,
  valueRaw: unknown,
): { readonly field: "" | JumpWriteField; readonly value: string } | null => {
  const field = fieldRaw === undefined ? "" : fieldRaw
  if (typeof field !== "string") return null
  if (field !== "" && !jumpWriteFieldSet.has(field)) return null
  if (field === "") {
    if (valueRaw === undefined || valueRaw === "") return { field: "", value: "" }
    if (typeof valueRaw !== "string" || valueRaw.trim() !== "") return null
    return { field: "", value: "" }
  }
  if (typeof valueRaw !== "string") return null
  const value = valueRaw.trim()
  if (value.length === 0) return null
  const chosen = field as JumpWriteField
  if (chosen === "follower" || chosen === "following" || chosen === "favorite") {
    if (!/^(0|[1-9]\d*)$/.test(value) || BigInt(value) > maxSafe) return null
    return { field: chosen, value }
  }
  const max = jumpWriteTextMax[chosen]
  if (max === undefined || value.length > max) return null
  return { field: chosen, value }
}

export const jumpWriteSideReady = (
  parameters: Readonly<Record<string, string>> | null | undefined,
  fieldKey: string,
  valueKey: string,
  legacyKey: string,
): boolean => {
  const hasNew =
    parameters !== undefined &&
    parameters !== null &&
    (fieldKey in parameters || valueKey in parameters)
  if (!hasNew) return jumpTag(parameters?.[legacyKey]) !== null
  return jumpWritePair(parameters[fieldKey], parameters[valueKey]) !== null
}

export const directAccountWrite = (
  fieldRaw: unknown,
  valueRaw: unknown,
): {
  readonly field: JumpWriteField
  readonly hit: boolean
  readonly label: string
  readonly value: string
} | null => {
  const pair = jumpWritePair(fieldRaw, valueRaw)
  if (pair === null || pair.field === "") return null
  return { field: pair.field, hit: true, label: jumpWriteFieldLabels[pair.field], value: pair.value }
}

export const jumpWriteBack = (
  count: unknown,
  parameters: Readonly<Record<string, string>> | null | undefined,
): { readonly field: JumpWriteField; readonly hit: boolean; readonly label: string; readonly value: string } | null => {
  const found = jumpFoundCount(count)
  if (found === null) return null
  const hit = found > 0
  const fieldKey = hit ? "writeOnSuccessField" : "writeOnFailureField"
  const valueKey = hit ? "writeOnSuccessValue" : "writeOnFailureValue"
  const legacyKey = hit ? "tagOnSuccess" : "tagOnFailure"
  const hasNew =
    parameters !== undefined &&
    parameters !== null &&
    (fieldKey in parameters || valueKey in parameters)
  if (!hasNew) {
    const tag = jumpTag(parameters?.[legacyKey])
    if (tag === null || tag.length === 0) return null
    return { field: "tags", hit, label: jumpWriteFieldLabels.tags, value: tag }
  }
  const pair = jumpWritePair(parameters?.[fieldKey], parameters?.[valueKey])
  if (pair === null || pair.field === "") return null
  return { field: pair.field, hit, label: jumpWriteFieldLabels[pair.field], value: pair.value }
}
