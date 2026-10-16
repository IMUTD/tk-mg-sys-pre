export const REMARK_SEPARATOR = "\u001e"

export const splitRemarks = (value: string): string[] => {
  const seen = new Set<string>()
  const names: string[] = []
  for (const item of value.split(REMARK_SEPARATOR)) {
    const name = item.trim()
    if (name.length === 0 || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

export const joinRemarks = (names: readonly string[]): string =>
  splitRemarks(names.join(REMARK_SEPARATOR)).join(REMARK_SEPARATOR)

export const addRemarks = (current: string, names: readonly string[]): string =>
  joinRemarks([...splitRemarks(current), ...names])

export const formatRemarks = (value: string): string => splitRemarks(value).join("、")

export const remarkMatches = (
  value: string,
  names: readonly string[],
  mode: "and" | "or" = "and",
): boolean => {
  if (names.length === 0) return true
  const parts = splitRemarks(value)
  return mode === "or"
    ? names.some((name) => parts.includes(name))
    : names.every((name) => parts.includes(name))
}
