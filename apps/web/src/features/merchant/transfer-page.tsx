import { App, Button, Card, Modal, Select, Space, Table, type TableColumnsType } from "antd"
import { type ReactNode, useMemo, useState } from "react"

import "../mall/mall.css"

const TARGETS = ["一组管理员", "二组管理员", "三组管理员"] as const

type OwnedRow = {
  readonly id: string
  owner: string
}

export const TransferPage = <Row extends OwnedRow>({
  columns,
  noun,
  rows,
}: {
  readonly columns: TableColumnsType<Row>
  readonly noun: string
  readonly rows: readonly Row[]
}): ReactNode => {
  const { message } = App.useApp()
  const [items, setItems] = useState<Row[]>(() => rows.map((item) => ({ ...item })))
  const [picked, setPicked] = useState<string[]>([])
  const [target, setTarget] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const selected = useMemo(() => items.filter((item) => picked.includes(item.id)), [items, picked])

  const transfer = (): void => {
    if (target === null) return
    setItems((current) =>
      current.map((item) => (picked.includes(item.id) ? { ...item, owner: target } : item)),
    )
    setPicked([])
    setOpen(false)
    message.success(`已将 ${selected.length} 个${noun}转移到${target}`)
  }

  return (
    <section className="module-page mall-page">
      <Card size="small">
        <Space wrap>
          <Select
            allowClear
            aria-label="目标管理员"
            onChange={(value) => setTarget(value ?? null)}
            options={TARGETS.map((name) => ({ label: name, value: name }))}
            placeholder="转移到"
            style={{ width: 180 }}
            value={target ?? undefined}
            virtual={false}
          />
          <Button
            disabled={picked.length === 0 || target === null}
            onClick={() => setOpen(true)}
            type="primary"
          >
            转移
          </Button>
        </Space>
      </Card>
      <Table
        columns={columns}
        dataSource={items}
        pagination={false}
        rowKey="id"
        rowSelection={{
          onChange: (keys) => setPicked(keys.map(String)),
          selectedRowKeys: picked,
        }}
        size="small"
      />
      <Modal
        cancelText="取消"
        okText="确认转移"
        onCancel={() => setOpen(false)}
        onOk={transfer}
        open={open}
        title={`转移${noun}`}
      >
        <p>
          将 {selected.length} 个{noun}转移到「{target}」。
        </p>
      </Modal>
    </section>
  )
}
