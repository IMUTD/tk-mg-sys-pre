import { Button } from "antd"
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import {
  type LinkPhase,
  linkLabel,
  linkPhase,
  playerUrl,
  type PlayerSnapshot,
} from "./control-link"
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
  readonly webrtcTcp?: number
  readonly webrtcUdp?: number
  readonly width: string
}

type PlayerWindow = Window & {
  h5_lgair?: {
    g_player?: {
      pconnection?: { iceConnectionState?: string } | null
      status?: number
      ws?: { readyState?: number } | null
    }
  }
}

const pitIndexes = [1, 2, 3, 4, 5] as const

const phoneAspect = (slot: Slot | undefined): string => {
  const width = Number(slot?.width)
  const height = Number(slot?.height)
  if (width > 0 && height > 0) return `${width} / ${height}`
  return "9 / 16"
}

const readPlayer = (frame: HTMLIFrameElement | undefined): PlayerSnapshot => {
  if (frame === undefined) return null
  try {
    const player = (frame.contentWindow as PlayerWindow | null)?.h5_lgair?.g_player
    if (player === undefined) return null
    const ice = player.pconnection?.iceConnectionState
    const wsState = player.ws?.readyState
    return {
      ...(ice !== undefined ? { ice } : {}),
      ...(typeof player.status === "number" ? { status: player.status } : {}),
      ...(typeof wsState === "number" ? { wsState } : {}),
    }
  } catch {
    return null
  }
}

