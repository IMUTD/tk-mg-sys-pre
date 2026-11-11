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

export type SwipeDirection = "down" | "left" | "right" | "up"

const swipeDirections = new Set<SwipeDirection>(["down", "left", "right", "up"])

const swipeNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const swipeDirectionFromDelta = (dx: number, dy: number): SwipeDirection => {
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? "right" : "left"
  return dy > 0 ? "down" : "up"
}

export const swipeDirectionOf = (params: Record<string, string>): SwipeDirection => {
  const named = params["direction"]
  if (named !== undefined && swipeDirections.has(named as SwipeDirection)) return named as SwipeDirection
  return swipeDirectionFromDelta(
    swipeNumber(params["x1"], 0) - swipeNumber(params["x0"], 0),
    swipeNumber(params["y1"], 0) - swipeNumber(params["y0"], 0),
  )
}

const axisOf = (direction: SwipeDirection): { x: number; y: number } => {
  if (direction === "left") return { x: -1, y: 0 }
  if (direction === "right") return { x: 1, y: 0 }
  if (direction === "down") return { x: 0, y: 1 }
  return { x: 0, y: -1 }
}

export const withInferredSwipeDirection = (params: Record<string, string>): Record<string, string> => {
  const ready = ["x0", "y0", "x1", "y1"].every((key) => /^-?\d+$/.test((params[key] ?? "").trim()))
  if (!ready) return params
  return {
    ...params,
    direction: swipeDirectionFromDelta(
      swipeNumber(params["x1"], 0) - swipeNumber(params["x0"], 0),
      swipeNumber(params["y1"], 0) - swipeNumber(params["y0"], 0),
    ),
  }
}

export const paramsForPhaseSwipe = (
  params: Record<string, string>,
  phase: string,
  direction: SwipeDirection,
): Record<string, string> => {
  const next = paramsForSwipeDirection(
    {
      direction: params[`${phase}Direction`] ?? "",
      x0: params[`${phase}X0`] ?? "",
      x1: params[`${phase}X1`] ?? "",
      y0: params[`${phase}Y0`] ?? "",
      y1: params[`${phase}Y1`] ?? "",
    },
    direction,
  )
  return {
    ...params,
    [`${phase}Direction`]: next["direction"] ?? direction,
    [`${phase}X0`]: next["x0"] ?? "",
    [`${phase}X1`]: next["x1"] ?? "",
    [`${phase}Y0`]: next["y0"] ?? "",
    [`${phase}Y1`]: next["y1"] ?? "",
  }
}

export const paramsForSwipeDirection = (
  params: Record<string, string>,
  direction: SwipeDirection,
): Record<string, string> => {
  const x0 = swipeNumber(params["x0"], 540)
  const y0 = swipeNumber(params["y0"], 1600)
  const x1 = swipeNumber(params["x1"], 540)
  const y1 = swipeNumber(params["y1"], 900)
  const length = Math.max(Math.hypot(x1 - x0, y1 - y0), 80)
  const midX = (x0 + x1) / 2
  const midY = (y0 + y1) / 2
  const axis = axisOf(direction)
  const half = length / 2
  const place = (value: number): string => String(Math.max(0, Math.round(value)))
  return {
    ...params,
    direction,
    x0: place(midX - axis.x * half),
    x1: place(midX + axis.x * half),
    y0: place(midY - axis.y * half),
    y1: place(midY + axis.y * half),
  }
}

const swipeFromStart = (
  params: Record<string, string>,
  start: DevicePoint,
): Record<string, string> => {
  const direction = swipeDirectionOf(params)
  const liftX = Math.max(80, Math.round(start.w * 0.4))
  const liftY = Math.max(80, Math.round(start.h * 0.4))
  const axis = axisOf(direction)
  const clamp = (value: number, max: number): string =>
    String(Math.max(0, Math.min(Math.max(max, 1) - 1, Math.round(value))))
  return {
    ...params,
    direction,
    x0: clamp(start.x, start.w),
    x1: clamp(start.x + axis.x * (axis.x === 0 ? 0 : liftX), start.w),
    y0: clamp(start.y, start.h),
    y1: clamp(start.y + axis.y * (axis.y === 0 ? 0 : liftY), start.h),
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
            direction: swipeDirectionFromDelta(end.x - start.x, end.y - start.y),
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
