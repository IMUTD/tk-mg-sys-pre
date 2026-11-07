import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  type TableColumnsType,
  Tag,
} from "antd"
import { type ReactNode, useState } from "react"

import { type InvoiceRecord, mallRequestError } from "../mall/api"
import {
  formatTime,
  INVOICE_STATUS_OPTIONS,
  invoiceStatusColor,
  invoiceStatusLabel,
  invoiceTypeLabel,
  money,
} from "../mall/catalog"
import { createMerchantApi, type MerchantApi } from "./api"
import "../mall/mall.css"

const defaultApi = createMerchantApi()
const PAGE_SIZE = 20
const MAX_FILE_BYTES = 5 * 1024 * 1024

type Dialog =
  | { readonly invoice: InvoiceRecord; readonly kind: "issue" }
  | { readonly invoice: InvoiceRecord; readonly kind: "reject" }

export const MerchantInvoicesPage = ({
  api = defaultApi,
}: {
  readonly api?: MerchantApi
}): ReactNode => {
  const [status, setStatus] = useState("pending")
  const [keyword, setKeyword] = useState("")
  const [applied, setApplied] = useState({ keyword: "", status: "pending" })
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const query = {
    page,
    pageSize: PAGE_SIZE,
    ...(applied.keyword.length > 0 ? { keyword: applied.keyword } : {}),
    ...(applied.status.length > 0 ? { status: applied.status } : {}),
  }
  const invoices = useQuery({
    queryFn: () => api.invoices(query),
    queryKey: ["merchant", "invoices", query],
  })

  const columns: TableColumnsType<InvoiceRecord> = [
    {
      render: (_value, invoice) => `${invoice.groupName}（${invoice.applicantName}）`,
      title: "申请方",
    },
    {
      dataIndex: "amountCents",
      render: (value: number) => money(value / 100),
      title: "金额",
      width: 110,
    },
    {
      dataIndex: "invoiceType",
      render: (value: InvoiceRecord["invoiceType"]) => invoiceTypeLabel(value),
      title: "类型",
      width: 150,
    },
    { dataIndex: "title", title: "抬头" },
    { dataIndex: "taxNumber", title: "税号", width: 200 },
    { dataIndex: "remark", title: "备注" },
    {
      dataIndex: "createdAt",
      render: (value: string) => formatTime(value),
      title: "申请时间",
      width: 170,
    },
    {
      dataIndex: "status",
      render: (value: InvoiceRecord["status"]) => (
        <Tag color={invoiceStatusColor(value)}>{invoiceStatusLabel(value)}</Tag>
      ),
      title: "状态",
      width: 80,
    },
    {
      render: (_value, invoice) => {
        if (invoice.status === "pending") {
          return (
            <Space>
              <Button
                aria-label={`开具${invoice.title}`}
                onClick={() => setDialog({ invoice, kind: "issue" })}
                size="small"
                type="primary"
              >
                开具
              </Button>
              <Button
                aria-label={`驳回${invoice.title}`}
                danger
                onClick={() => setDialog({ invoice, kind: "reject" })}
                size="small"
              >
                驳回
              </Button>
            </Space>
          )
        }
        if (invoice.status === "rejected") return invoice.rejectReason
        return (
          <Space>
            <span>{invoice.invoiceNumber}</span>
            {invoice.hasFile ? (
              <a download href={api.invoiceFileUrl(invoice.id)}>
                下载
              </a>
            ) : null}
          </Space>
        )
      },
      title: "操作",
      width: 200,
    },
  ]

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
          <Input
            allowClear
            aria-label="抬头、税号或发票号码"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="抬头、税号或发票号码"
            style={{ width: 240 }}
            value={keyword}
          />
          <Button
            onClick={() => {
              setPage(1)
              setApplied({ keyword: keyword.trim(), status })
            }}
            type="primary"
          >
            搜索
          </Button>
        </Space>
      </Card>
      {invoices.isError ? <Alert title="发票加载失败，请稍后重试" type="error" /> : null}
      <Table
        columns={columns}
        dataSource={[...(invoices.data?.items ?? [])]}
        loading={invoices.isFetching}
        pagination={{
          current: page,
          onChange: setPage,
          pageSize: PAGE_SIZE,
          showSizeChanger: false,
          total: invoices.data?.total ?? 0,
        }}
        rowKey="id"
        scroll={{ x: "max-content" }}
        size="small"
      />
      {dialog?.kind === "issue" ? (
        <IssueDialog api={api} invoice={dialog.invoice} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "reject" ? (
        <RejectDialog api={api} invoice={dialog.invoice} onClose={() => setDialog(null)} />
      ) : null}
    </section>
  )
}

