import { Button, Card, Typography } from "antd"
import { type ReactNode, useEffect, useState } from "react"

type LogItem = {
  readonly at: string
  readonly id: string
  readonly level: string
  readonly text: string
}

export const OperationLogCard = (): ReactNode => {
  const [open, setOpen] = useState(() => localStorage.getItem("tk-mg.log.open") !== "0")
  const [items, setItems] = useState<LogItem[]>([])
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    let after = 0
    let stop = false
    const pull = async () => {
      const response = await fetch(`/api/operation-logs?after=${after}`, {
        credentials: "same-origin",
      })
      if (!response.ok) return
      const body = (await response.json()) as { items?: LogItem[] }
      const next = body.items ?? []
      if (next.length === 0) return
      after = Number(next[next.length - 1]?.id ?? after)
      setItems((current) => [...next].reverse().concat(current).slice(0, 200))
      if (localStorage.getItem("tk-mg.log.open") === "0") setUnread((count) => count + next.length)
    }
    void pull()
    const timer = setInterval(() => {
      if (!stop) void pull()
    }, 2000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [])

  const toggle = () => {
    setOpen((value) => {
      const next = !value
      localStorage.setItem("tk-mg.log.open", next ? "1" : "0")
      if (next) setUnread(0)
      return next
    })
  }

  return (
    <Card
      extra={
        <Button onClick={toggle} size="small">
          {open ? "收起" : "展开"}
        </Button>
      }
      style={{ marginBottom: 16 }}
      title={open ? "日志" : `日志${unread > 0 ? `（${unread}）` : ""}`}
    >
      {open ? (
        <div
          style={{
            fontFamily: "ui-monospace, Consolas, monospace",
            fontSize: 12,
            maxHeight: 220,
            overflow: "auto",
          }}
        >
          {items.length === 0 ? (
            <Typography.Text type="secondary">操作进度和错误会显示在这里</Typography.Text>
          ) : null}
          {items.map((item) => (
            <div key={item.id} style={{ color: item.level === "error" ? "#cf1322" : undefined }}>
              {item.text}
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  )
}
