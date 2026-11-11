const appearKeys = ["text", "contentDesc", "resourceId", "className", "pkg"] as const
const swipeKeys = ["swipeText", "swipeContentDesc", "swipeResourceId", "swipeClassName", "swipePkg"] as const
const directionKeys = ["up", "down", "left", "right"] as const

const textOf = (input: Readonly<Record<string, string | undefined>> | null | undefined, key: string): string =>
  (input?.[key] ?? "").trim()

const whole = (raw: string): number | null => {
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

export const swipeWaitError = (
  input: Readonly<Record<string, string | undefined>> | null | undefined,
): string | null => {
  if (appearKeys.every((key) => textOf(input, key).length === 0)) return "出现条件为空"
  if (swipeKeys.every((key) => textOf(input, key).length === 0)) return "滑动条件为空"
  let distance = 0
  for (const key of directionKeys) {
    const raw = textOf(input, key)
    if (raw.length === 0) continue
    const value = whole(raw)
    if (value === null) return "方向无效"
    distance += value
  }
  if (distance < 1) return "滑动距离无效"
  const index = textOf(input, "index")
  if (index.length > 0 && whole(index) === null) return "index 无效"
  const interval = textOf(input, "interval")
  if (interval.length > 0) {
    const value = whole(interval)
    if (value === null || value > 60000) return "间隔无效"
  }
  return null
}

export const normalizeSwipeWait = (input: Record<string, string>): void => {
  if (textOf(input, "interval").length === 0) input.interval = "500"
  if (textOf(input, "index").length === 0) input.index = "0"
}
