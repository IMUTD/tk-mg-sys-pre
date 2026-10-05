import {
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  type TableColumnsType,
  Tag,
} from "antd"
import { type ReactNode, useMemo, useState } from "react"

import {
  emptyInvoice,
  INVOICE_STATUS_OPTIONS,
  INVOICE_TITLE_OPTIONS,
  INVOICE_TYPE_OPTIONS,
  type InvoiceKind,
  type InvoiceRow,
  type InvoiceTitleKind,
  invoiceStatusLabel,
  money,
  validateInvoice,
} from "./catalog"
import "./mall.css"

const nowText = (): string => "2026-09-17 19:30:00"

const columns: TableColumnsType<InvoiceRow> = [
  {
    dataIndex: "amount",
    render: (value: number) => money(value),
    title: "申请余额(元)",
    width: 130,
  },
  { dataIndex: "title", title: "发票抬头" },
  { dataIndex: "remark", title: "备注" },
  {
    dataIndex: "file",
    render: (value: string) => (value.length === 0 ? "-" : value),
    title: "发票文件",
    width: 120,
  },
  { dataIndex: "updatedAt", title: "更新时间", width: 180 },
  {
    dataIndex: "status",
    render: (value: InvoiceRow["status"]) => <Tag>{invoiceStatusLabel(value)}</Tag>,
    title: "状态",
    width: 90,
  },
]

export const MallInvoicesPage = (): ReactNode => {
  const { message } = App.useApp()
  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [creating, setCreating] = useState(false)
  const [status, setStatus] = useState("")
  const [type, setType] = useState("")
  const [titleType, setTitleType] = useState("")
  const filtered = useMemo(
    () =>
      rows.filter((item) => {
        if (status.length > 0 && item.status !== status) return false
        if (type.length > 0 && item.type !== type) return false
        if (titleType.length > 0 && item.titleType !== titleType) return false
        return true
      }),
    [rows, status, titleType, type],
  )

  return (
    <section className="module-page mall-page">
      <Card size="small">
        <Space wrap>
          <Select
            allowClear
            aria-label="状态"
            onChange={(value) => setStatus(value ?? "")}
            options={[...INVOICE_STATUS_OPTIONS]}
            placeholder="状态"
            style={{ width: 140 }}
            value={status.length === 0 ? null : status}
            virtual={false}
          />
          <Select
            allowClear
            aria-label="发票类型"
            onChange={(value) => setType(value ?? "")}
            options={[...INVOICE_TYPE_OPTIONS]}
            placeholder="发票类型"
            style={{ width: 180 }}
            value={type.length === 0 ? null : type}
            virtual={false}
          />
          <Select
            allowClear
            aria-label="抬头类型"
            onChange={(value) => setTitleType(value ?? "")}
            options={[...INVOICE_TITLE_OPTIONS]}
            placeholder="抬头类型"
            style={{ width: 140 }}
            value={titleType.length === 0 ? null : titleType}
            virtual={false}
          />
          <Button type="primary">搜索</Button>
          <Button
            onClick={() => {
              setStatus("")
              setType("")
              setTitleType("")
            }}
          >
            重置
          </Button>
          <Button onClick={() => setCreating(true)} type="primary">
            新增
          </Button>
        </Space>
      </Card>
      <Table
        columns={columns}
        dataSource={filtered}
        locale={{ emptyText: "暂无数据" }}
        pagination={false}
        rowKey="id"
        scroll={{ x: "max-content" }}
        size="small"
      />
      {creating ? (
        <InvoiceDialog
          onCancel={() => setCreating(false)}
          onSubmit={(record) => {
            setRows((current) => [record, ...current])
            setCreating(false)
            message.success("新增成功")
          }}
          record={emptyInvoice(Math.max(0, ...rows.map((item) => item.id)) + 1, nowText())}
        />
      ) : null}
    </section>
  )
}

const InvoiceDialog = ({
  onCancel,
  onSubmit,
  record,
}: {
  readonly onCancel: () => void
  readonly onSubmit: (record: InvoiceRow) => void
  readonly record: InvoiceRow
}): ReactNode => {
  const { message } = App.useApp()
  const [amount, setAmount] = useState(record.amount)
  const [remark, setRemark] = useState(record.remark)
  const [title, setTitle] = useState(record.title)
  const [titleType, setTitleType] = useState<InvoiceTitleKind>(record.titleType)
  const [type, setType] = useState<InvoiceKind>(record.type)

  const submit = (): void => {
    const next = { ...record, amount, remark, title, titleType, type }
    const error = validateInvoice(next)
    if (error !== null) {
      message.error(error)
      return
    }
    onSubmit(next)
  }

  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel} type="text">
            取消
          </Button>
          <Button onClick={submit} type="primary">
            确认
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title="新增"
    >
      <Form labelCol={{ style: { width: 90 } }} layout="horizontal" size="small">
        <Form.Item label="申请余额" required>
          <InputNumber
            aria-label="申请余额"
            min={0}
            onChange={(value) => setAmount(value ?? 0)}
            style={{ width: 220 }}
            value={amount}
          />
        </Form.Item>
        <Form.Item label="发票类型" required>
          <Select
            aria-label="发票类型"
            onChange={setType}
            options={[...INVOICE_TYPE_OPTIONS]}
            style={{ width: 220 }}
            value={type}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="抬头类型" required>
          <Select
            aria-label="抬头类型"
            onChange={setTitleType}
            options={[...INVOICE_TITLE_OPTIONS]}
            style={{ width: 220 }}
            value={titleType}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="发票抬头" required>
          <Input
            aria-label="发票抬头"
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </Form.Item>
        <Form.Item label="备注">
          <Input
            aria-label="备注"
            onChange={(event) => setRemark(event.target.value)}
            value={remark}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