export const DeviceControlPage = (): ReactNode => {
  const { deviceId = "" } = useParams()
  const navigate = useNavigate()
  const [slots, setSlots] = useState<Slot[]>([])
  const [previews, setPreviews] = useState<Readonly<Record<number, string>>>({})
  const [controlling, setControlling] = useState<ReadonlySet<number>>(new Set())
  const [phases, setPhases] = useState<Readonly<Record<number, LinkPhase>>>({})
  const [scale, setScale] = useState(1)
  const controllingRef = useRef(controlling)
  const players = useRef(new Map<number, HTMLIFrameElement>())
  const openedAt = useRef(new Map<number, number>())
  controllingRef.current = controlling
  const zoom = (delta: number) => {
    setScale((current) => Math.min(1.6, Math.max(0.5, Math.round((current + delta) * 10) / 10)))
  }

  const closePit = (index: number) => {
    openedAt.current.delete(index)
    setControlling((current) => {
      const next = new Set(current)
      next.delete(index)
      return next
    })
  }

  const openPit = (index: number) => {
    openedAt.current.delete(index)
    setControlling((current) => new Set(current).add(index))
  }

  useEffect(() => {
    let stop = false
    let running = false
    const tick = async () => {
      if (running || stop) return
      running = true
      try {
        await fetch(`/api/devices/${deviceId}/watch`, {
          body: JSON.stringify({ indexNums: [...pitIndexes] }),
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          method: "POST",
        })
        const response = await fetch(`/api/devices/${deviceId}/slots`, {
          credentials: "same-origin",
        })
        if (!response.ok || stop) return
        const rows = (await response.json()) as Slot[]
        if (!stop && Array.isArray(rows)) setSlots(rows)
      } finally {
        running = false
      }
    }
    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, 2000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [deviceId])

  useEffect(() => {
    let stop = false
    let running = false
    const current = new Map<number, string>()
    const tick = async () => {
      if (running || stop) return
      running = true
      try {
        const live = controllingRef.current
        await Promise.all(
          pitIndexes.map(async (index) => {
            if (live.has(index)) return
            const frame = await fetch(`/api/frames?deviceId=${deviceId}&index=${index}`, {
              credentials: "same-origin",
            })
            if (stop || !frame.ok || frame.status === 204) return
            const blob = await frame.blob()
            if (stop || blob.size === 0) return
            const next = URL.createObjectURL(blob)
            const previous = current.get(index)
            if (previous !== undefined) URL.revokeObjectURL(previous)
            current.set(index, next)
            if (!stop) setPreviews((existing) => ({ ...existing, [index]: next }))
          }),
        )
      } finally {
        running = false
      }
    }
    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, 1000)
    return () => {
      stop = true
      window.clearInterval(timer)
      for (const url of current.values()) URL.revokeObjectURL(url)
    }
  }, [deviceId])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      const live = controllingRef.current
      setPhases((current) => {
        const next: Record<number, LinkPhase> = {}
        for (const index of live) {
          let since = openedAt.current.get(index)
          if (since === undefined) {
            since = now
            openedAt.current.set(index, since)
          }
          next[index] = linkPhase(readPlayer(players.current.get(index)), now - since)
        }
        for (const index of openedAt.current.keys()) {
          if (!live.has(index)) openedAt.current.delete(index)
        }
        const same =
          Object.keys(current).length === Object.keys(next).length &&
          Object.entries(next).every(([index, phase]) => current[Number(index)] === phase)
        return same ? current : next
      })
    }, 500)
    return () => window.clearInterval(timer)
  }, [])

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
  const fileBrowserUrl =
    slots.find((slot) => (slot.fileBrowserUrl ?? "").length > 0)?.fileBrowserUrl ?? ""
  const boardStyle: CSSProperties & { readonly "--phone-scale": string } = {
    "--phone-scale": String(scale),
  }

  return (
    <section className="control-page">
      <div className="control-toolbar">
        <Button onClick={() => navigate("/operations/devices")} size="small">
          返回盒子管理
        </Button>
        <span>未控制时显示 agent 上报的截图。点「控制」后这一张卡片直连，五台可以同时开。</span>
        <Button disabled={scale <= 0.5} onClick={() => zoom(-0.1)} size="small">
          缩小
        </Button>
        <span>{Math.round(scale * 100)}%</span>
        <Button disabled={scale >= 1.6} onClick={() => zoom(0.1)} size="small">
          放大
        </Button>
      </div>
      <div className="control-board" style={boardStyle}>
        {pitIndexes.map((index) => {
          const slot = byIndex.get(index)
          const host = slot?.host.trim() ?? ""
          const active = controlling.has(index) && host.length > 0
          const cardStyle: CSSProperties & { readonly "--phone-aspect": string } = {
            "--phone-aspect": phoneAspect(slot),
          }
          const busy = slot?.busy === true ? " · 执行中" : ""
          const status =
            slot === undefined
              ? "无云机"
              : active
                ? `${linkLabel(phases[index] ?? "connecting")}${busy}`
                : `${slot.status}${busy}`
          return (
            <article
              className={active ? "control-card is-live" : "control-card"}
              key={index}
              style={cardStyle}
            >
              <div className="control-screen">
                {active && slot !== undefined ? (
                  <iframe
                    allow="autoplay"
                    ref={(node) => {
                      if (node === null) players.current.delete(index)
                      else players.current.set(index, node)
                    }}
                    src={playerUrl(host, slot)}
                    title={`${index} 控制`}
                  />
                ) : previews[index] !== undefined ? (
                  <img alt={`${index} 预览`} src={previews[index]} />
                ) : (
                  <div className="control-empty">{slot === undefined ? "空位" : "等待画面"}</div>
                )}
              </div>
              <div className="control-meta">
                <strong>
                  {index} {slot?.label ?? "空位"}
                </strong>
                <span>{status}</span>
                <div className="control-actions">
                  {active ? (
                    <Button onClick={() => closePit(index)} size="small">
                      关闭
                    </Button>
                  ) : (
                    <Button
                      disabled={slot === undefined || host.length === 0}
                      onClick={() => openPit(index)}
                      size="small"
                      type="primary"
                    >
                      控制
                    </Button>
                  )}
                  <Button
                    disabled={slot === undefined || slot.busy}
                    onClick={() => slot !== undefined && void run("BoxStart", slot)}
                    size="small"
                  >
                    启动
                  </Button>
                  <Button
                    disabled={slot === undefined || slot.busy}
                    onClick={() => slot !== undefined && void run("BoxStop", slot)}
                    size="small"
                  >
                    停止
                  </Button>
                  <Button
                    disabled={slot === undefined || slot.busy}
                    onClick={() => slot !== undefined && void run("BoxRestart", slot)}
                    size="small"
                  >
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
