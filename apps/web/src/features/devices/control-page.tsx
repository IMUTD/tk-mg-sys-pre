import { Button } from "antd"
import { type ReactNode, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import "./devices.css"

type Slot = {
  readonly apiPort: number
  readonly busy: boolean
  readonly fileBrowserUrl?: string
  readonly height: string
  readonly host: string
  readonly index: number
  readonly label: string
  readonly rpaPort: number
  readonly status: string
  readonly width: string
}

const pitIndexes = [1, 2, 3, 4, 5] as const

const webrtcPorts = (index: number, apiPort: number): { readonly tcp: number; readonly udp: number } => {
  if (apiPort === 9082) return { tcp: 10008, udp: 10008 }
  const tcp = 30000 + (index - 1) * 100 + 7
  return { tcp, udp: tcp + 1 }
}

const phoneAspect = (slot: Slot | undefined): string => {
  const width = Number(slot?.width)
  const height = Number(slot?.height)
  if (width > 0 && height > 0) return `${width} / ${height}`
  return "9 / 16"
}

const playerUrl = (host: string, index: number, apiPort: number): string => {
  const ports = webrtcPorts(index, apiPort)
  const query = new URLSearchParams({
    q: "1",
    rtc_i: host,
    rtc_p: String(ports.udp),
    shost: host,
    sport: String(ports.tcp),
    v: "h264",
  })
  return `/webplayer/play.html?${query.toString()}`
}

export const DeviceControlPage = (): ReactNode => {
  const { deviceId = "" } = useParams()
  const navigate = useNavigate()
  const [slots, setSlots] = useState<Slot[]>([])
  const [frames, setFrames] = useState<Readonly<Record<number, string>>>({})
  const [controlling, setControlling] = useState<ReadonlySet<number>>(new Set())
  const [scale, setScale] = useState(1)
  const zoom = (delta: number) => {
    setScale((current) => Math.min(1.6, Math.max(0.5, Math.round((current + delta) * 10) / 10)))
  }

  useEffect(() => {
    let stop = false
    const current = new Map<number, string>()
    const tick = async () => {
      await fetch(`/api/devices/${deviceId}/watch`, {
        body: JSON.stringify({ indexNums: [...pitIndexes] }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      const response = await fetch(`/api/devices/${deviceId}/slots`, { credentials: "same-origin" })
      if (!response.ok || stop) return
      const rows = (await response.json()) as Slot[]
      if (!stop && Array.isArray(rows)) setSlots(rows)
      await Promise.all(
        pitIndexes.map(async (index) => {
          const frame = await fetch(`/api/frames?deviceId=${deviceId}&index=${index}`, { credentials: "same-origin" })
          if (stop || !frame.ok || frame.status === 204) return
          const blob = await frame.blob()
          if (stop || blob.size === 0) return
          const next = URL.createObjectURL(blob)
          const previous = current.get(index)
          if (previous !== undefined) URL.revokeObjectURL(previous)
          current.set(index, next)
        }),
      )
      if (!stop) setFrames(Object.fromEntries(current))
    }
    void tick()
    const timer = setInterval(() => {
      void tick()
    }, 1000)
    return () => {
      stop = true
      clearInterval(timer)
      for (const url of current.values()) URL.revokeObjectURL(url)
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

  const byIndex = new Map(slots.map((slot) => [slot.index, slot]))
  const fileBrowserUrl = slots.find((slot) => (slot.fileBrowserUrl ?? "").length > 0)?.fileBrowserUrl ?? ""

  return (
    <section className="control-page">
      <div className="control-toolbar">
        <Button onClick={() => navigate("/operations/devices")} size="small">
          返回盒子管理
        </Button>
        <span>五台云机共用这一页。画面由 agent 推送，控制在局域网里直连云机。</span>
        <Button disabled={scale <= 0.5} onClick={() => zoom(-0.1)} size="small">
          缩小
        </Button>
        <span>{Math.round(scale * 100)}%</span>
        <Button disabled={scale >= 1.6} onClick={() => zoom(0.1)} size="small">
          放大
        </Button>
      </div>
      <div className="control-board" style={{ "--phone-scale": String(scale) }}>
        {pitIndexes.map((index) => {
          const slot = byIndex.get(index)
          const host = slot?.host ?? ""
          const active = controlling.has(index)
          return (
            <article className="control-card" key={index} style={{ "--phone-aspect": phoneAspect(slot) }}>
              <div className="control-screen">
                {active && host.length > 0 ? (
                  <iframe title={`${index} 控制`} src={playerUrl(host, index, slot?.apiPort ?? 0)} />
                ) : frames[index] !== undefined ? (
                  <img alt="" src={frames[index]} />
                ) : (
                  <div className="control-empty">等待画面</div>
                )}
              </div>
              <div className="control-meta">
                <strong>
                  {index} {slot?.label ?? "空位"}
                </strong>
                <span>
                  {slot === undefined ? "无云机" : slot.status}
                  {slot?.busy ? " · 执行中" : ""}
                </span>
                <div className="control-actions">
                  <Button
                    disabled={slot === undefined || host.length === 0}
                    onClick={() =>
                      setControlling((current) => {
                        const next = new Set(current)
                        if (next.has(index)) next.delete(index)
                        else next.add(index)
                        return next
                      })
                    }
                    size="small"
                    type={active ? "default" : "primary"}
                  >
                    {active ? "关闭" : "控制"}
                  </Button>
                  <Button disabled={slot === undefined || slot.busy} onClick={() => slot !== undefined && void run("BoxStart", slot)} size="small">
                    启动
                  </Button>
                  <Button disabled={slot === undefined || slot.busy} onClick={() => slot !== undefined && void run("BoxStop", slot)} size="small">
                    停止
                  </Button>
                  <Button disabled={slot === undefined || slot.busy} onClick={() => slot !== undefined && void run("BoxRestart", slot)} size="small">
                    重启
                  </Button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
      <section className="control-files">
        <h2>共享文件</h2>
        {fileBrowserUrl.length > 0 ? (
          <iframe title="hmg 共享文件" src={fileBrowserUrl} />
        ) : (
          <p>这台盒子还没有上报文件浏览器。</p>
        )}
      </section>
    </section>
  )
}
