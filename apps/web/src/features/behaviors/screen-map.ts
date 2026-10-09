export type DevicePoint = {
  h: number
  w: number
  x: number
  y: number
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
