export type FilterMode = "and" | "or" | "nand"

export const combineChecks = (mode: FilterMode, checks: readonly (boolean | null)[]): boolean => {
  const active = checks.filter((check): check is boolean => check !== null)
  if (active.length === 0) return true
  if (mode === "or") return active.some(Boolean)
  if (mode === "nand") return active.some((check) => !check)
  return active.every(Boolean)
}