const IssueDialog = ({
  api,
  invoice,
  onClose,
}: {
  readonly api: MerchantApi
  readonly invoice: InvoiceRecord
  readonly onClose: () => void
}): ReactNode => {
  const { message } = App.useApp()
  const client = useQueryClient()
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const tooLarge = file !== null && file.size > MAX_FILE_BYTES
  const mutation = useMutation({
    mutationFn: () => api.issueInvoice(invoice.id, { file, invoiceNumber: invoiceNumber.trim() }),
    onError: async (error) => {
      message.error(await mallRequestError(error))
      await client.invalidateQueries({ queryKey: ["merchant", "invoices"] })
    },
    onSuccess: async () => {
      message.success("发票已开具")
      onClose()
      await client.invalidateQueries({ queryKey: ["merchant", "invoices"] })
    },
  })
  return (
    <Modal
      cancelText="取消"
      confirmLoading={mutation.isPending}
      mask={{ closable: false }}
      okButtonProps={{ disabled: invoiceNumber.trim().length === 0 || tooLarge }}
      okText="确认开具"
      onCancel={onClose}
      onOk={() => mutation.mutate()}
      open
      title="开具发票"
    >
      <p>
        {invoice.title}
        {invoice.taxNumber.length > 0 ? `（税号 ${invoice.taxNumber}）` : ""}，
        {money(invoice.amountCents / 100)}，{invoiceTypeLabel(invoice.invoiceType)}
      </p>
      <Form layout="vertical" size="small">
        <Form.Item label="发票号码" required>
          <Input
            aria-label="发票号码"
            maxLength={64}
            onChange={(event) => setInvoiceNumber(event.target.value)}
            value={invoiceNumber}
          />
        </Form.Item>
        <Form.Item
          extra="选填，PDF 格式，不超过 5MB。纸质发票可以不传。"
          label="发票文件"
          {...(tooLarge ? { help: "文件超过 5MB", validateStatus: "error" as const } : {})}
        >
          <input
            accept="application/pdf,.pdf"
            aria-label="发票文件"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            type="file"
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

const RejectDialog = ({
  api,
  invoice,
  onClose,
}: {
  readonly api: MerchantApi
  readonly invoice: InvoiceRecord
  readonly onClose: () => void
}): ReactNode => {
  const { message } = App.useApp()
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const mutation = useMutation({
    mutationFn: () => api.rejectInvoice(invoice.id, reason.trim()),
    onError: async (error) => {
      message.error(await mallRequestError(error))
      await client.invalidateQueries({ queryKey: ["merchant", "invoices"] })
    },
    onSuccess: async () => {
      message.success("已驳回，额度已退回")
      onClose()
      await client.invalidateQueries({ queryKey: ["merchant", "invoices"] })
    },
  })
  return (
    <Modal
      cancelText="取消"
      confirmLoading={mutation.isPending}
      mask={{ closable: false }}
      okButtonProps={{ danger: true, disabled: reason.trim().length === 0 }}
      okText="确认驳回"
      onCancel={onClose}
      onOk={() => mutation.mutate()}
      open
      title="驳回发票"
    >
      <p>
        驳回「{invoice.title}」的 {money(invoice.amountCents / 100)} 申请，额度退回给买家。
      </p>
      <Form layout="vertical" size="small">
        <Form.Item label="驳回原因" required>
          <Input.TextArea
            aria-label="驳回原因"
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder="买家可以看到这条原因"
            rows={2}
            value={reason}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
