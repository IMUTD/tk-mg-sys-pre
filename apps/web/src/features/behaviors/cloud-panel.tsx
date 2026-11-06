import { Button, Card, Form, Select, Tag } from "antd"
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"

import type { CloudBox, CloudDevice } from "./rpa-api"
import { type DevicePoint, devicePointFromEvent, type ScreenRect } from "./screen-map"

type CloudPanelProps = {
  readonly boxId: number
  readonly boxes: readonly CloudBox[]
  readonly mapNote: string
  readonly mapping: boolean
  readonly marks: readonly ScreenRect[]
  readonly onFrame: () => void
  readonly onGesture: (start: DevicePoint, end: DevicePoint) => void
  readonly onSelectBox: (id: number) => void
  readonly onSelectSlot: (index: number) => void
  readonly onToggleMap: () => void
  readonly selected: CloudDevice | null
  readonly slotIndex: number
}

type MapFrame = {
  dh: number
  dw: number
  h: number
  w: number
  x: number
  y: number
}

const MapLayer = ({
  image,
  marks,
  slotHeight,
  slotWidth,
}: {
  readonly image: HTMLImageElement | null
  readonly marks: readonly ScreenRect[]
  readonly slotHeight: number
  readonly slotWidth: number
}): ReactNode => {
  const [frame, setFrame] = useState<MapFrame | null>(null)
  useEffect(() => {
    if (image === null || marks.length === 0) return
    const measure = (): void => {
      const naturalWidth = image.naturalWidth
      const naturalHeight = image.naturalHeight
      const parent = image.parentElement
      if (naturalWidth < 1 || naturalHeight < 1 || parent === null) return
      const imageRect = image.getBoundingClientRect()
      const parentRect = parent.getBoundingClientRect()
      const scale = Math.min(imageRect.width / naturalWidth, imageRect.height / naturalHeight)
      if (scale <= 0) return
      const drawnWidth = naturalWidth * scale
      const drawnHeight = naturalHeight * scale
      setFrame({
        dh: slotHeight > 0 ? slotHeight : naturalHeight,
        dw: slotWidth > 0 ? slotWidth : naturalWidth,
        h: drawnHeight,
        w: drawnWidth,
        x: imageRect.left - parentRect.left + (imageRect.width - drawnWidth) / 2,
        y: imageRect.top - parentRect.top + (imageRect.height - drawnHeight) / 2,
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(image)
    image.addEventListener("load", measure)
    return () => {
      observer.disconnect()
      image.removeEventListener("load", measure)
    }
  }, [image, marks.length, slotHeight, slotWidth])
  if (frame === null || marks.length === 0) return null
  return (
    <svg
      className="cloud-map"
      style={{ height: frame.h, left: frame.x, top: frame.y, width: frame.w }}
      viewBox={`0 0 ${frame.dw} ${frame.dh}`}
    >
      {marks.map((mark) => (
        <g key={`${mark.index}-${mark.left}-${mark.top}-${mark.right}-${mark.bottom}`}>
          <rect
            height={mark.bottom - mark.top}
            width={mark.right - mark.left}
            x={mark.left}
            y={mark.top}
          />
          <text x={mark.left + 8} y={Math.min(mark.bottom - 4, mark.top + 36)}>
            {mark.index}
          </text>
        </g>
      ))}
    </svg>
  )
}

const CLOUD_SIZE_KEY = "hmg.cloudPanel.size"
const DEFAULT_WIDTH = 280
const DEFAULT_HEIGHT = 360

const clampWidth = (value: number): number => Math.min(720, Math.max(240, Math.round(value)))

const clampHeight = (value: number): number => Math.min(900, Math.max(180, Math.round(value)))

const readCloudSize = (): { height: number; width: number } => {
  try {
    const raw = localStorage.getItem(CLOUD_SIZE_KEY)
    if (raw === null) return { height: DEFAULT_HEIGHT, width: DEFAULT_WIDTH }
    const parsed = JSON.parse(raw) as { height?: unknown; width?: unknown }
    return {
      height: typeof parsed.height === "number" ? clampHeight(parsed.height) : DEFAULT_HEIGHT,
      width: typeof parsed.width === "number" ? clampWidth(parsed.width) : DEFAULT_WIDTH,
    }
  } catch {
    return { height: DEFAULT_HEIGHT, width: DEFAULT_WIDTH }
  }
}

const slotLabel = (box: CloudBox | null, index: number): string => {
  const found = box?.slots.find((item) => item.index === index)
  const name = found?.label ? ` · ${found.label}` : ""
  const state = found === undefined ? "空" : found.status === "online" ? "在线" : "离线"
  return `坑位 ${index}${name} · ${state}`
}

export const CloudPanel = ({
  boxId,
  boxes,
  mapNote,
  mapping,
  marks,
  onFrame,
  onGesture,
  onSelectBox,
  onSelectSlot,
  onToggleMap,
  selected,
  slotIndex,
}: CloudPanelProps): ReactNode => {
  const box = boxes.find((item) => item.id === boxId) ?? null
  const [preview, setPreview] = useState("")
  const [coord, setCoord] = useState("移到画面内查看云机坐标")
  const [panelWidth, setPanelWidth] = useState(() => readCloudSize().width)
  const [previewHeight, setPreviewHeight] = useState(() => readCloudSize().height)
  const [narrow, setNarrow] = useState(false)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [imageNode, setImageNode] = useState<HTMLImageElement | null>(null)
  const dragStart = useRef<DevicePoint | null>(null)
  const onFrameRef = useRef(onFrame)
  const mappingRef = useRef(mapping)
  onFrameRef.current = onFrame
  mappingRef.current = mapping

  useEffect(() => {
    const media = window.matchMedia("(max-width: 960px)")
    const apply = (): void => setNarrow(media.matches)
    apply()
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [])

  useEffect(() => {
    localStorage.setItem(
      CLOUD_SIZE_KEY,
      JSON.stringify({ height: previewHeight, width: panelWidth }),
    )
  }, [panelWidth, previewHeight])

  const resizePanel = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    const originX = event.clientX
    const originY = event.clientY
    const originWidth = panelWidth
    const originHeight = previewHeight
    handle.setPointerCapture(event.pointerId)
    const move = (ev: PointerEvent): void => {
      const room = Math.max(240, window.innerWidth - 360)
      setPanelWidth(Math.min(room, clampWidth(originWidth - (ev.clientX - originX))))
      setPreviewHeight(clampHeight(originHeight + (ev.clientY - originY)))
    }
    const stop = (): void => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", stop)
      handle.removeEventListener("pointercancel", stop)
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", stop)
    handle.addEventListener("pointercancel", stop)
  }

  useEffect(() => {
    const deviceId = selected?.deviceId
    const index = selected?.indexNum ?? selected?.slot ?? 0
    if (deviceId === undefined || index < 1) {
      setPreview("")
      return
    }
    let stop = false
    let current = ""
    const tick = async (): Promise<void> => {
      await fetch(`/api/devices/${deviceId}/watch`, {
        body: JSON.stringify({ indexNums: [index] }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      const frame = await fetch(`/api/frames?deviceId=${deviceId}&index=${index}`, {
        credentials: "same-origin",
      })
      if (stop || !frame.ok || frame.status === 204) return
      const blob = await frame.blob()
      if (stop || blob.size === 0) return
      const next = URL.createObjectURL(blob)
      if (current !== "") URL.revokeObjectURL(current)
      current = next
      setPreview(next)
      if (mappingRef.current) onFrameRef.current()
    }
    void tick()
    const timer = setInterval(() => {
      void tick()
    }, 2000)
    return () => {
      stop = true
      clearInterval(timer)
      if (current !== "") URL.revokeObjectURL(current)
    }
  }, [selected?.deviceId, selected?.indexNum, selected?.slot])

  const readPoint = (event: { clientX: number; clientY: number }): DevicePoint | null => {
    const image = imageRef.current
    if (image === null) return null
    return devicePointFromEvent(event, image, selected?.width ?? 0, selected?.height ?? 0)
  }

  return (
    <aside
      className="behaviors-cloud"
      style={narrow ? { width: "100%" } : { width: panelWidth }}
    >
      <Card size="small" title="测试云机">
        <Form layout="vertical" size="small">
          <Form.Item label="盒子">
            <Select
              aria-label="盒子"
              onChange={onSelectBox}
              options={boxes.map((item) => ({
                label: `${item.host}${item.online ? "" : "（离线）"}`,
                value: item.id,
              }))}
              {...(boxId ? { value: boxId } : {})}
              virtual={false}
            />
          </Form.Item>
          <Form.Item label="坑位">
            <Select
              aria-label="坑位"
              disabled={box === null}
              onChange={onSelectSlot}
              options={[1, 2, 3, 4, 5].map((index) => ({
                label: slotLabel(box, index),
                value: index,
              }))}
              value={slotIndex}
              virtual={false}
            />
          </Form.Item>
        </Form>
        {selected === null ? (
          <p className="behaviors-meta">尚未选择云机</p>
        ) : (
          <>
            <div className="cloud-map-bar">
              <Tag color={selected.online ? "success" : "default"}>
                {selected.online ? "在线" : "离线"}
              </Tag>
              <Button
                aria-label="云机映射"
                onClick={onToggleMap}
                size="small"
                type={mapping ? "primary" : "default"}
              >
                {mapping ? "取消映射" : "映射"}
              </Button>
              {mapNote.length > 0 ? <span className="behaviors-meta">{mapNote}</span> : null}
            </div>
            <p className="behaviors-meta">
              {selected.ip}:{selected.rpaPort} · 坑位 {selected.slot}
            </p>
            <div className="cloud-preview" style={{ height: previewHeight }}>
              {preview === "" ? (
                <>
                  <span>{selected.name}</span>
                  <span>等待画面</span>
                </>
              ) : (
                <div className="cloud-frame">
                <img
                  alt={`${selected.name} 画面`}
                  draggable={false}
                  onPointerDown={(event) => {
                    const point = readPoint(event)
                    if (point === null) return
                    dragStart.current = point
                    event.currentTarget.setPointerCapture(event.pointerId)
                  }}
                  onPointerMove={(event) => {
                    const point = readPoint(event)
                    setCoord(
                      point === null
                        ? "移到画面内查看云机坐标"
                        : `云机 ${point.x}, ${point.y} / ${point.w}×${point.h}`,
                    )
                  }}
                  onPointerUp={(event) => {
                    const point = readPoint(event)
                    const start = dragStart.current
                    dragStart.current = null
                    if (point === null || start === null) return
                    setCoord(`云机 ${point.x}, ${point.y} / ${point.w}×${point.h}`)
                    onGesture(start, point)
                  }}
                  ref={(node) => {
                    imageRef.current = node
                    setImageNode((current) => (current === node ? current : node))
                  }}
                  src={preview}
                />
                <MapLayer
                  image={imageNode}
                  marks={marks}
                  slotHeight={selected.height}
                  slotWidth={selected.width}
                />
                </div>
              )}
            </div>
            <p className="cloud-coords">{preview === "" ? "等待画面" : coord}</p>
          </>
        )}
        <p className="behaviors-meta">行为与行为链都走这台云机测试。</p>
      </Card>
      <button
        aria-label="调整测试云机大小"
        className="cloud-resize"
        onPointerDown={resizePanel}
        type="button"
      />
    </aside>
  )
}
