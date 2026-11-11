import { App, Button, Card } from "antd"
import { useCallback, useEffect, useState } from "react"

type MatchImage = {
  readonly createdAt: string
  readonly id: string
  readonly sizeBytes: number
}

type MatchImagesProps = {
  readonly canDelete?: boolean
  readonly canWrite: boolean
}

const sizeText = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

const timeText = (value: string): string => value.replace("T", " ").slice(0, 19)

export const MatchImages = ({ canDelete, canWrite }: MatchImagesProps) => {
  const { message, modal } = App.useApp()
  const [items, setItems] = useState<MatchImage[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    setLoading(true)
    void fetch("/api/match-images", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return
        const payload = (await response.json()) as { images?: MatchImage[] }
        setItems(payload.images ?? [])
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const upload = (file: File) => {
    const body = new FormData()
    body.set("file", file)
    void fetch("/api/match-images", {
      body,
      credentials: "same-origin",
      method: "POST",
    }).then(async (response) => {
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null
        message.error(payload?.message ?? "匹配图没有保存")
        return
      }
      message.success("已保存")
      refresh()
    })
  }

  return (
    <div className="behaviors-pane">
      <div className="behaviors-toolbar">
        {canWrite ? (
          <label className="match-image-upload">
            <input
              accept="image/*"
              aria-label="上传匹配图"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ""
                if (file !== undefined) upload(file)
              }}
              type="file"
            />
            <Button type="primary">上传</Button>
          </label>
        ) : null}
        <span className="filter-label">这些图只属于当前管理员，步骤里保存的是编号。</span>
      </div>
      {items.length === 0 ? (
        <Card className="behaviors-empty" loading={loading}>
          还没有匹配图
        </Card>
      ) : (
        <div className="match-image-grid">
          {items.map((item) => (
            <Card
              className="match-image-card"
              extra={
                canDelete === true ? (
                  <Button
                    danger
                    onClick={() => {
                      void modal.confirm({
                        cancelText: "取消",
                        content: "删除后，已经选了这张图的步骤会找不到它。",
                        okText: "确定",
                        onOk: async () => {
                          const response = await fetch(`/api/match-images/${item.id}`, {
                            credentials: "same-origin",
                            method: "DELETE",
                          })
                          if (!response.ok) {
                            message.error("删除失败")
                            return
                          }
                          message.success("删除成功")
                          refresh()
                        },
                        title: "提示",
                      })
                    }}
                    size="small"
                    type="link"
                  >
                    删除
                  </Button>
                ) : null
              }
              key={item.id}
            >
              <img alt="" src={`/api/match-images/${item.id}`} />
              <span>{sizeText(item.sizeBytes)}</span>
              <span>{timeText(item.createdAt)}</span>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
