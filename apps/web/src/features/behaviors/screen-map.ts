export type DevicePoint = {
  h: number
  w: number
  x: number
  y: number
}

export type ScreenRect = {
  bottom: number
  index: number
  left: number
  right: number
  top: number
}

const boundsOf = (
  text: string,
): { bottom: number; left: number; right: number; top: number } | null => {
  const match = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(text)
  if (match === null) return null
  const left = Number(match[1])
  const top = Number(match[2])
  const right = Number(match[3])
  const bottom = Number(match[4])
  if (right <= left || bottom <= top) return null
  return { bottom, left, right, top }
}

export const arrangedMarks = (result: unknown): ScreenRect[] => {
  if (typeof result === "string") {
    try {
      return arrangedMarks(JSON.parse(result) as unknown)
    } catch {
      return parseArrangedNodes(result)
    }
  }
  if (result === null || typeof result !== "object" || Array.isArray(result)) return []
  const nodes = (result as Record<string, unknown>)["nodes"]
  return typeof nodes === "string" ? parseArrangedNodes(nodes) : []
}

export const parseArrangedNodes = (value: string): ScreenRect[] => {
  const text = value.trim()
  const rows: ScreenRect[] = []
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as unknown
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item === null || typeof item !== "object" || Array.isArray(item)) continue
          const row = item as Record<string, unknown>
          if (typeof row["index"] !== "number" || typeof row["bounds"] !== "string") continue
          const bounds = boundsOf(row["bounds"])
          if (bounds === null) continue
          rows.push({ index: row["index"], ...bounds })
        }
        if (rows.length > 0) return rows
      }
    } catch {
      // The agent stores this list as Go's printed slice, not JSON.
    }
  }
  for (const item of text.matchAll(/\{(\d+)\s+(\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\])\}/g)) {
    const bounds = boundsOf(item[2] ?? "")
    if (bounds === null) continue
    rows.push({ index: Number(item[1]), ...bounds })
  }
  return rows
}

export const devicePointFromEvent = (
  event: { clientX: number; clientY: number },
  image: HTMLImageElement,
  slotWidth: number,
  slotHeight: number,
): DevicePoint | null => {
  const naturalWidth = image.naturalWidth
  const naturalHeight = image.naturalHeight
  if (naturalWidth < 1 || naturalHeight < 1) return null
  const rect = image.getBoundingClientRect()
  const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight)
  if (scale <= 0) return null
  const drawnWidth = naturalWidth * scale
  const drawnHeight = naturalHeight * scale
  const originX = rect.left + (rect.width - drawnWidth) / 2
  const originY = rect.top + (rect.height - drawnHeight) / 2
  const imageX = (event.clientX - originX) / scale
  const imageY = (event.clientY - originY) / scale
  if (imageX < 0 || imageY < 0 || imageX > naturalWidth || imageY > naturalHeight) return null
  const width = slotWidth > 0 ? slotWidth : naturalWidth
  const height = slotHeight > 0 ? slotHeight : naturalHeight
  return {
    h: height,
    w: width,
    x: Math.max(0, Math.min(width - 1, Math.round((imageX / naturalWidth) * width))),
    y: Math.max(0, Math.min(height - 1, Math.round((imageY / naturalHeight) * height))),
  }
}

const swipeFromStart = (
  params: Record<string, string>,
  start: DevicePoint,
): Record<string, string> => {
  const lift = Math.max(80, Math.round(start.h * 0.4))
  const clamp = (value: number, max: number): string =>
    String(Math.max(0, Math.min(Math.max(max, 1) - 1, Math.round(value))))
  return {
    ...params,
    x0: clamp(start.x, start.w),
    x1: clamp(start.x, start.w),
    y0: clamp(start.y, start.h),
    y1: clamp(start.y - lift, start.h),
  }
}

export const applyScreenToParams = (
  params: Record<string, string>,
  start: DevicePoint,
  end: DevicePoint,
): { message: string; params: Record<string, string> } | null => {
  if ("x0" in params) {
    const distance = Math.hypot(end.x - start.x, end.y - start.y)
    const next =
      distance >= 24
        ? {
            ...params,
            x0: String(start.x),
            x1: String(end.x),
            y0: String(start.y),
            y1: String(end.y),
          }
        : swipeFromStart(params, start)
    return {
      message: `滑动 ${next["x0"]},${next["y0"]} → ${next["x1"]},${next["y1"]}`,
      params: next,
    }
  }
  if ("x" in params && "y" in params) {
    return {
      message: `已填坐标 ${end.x}, ${end.y}`,
      params: { ...params, x: String(end.x), y: String(end.y) },
    }
  }
  return null
}
