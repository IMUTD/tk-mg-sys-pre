import { Button, Card, Space, Typography } from "antd"
import { type ReactNode, useEffect, useState } from "react"
import { useParams } from "react-router-dom"

type Slot = {
  readonly apiPort: number
  readonly busy: boolean
  readonly height: string
  readonly index: number
  readonly label: string
  readonly rpaPort: number
  readonly status: string
  readonly width: string
}

export const DeviceControlPage = (): ReactNode => {
  const { deviceId = "" } = useParams()
  const [slots, setSlots] = useState<Slot[]>([])
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let stop = false
    const watch = async () => {
      await fetch(`/api/devices/${deviceId}/watch`, {
        body: JSON.stringify({ indexNums: [1, 2, 3, 4, 5] }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      const response = await fetch(`/api/devices/${deviceId}/slots`, { credentials: "same-origin" })
      if (!response.ok || stop) return
      setSlots((await response.json()) as Slot[])
    }
    void watch()
    const timer = setInterval(() => {
      setTick((value) => value + 1)
      void watch()
    }, 2000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [deviceId])

  const run = async (skill: string, slot: Slot) => {
    await fetch("/api/tasks", {
      body: JSON.stringify({
        deviceId,
        indexNum: slot.index,
        steps: [{ input: { name: slot.label }, skill }],
      }),
      credentials: "same-origin",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      method: "POST",
    })
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      {slots.map((slot) => (
        <Card key={slot.index} title={`${slot.index} ${slot.label}`}>
          <img alt="" src={`/api/frames?deviceId=${deviceId}&index=${slot.index}&t=${tick}`} style={{ background: "#111", height: 180, objectFit: "contain", width: 120 }} />
          <Typography.Paragraph>{slot.status}{slot.busy ? " · 执行中" : ""}</Typography.Paragraph>
          <Space>
            <Button disabled={slot.busy} onClick={() => void run("BoxStart", slot)}>启动</Button>
            <Button disabled={slot.busy} onClick={() => void run("BoxStop", slot)}>停止</Button>
            <Button disabled={slot.busy} onClick={() => void run("BoxRestart", slot)}>重启</Button>
          </Space>
        </Card>
      ))}
    </Space>
  )
}
