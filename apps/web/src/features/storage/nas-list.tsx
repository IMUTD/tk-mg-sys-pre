import { Button, Modal, Space, Table } from "antd"
import { type ReactNode, useEffect, useState } from "react"

import type { NasCard } from "./nas-s3"

type NasListProps = {
  readonly card: NasCard | null
  readonly onClose: () => void
}

type ListedObject = {
  readonly key: string
  readonly modified: string
  readonly name: string
  readonly sha256: string
  readonly size: number
}

const sizeText = (size: number): string => {
  if (size >= 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${Math.round(size / 1024)} KB`
  return `${size} B`
}

export const NasObjectList = ({ card, onClose }: NasListProps): ReactNode => {
  const [items, setItems] = useState<readonly ListedObject[]>([])
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState("")

  useEffect(() => {
    if (card === null) return
    let cancelled = false
    const load = async (): Promise<void> => {
      setLoading(true)
      const response = await fetch(`/api/storage/nas-entries?nasId=${encodeURIComponent(card.id)}`, {
        credentials: "same-origin",
      })
      const payload = (await response.json().catch(() => null)) as { items?: ListedObject[]; message?: string } | null
      if (cancelled) return
      setLoading(false)
      if (!response.ok || payload === null || !Array.isArray(payload.items)) {
        setItems([])
        setNote(payload?.message ?? "没读到表")
        return
      }
      setItems(payload.items)
      setNote(payload.items.length === 0 ? "表里还没有这个目录的文件" : "")
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [card])

  const refresh = async (): Promise<void> => {
    if (card === null) return
    setLoading(true)
    const response = await fetch("/api/storage/nas-refresh", {
      body: JSON.stringify({ nasId: card.id }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
    const payload = (await response.json().catch(() => null)) as { queued?: boolean } | null
    setLoading(false)
    setNote(payload?.queued === true ? "已让一台在线盒子去列这个目录" : "没有在线盒子，列表保持原样")
  }

  return (
    <Modal
      cancelText="关闭"
      footer={null}
      onCancel={onClose}
      open={card !== null}
      title={card === null ? "NAS 数据" : `${card.name} · ${card.bucket}`}
      width={880}
    >
      <Space style={{ marginBottom: 12 }} wrap>
        <span>{note.length > 0 ? note : `${items.length} 条`}</span>
        <Button loading={loading} onClick={() => void refresh()} type="primary">
          让盒子刷新
        </Button>
      </Space>
      <Table<ListedObject>
        columns={[
          { dataIndex: "name", ellipsis: true, title: "文件" },
          { dataIndex: "size", render: (value: number) => sizeText(value), title: "大小", width: 120 },
          {
            dataIndex: "sha256",
            render: (value: string) => (value.length === 0 ? "未核对" : "已核对"),
            title: "哈希",
            width: 100,
          },
          { dataIndex: "modified", title: "时间", width: 220 },
        ]}
        dataSource={items.map((item) => ({ ...item }))}
        loading={loading}
        pagination={false}
        rowKey="key"
        scroll={{ y: 420 }}
        size="small"
      />
    </Modal>
  )
}
