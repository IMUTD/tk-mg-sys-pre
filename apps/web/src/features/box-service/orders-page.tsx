import {
  Button,
  Card,
  Input,
  Modal,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd"
import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "../../lib/api/api-fetch"

import { BoxFeesPanel } from "./fees-panel"

type OrderStatus = "pending" | "paid" | "closed" | "refunded"

type OrderRow = {
  readonly alipayTradeNo: string
  readonly amount: string
  readonly buyerEmail?: string
  readonly buyerName?: string
  readonly createdAt: string
  readonly deviceMissing: boolean
  readonly externalId: string
  readonly host: string
  readonly months: number
  readonly name: string
  readonly outTradeNo: string
  readonly paidAt: string | null
  readonly refundReason: string
  readonly refundedAt: string | null
  readonly status: OrderStatus
}

type OrderList = {
  readonly orders: readonly OrderRow[]
  readonly page: number
  readonly pageSize: number
  readonly scope: "all" | "own"
  readonly summary: {
    readonly paidAmount: string
    readonly paidCount: number
    readonly pendingCount: number
    readonly refundedAmount: string
    readonly refundedCount: number
  }
  readonly total: number
}

const statusLabel: Record<OrderStatus, string> = {
  closed: "已关闭",
  paid: "已支付",
  pending: "待支付",
  refunded: "已退款",
}

const statusColor: Record<OrderStatus, string> = {
  closed: "default",
  paid: "success",
  pending: "processing",
  refunded: "warning",
}

const monthLabel = (months: number): string => {
  if (months === 1) return "一个月"
  if (months === 3) return "三个月"
  if (months === 6) return "六个月"
  if (months === 12) return "一年"
  return `${months} 个月`
}

const formatTime = (value: string | null): string => {
  if (value === null || value === "") return "—"
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return "—"
  return time.toLocaleString("zh-CN", { hour12: false })
}

const readError = async (response: Response): Promise<string> => {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? "请求失败"
}

const BoxOrdersPanel = () => {
  const [status, setStatus] = useState<"" | OrderStatus>("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [keyword, setKeyword] = useState("")
  const [applied, setApplied] = useState({
    from: "",
    keyword: "",
    status: "" as "" | OrderStatus,
    to: "",
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [list, setList] = useState<OrderList | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [reconciling, setReconciling] = useState("")
  const [refunding, setRefunding] = useState<OrderRow | null>(null)
  const [refundReason, setRefundReason] = useState("")
  const [refundError, setRefundError] = useState("")
  const [refundSending, setRefundSending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    })
    if (applied.status !== "") params.set("status", applied.status)
    if (applied.from !== "") params.set("from", applied.from)
    if (applied.to !== "") params.set("to", applied.to)
    if (applied.keyword !== "") params.set("q", applied.keyword)
    const response = await apiFetch(`/api/box-service/orders?${params.toString()}`, {
      credentials: "include",
    })
    setLoading(false)
    if (!response.ok) {
      setError(await readError(response))
      return
    }
    setList((await response.json()) as OrderList)
    setError("")
  }, [applied, page, pageSize])

  useEffect(() => {
    void load()
  }, [load])

  const search = () => {
    setPage(1)
    setApplied({ from, keyword: keyword.trim(), status, to })
  }

  const reconcile = async (outTradeNo: string) => {
    setReconciling(outTradeNo)
    setError("")
    const response = await apiFetch("/api/box-service/orders/reconcile", {
      body: JSON.stringify({ outTradeNo }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    setReconciling("")
    if (!response.ok) {
      setError(await readError(response))
      return
    }
    await load()
  }

  const openRefund = (row: OrderRow) => {
    setRefunding(row)
    setRefundReason("")
    setRefundError("")
  }

  const refund = async () => {
    if (refunding === null) return
    setRefundSending(true)
    const response = await apiFetch(
      `/api/box-service/orders/${encodeURIComponent(refunding.outTradeNo)}/refund`,
      {
        body: JSON.stringify({ reason: refundReason.trim() }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    )
    setRefundSending(false)
    if (!response.ok) {
      setRefundError(await readError(response))
      return
    }
    setRefunding(null)
    await load()
  }

  const scope = list?.scope ?? "own"
  const summary = list?.summary

  return (
    <>
      <Typography.Paragraph type="secondary">
        {scope === "all" ? "系统账号查看全部时长订单。" : "这里显示你和下级账号的消费。"}
      </Typography.Paragraph>
      <div style={{ display: "flex", gap: 32, marginBottom: 16 }}>
        <Statistic prefix="¥" title="已支付金额" value={summary?.paidAmount ?? "0.00"} />
        <Statistic title="已支付笔数" value={summary?.paidCount ?? 0} />
        <Statistic title="待支付笔数" value={summary?.pendingCount ?? 0} />
        <Statistic prefix="¥" title="已退款金额" value={summary?.refundedAmount ?? "0.00"} />
      </div>
      <Space wrap style={{ display: "flex", marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 120 }}
          value={status || undefined}
          options={[
            { label: "待支付", value: "pending" },
            { label: "已支付", value: "paid" },
            { label: "已关闭", value: "closed" },
            { label: "已退款", value: "refunded" },
          ]}
          onChange={(value) => setStatus(value ?? "")}
        />
        <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        <Input
          allowClear
          placeholder={scope === "all" ? "订单号、设备 ID、买家" : "订单号、设备 ID"}
          style={{ width: 260 }}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onPressEnter={search}
        />
        <Button type="primary" onClick={search}>
          查询
        </Button>
      </Space>
      {error !== "" ? <Typography.Paragraph type="danger">{error}</Typography.Paragraph> : null}
      <Table<OrderRow>
        rowKey="outTradeNo"
        loading={loading}
        scroll={{ x: 1280 }}
        dataSource={[...(list?.orders ?? [])]}
        pagination={{
          current: page,
          pageSize,
          showSizeChanger: true,
          total: list?.total ?? 0,
          onChange: (nextPage, nextSize) => {
            setPage(nextPage)
            setPageSize(nextSize)
          },
        }}
        columns={[
          {
            title: "下单时间",
            dataIndex: "createdAt",
            render: (value: string) => formatTime(value),
            width: 180,
          },
          { title: "商户订单号", dataIndex: "outTradeNo" },
          ...(scope === "all"
            ? [
                {
                  title: "买家",
                  render: (_value: unknown, row: OrderRow) =>
                    row.buyerName || row.buyerEmail || "—",
                },
              ]
            : []),
          { title: "设备 ID", dataIndex: "externalId" },
          {
            title: "时长",
            dataIndex: "months",
            render: (value: number) => monthLabel(value),
            width: 90,
          },
          { title: "金额", dataIndex: "amount", render: (value: string) => `¥${value}`, width: 90 },
          {
            title: "状态",
            dataIndex: "status",
            width: 100,
            render: (value: OrderStatus, row: OrderRow) => {
              const tag = <Tag color={statusColor[value]}>{statusLabel[value]}</Tag>
              if (value === "paid" && row.deviceMissing)
                return (
                  <Tooltip title="付款时这台盒子已不存在，时长没有加上，需要人工处理或退款">
                    <Space size={4}>
                      {tag}
                      <Tag color="error">盒子不存在</Tag>
                    </Space>
                  </Tooltip>
                )
              if (value !== "refunded") return tag
              return (
                <Tooltip title={`${formatTime(row.refundedAt)} ${row.refundReason}`}>{tag}</Tooltip>
              )
            },
          },
          {
            title: "支付时间",
            dataIndex: "paidAt",
            render: (value: string | null) => formatTime(value),
            width: 180,
          },
          {
            title: "操作",
            width: 140,
            render: (_value: unknown, row: OrderRow) => {
              // A closed order may still have been paid if Alipay's notify never arrived.
              if (row.status === "pending" || row.status === "closed")
                return (
                  <Button
                    loading={reconciling === row.outTradeNo}
                    onClick={() => void reconcile(row.outTradeNo)}
                  >
                    查询支付结果
                  </Button>
                )
              if (row.status === "paid" && scope === "all")
                return (
                  <Button danger onClick={() => openRefund(row)}>
                    退款
                  </Button>
                )
              return "—"
            },
          },
        ]}
      />
      <Modal
        destroyOnHidden
        okButtonProps={{ danger: true, disabled: refundReason.trim() === "" }}
        okText="确认退款"
        open={refunding !== null}
        title="整单退款"
        confirmLoading={refundSending}
        onCancel={() => setRefunding(null)}
        onOk={() => void refund()}
      >
        {refunding === null ? null : (
          <>
            <Typography.Paragraph>
              退回 ¥{refunding.amount} 到买家支付宝，并从设备 {refunding.externalId} 扣掉{" "}
              {monthLabel(refunding.months)}时长。扣完已过期的盒子会马上不能下发新任务。
            </Typography.Paragraph>
            <Input.TextArea
              maxLength={200}
              placeholder="退款原因"
              value={refundReason}
              onChange={(event) => setRefundReason(event.target.value)}
            />
            {refundError !== "" ? (
              <Typography.Paragraph style={{ marginTop: 8 }} type="danger">
                {refundError}
              </Typography.Paragraph>
            ) : null}
          </>
        )}
      </Modal>
    </>
  )
}

export const BoxOrdersPage = () => (
  <Card title="时长订单">
    <Tabs
      destroyOnHidden
      items={[
        { children: <BoxOrdersPanel />, key: "orders", label: "时长订单" },
        { children: <BoxFeesPanel />, key: "fees", label: "费用记录" },
      ]}
    />
  </Card>
)
