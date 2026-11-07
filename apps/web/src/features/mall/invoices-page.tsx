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

import { createMallApi, type InvoiceRecord, type MallApi, mallRequestError } from "./api"
import {
  formatTime,
  INVOICE_STATUS_OPTIONS,
  INVOICE_TITLE_OPTIONS,
  INVOICE_TYPE_OPTIONS,
  type InvoiceKind,
  type InvoiceTitleKind,
  invoiceStatusColor,
  invoiceStatusLabel,
  invoiceTypeLabel,
  money,
} from "./catalog"
import { MallGroupBar, useMallGroup } from "./group-wallet"
import "./mall.css"

const defaultApi = createMallApi()
const PAGE_SIZE = 20
const AMOUNT = /^\d{1,8}(\.\d{1,2})?$/
const TAX_NUMBER = /^(?:[0-9A-Z]{15}|[0-9A-Z]{17,18}|[0-9A-Z]{20})$/

const yuan = (cents: number): string => money(cents / 100)

const resultText = (invoice: InvoiceRecord): string => {
  switch (invoice.status) {
    case "issued":
      return `发票号码 ${invoice.invoiceNumber}`
    case "rejected":
      return invoice.rejectReason
    case "pending":
      return "等待平台审核"
  }
}

export const MallInvoicesPage = ({ api = defaultApi }: { readonly api?: MallApi }): ReactNode => {
  const group = useMallGroup(api)
  const groupId = group.selected?.groupId ?? null
  const [status, setStatus] = useState("")
  const [type, setType] = useState("")
  const [titleType, setTitleType] = useState("")
  const [applied, setApplied] = useState({ status: "", titleType: "", type: "" })
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)

  const query = {
    page,
    pageSize: PAGE_SIZE,
    ...(applied.status.length > 0 ? { status: applied.status } : {}),
    ...(applied.type.length > 0 ? { invoiceType: applied.type } : {}),
    ...(applied.titleType.length > 0 ? { titleType: applied.titleType } : {}),
  }
  const invoices = useQuery({
    enabled: groupId !== null,
    queryFn: () => api.invoices(groupId ?? "", query),
    queryKey: ["mall", "invoices", groupId, query],
  })
  const quota = useQuery({
    enabled: groupId !== null,
    queryFn: () => api.invoiceQuota(groupId ?? ""),
    queryKey: ["mall", "invoice-quota", groupId],
  })

  const columns: TableColumnsType<InvoiceRecord> = [
    {
      dataIndex: "amountCents",
      render: (value: number) => yuan(value),
      title: "开票金额",
      width: 120,
    },
    {
      dataIndex: "invoiceType",
      render: (value: InvoiceKind) => invoiceTypeLabel(value),
      title: "发票类型",
      width: 150,
    },
    { dataIndex: "title", title: "发票抬头" },
    { dataIndex: "taxNumber", title: "税号", width: 200 },
    { dataIndex: "remark", title: "备注" },
    {
      render: (_value, invoice) => resultText(invoice),
      title: "处理结果",
    },
    {
      render: (_value, invoice) =>
        invoice.hasFile && groupId !== null ? (
          <a download href={api.invoiceFileUrl(groupId, invoice.id)}>
            下载
          </a>
        ) : (
          "-"
        ),
      title: "发票文件",
      width: 90,
    },
    {
      dataIndex: "updatedAt",
      render: (value: string) => formatTime(value),
      title: "更新时间",
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
  ]

  return (
    <section className="module-page mall-page">
      <MallGroupBar state={group} />
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
          <Button
            onClick={() => {
              setPage(1)
              setApplied({ status, titleType, type })
            }}
            type="primary"
          >
            搜索
          </Button>
          <Button
            onClick={() => {
              setStatus("")
              setType("")
              setTitleType("")
              setPage(1)
              setApplied({ status: "", titleType: "", type: "" })
            }}
          >
            重置
          </Button>
          <Button disabled={groupId === null} onClick={() => setCreating(true)} type="primary">
            新增
          </Button>
          {quota.data === undefined ? null : (
            <span aria-label="可开票金额" role="status">
              可开票 {yuan(quota.data.availableCents)}
            </span>
          )}
        </Space>
      </Card>
      {invoices.isError ? <Alert title="发票加载失败，请稍后重试" type="error" /> : null}
      <Table
        columns={columns}
        dataSource={[...(invoices.data?.items ?? [])]}
        loading={invoices.isFetching}
        locale={{ emptyText: "暂无数据" }}
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
      {creating && groupId !== null ? (
        <InvoiceDialog
          api={api}
          availableCents={quota.data?.availableCents ?? 0}
          groupId={groupId}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </section>
  )
}

const InvoiceDialog = ({
  api,
  availableCents,
  groupId,
  onClose,
}: {
  readonly api: MallApi
  readonly availableCents: number
  readonly groupId: string
  readonly onClose: () => void
}): ReactNode => {
  const { message } = App.useApp()
  const client = useQueryClient()
  const [amount, setAmount] = useState("")
  const [remark, setRemark] = useState("")
  const [title, setTitle] = useState("")
  const [taxNumber, setTaxNumber] = useState("")
  const [titleType, setTitleType] = useState<InvoiceTitleKind>("company")
  const [type, setType] = useState<InvoiceKind>("normal")
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  const trimmedAmount = amount.trim()
  const cents = AMOUNT.test(trimmedAmount) ? Math.round(Number(trimmedAmount) * 100) : 0
  const tax = taxNumber.trim().toUpperCase()
  const isCompany = titleType === "company"
  const overQuota = cents > availableCents
  const invalid =
    cents <= 0 || overQuota || title.trim().length === 0 || (isCompany && !TAX_NUMBER.test(tax))

  const mutation = useMutation({
    mutationFn: () =>
      api.createInvoice(groupId, {
        amountYuan: trimmedAmount,
        idempotencyKey,
        invoiceType: isCompany ? type : "normal",
        remark: remark.trim(),
        taxNumber: isCompany ? tax : "",
        title: title.trim(),
        titleType,
      }),
    onError: async (error) => {
      message.error(await mallRequestError(error))
    },
    onSuccess: async () => {
      message.success("已提交，等待平台审核")
      onClose()
      await client.invalidateQueries({ queryKey: ["mall"] })
    },
  })

  return (
    <Modal
      cancelText="取消"
      confirmLoading={mutation.isPending}
      mask={{ closable: false }}
      okButtonProps={{ disabled: invalid }}
      okText="提交"
      onCancel={onClose}
      onOk={() => mutation.mutate()}
      open
      title="申请发票"
    >
      <Form labelCol={{ style: { width: 90 } }} layout="horizontal" size="small">
        <Form.Item
          extra={`可开票 ${yuan(availableCents)}`}
          label="开票金额"
          required
          {...(overQuota ? { help: "超过可开票金额", validateStatus: "error" as const } : {})}
        >
          <Input
            aria-label="开票金额"
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
            style={{ width: 220 }}
            value={amount}
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
        {isCompany ? (
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
        ) : null}
        <Form.Item label="发票抬头" required>
          <Input
            aria-label="发票抬头"
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </Form.Item>
        {isCompany ? (
          <Form.Item extra="统一社会信用代码，15、17、18 或 20 位数字或字母" label="税号" required>
            <Input
              aria-label="税号"
              maxLength={20}
              onChange={(event) => setTaxNumber(event.target.value)}
              value={taxNumber}
            />
          </Form.Item>
        ) : null}
        <Form.Item label="备注">
          <Input
            aria-label="备注"
            maxLength={500}
            onChange={(event) => setRemark(event.target.value)}
            value={remark}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
