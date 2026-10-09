import { Card, Form, Select, Tag } from "antd"
import { type ReactNode, useEffect, useRef, useState } from "react"

import type { CloudBox, CloudDevice } from "./rpa-api"
import { type DevicePoint, devicePointFromEvent } from "./screen-map"

type CloudPanelProps = {
  readonly boxId: number
  readonly boxes: readonly CloudBox[]
  readonly onGesture: (start: DevicePoint, end: DevicePoint) => void
  readonly onSelectBox: (id: number) => void
  readonly onSelectSlot: (index: number) => void
  readonly selected: CloudDevice | null
  readonly slotIndex: number
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
  onGesture,
  onSelectBox,
  onSelectSlot,
  selected,
  slotIndex,
}: CloudPanelProps): ReactNode => {
  const box = boxes.find((item) => item.id === boxId) ?? null
  const [preview, setPreview] = useState("")
  const [coord, setCoord] = useState("移到画面内查看云机坐标")
  const imageRef = useRef<HTMLImageElement | null>(null)
  const dragStart = useRef<DevicePoint | null>(null)

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
    <aside className="behaviors-cloud">
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
            <Tag color={selected.online ? "success" : "default"}>
              {selected.online ? "在线" : "离线"}
            </Tag>
            <p className="behaviors-meta">
              {selected.ip}:{selected.rpaPort} · 坑位 {selected.slot}
            </p>
            <div className="cloud-preview">
              {preview === "" ? (
                <>
                  <span>{selected.name}</span>
                  <span>等待画面</span>
                </>
              ) : (
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
                  ref={imageRef}
                  src={preview}
                />
              )}
            </div>
            <p className="cloud-coords">{preview === "" ? "等待画面" : coord}</p>
          </>
        )}
        <p className="behaviors-meta">行为与行为链都走这台云机测试。</p>
      </Card>
    </aside>
  )
}
