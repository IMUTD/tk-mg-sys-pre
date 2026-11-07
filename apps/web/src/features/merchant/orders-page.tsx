import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
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

import { type MallOrderRecord, mallRequestError } from "../mall/api"
import {
  formatTime,
  ORDER_STATUS_OPTIONS,
  orderStatusColor,
  orderStatusLabel,
  pointsText,
  productKindLabel,
} from "../mall/catalog"
import { createMerchantApi, type MerchantApi } from "./api"
import { ShipDialog, ShipmentRecordsDialog } from "./ship-dialog"
import "../mall/mall.css"

const defaultApi = createMerchantApi()
const PAGE_SIZE = 20
const STATUS_OPTIONS = ORDER_STATUS_OPTIONS.filter((item) =>
  ["pending_ship", "shipped", "refunded", "cancelled"].includes(item.value),
)

export const MerchantOrdersPage = ({
  api = defaultApi,
}: {
  readonly api?: MerchantApi
}): ReactNode => {
  const [status, setStatus] = useState("")
  const [keyword, setKeyword] = useState("")
  const [applied, setApplied] = useState({ keyword: "", status: "" })
  const [page, setPage] = useState(1)
  const [cancelling, setCancelling] = useState<MallOrderRecord | null>(null)
  const [shipping, setShipping] = useState<MallOrderRecord | null>(null)
  const [viewing, setViewing] = useState<MallOrderRecord | null>(null)
  const [refunding, setRefunding] = useState<MallOrderRecord | null>(null)
  const query = {
    page,
    pageSize: PAGE_SIZE,
    type: "resource" as const,
    ...(applied.keyword.length > 0 ? { keyword: applied.keyword } : {}),
    ...(applied.status.length > 0 ? { status: applied.status } : {}),
  }
  const orders = useQuery({
    queryFn: () => api.orders(query),
    queryKey: ["merchant", "orders", query],
  })

  const columns: TableColumnsType<MallOrderRecord> = [
    { dataIndex: "orderNo", title: "订单号", width: 200 },
    {
      render: (_value, order) => `${order.groupName}（${order.buyerName ?? "-"}）`,
      title: "买家",
    },
    {
      dataIndex: "productKind",
      render: (value: MallOrderRecord["productKind"]) =>
        value === null ? "-" : productKindLabel(value),
      title: "类型",
      width: 70,
    },
    { dataIndex: "product", title: "商品" },
    { dataIndex: "quantity", title: "数量", width: 70 },
    {
      dataIndex: "points",
      render: (value: number) => pointsText(value),
      title: "积分",
      width: 130,
    },
    {
      dataIndex: "createdAt",
      render: (value: string) => formatTime(value),
      title: "下单时间",
      width: 170,
    },
    {
      dataIndex: "status",
      render: (value: MallOrderRecord["status"]) => (
        <Tag color={orderStatusColor(value)}>{orderStatusLabel(value)}</Tag>
      ),
      title: "状态",
      width: 90,
    },
    {
      render: (_value, order) =>
        order.status === "pending_ship" ? (
          <Space>
            <Button
              aria-label={`发货${order.orderNo}`}
              onClick={() => setShipping(order)}
              size="small"
              type="primary"
            >
              确认发货
            </Button>
            <Button
              aria-label={`取消订单${order.orderNo}`}
              danger
              onClick={() => setCancelling(order)}
              size="small"
            >
              取消订单
            </Button>
          </Space>
        ) : order.status === "shipped" || order.status === "refunded" ? (
          <Space>
            <Button
              aria-label={`发货明细${order.orderNo}`}
              onClick={() => setViewing(order)}
              size="small"
              type="link"
            >
              发货明细
            </Button>
            {order.status === "shipped" ? (
              <Button
                aria-label={`退款${order.orderNo}`}
                danger
                onClick={() => setRefunding(order)}
                size="small"
              >
                退款
              </Button>
            ) : (
              <span className="muted">{order.cancelReason}</span>
            )}
          </Space>
        ) : (
          <span className="muted">{order.status === "cancelled" ? order.cancelReason : "-"}</span>
        ),
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
            options={[...STATUS_OPTIONS]}
            placeholder="状态"
            style={{ width: 140 }}
            value={status.length === 0 ? null : status}
            virtual={false}
          />
          <Input
            allowClear
            aria-label="订单号或商品"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="订单号或商品"
            style={{ width: 220 }}
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
      {orders.isError ? <Alert title="订单加载失败，请稍后重试" type="error" /> : null}
      <Table
        columns={columns}
        dataSource={[...(orders.data?.items ?? [])]}
        loading={orders.isFetching}
        pagination={{
          current: page,
          onChange: setPage,
          pageSize: PAGE_SIZE,
          showSizeChanger: false,
          total: orders.data?.total ?? 0,
        }}
        rowKey="id"
        scroll={{ x: "max-content" }}
        size="small"
      />
      {cancelling === null ? null : (
        <CancelDialog api={api} onClose={() => setCancelling(null)} order={cancelling} />
      )}
      {shipping === null ? null : (
        <ShipDialog api={api} onClose={() => setShipping(null)} order={shipping} />
      )}
      {refunding === null ? null : (
        <RefundDialog api={api} onClose={() => setRefunding(null)} order={refunding} />
      )}
      {viewing === null ? null : (
        <ShipmentRecordsDialog api={api} onClose={() => setViewing(null)} order={viewing} />
      )}
    </section>
  )
}

const RefundDialog = ({
  api,
  onClose,
  order,
}: {
  readonly api: MerchantApi
  readonly onClose: () => void
  readonly order: MallOrderRecord
}): ReactNode => {
  const { message } = App.useApp()
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [reclaim, setReclaim] = useState(true)
  const mutation = useMutation({
    mutationFn: () => api.refundOrder(order.id, { reason: reason.trim(), reclaim }),
    onError: async (error) => {
      message.error(await mallRequestError(error))
      await client.invalidateQueries({ queryKey: ["merchant", "orders"] })
    },
    onSuccess: async (result) => {
      message.success(
        `已退回 ${pointsText(result.points)}${
          result.reclaimed > 0 ? `，收回 ${result.reclaimed} 个` : ""
        }`,
      )
      onClose()
      await Promise.all([
        client.invalidateQueries({ queryKey: ["merchant"] }),
        client.invalidateQueries({ queryKey: ["mall"] }),
      ])
    },
  })
  return (
    <Modal
      cancelText="返回"
      confirmLoading={mutation.isPending}
      mask={{ closable: false }}
      okButtonProps={{ danger: true, disabled: reason.trim().length === 0 }}
      okText="确认退款"
      onCancel={onClose}
      onOk={() => mutation.mutate()}
      open
      title="订单退款"
    >
      <p>
        给「{order.groupName}」退回 {pointsText(order.points)}
        。退的是积分，不退现金，商品库存也不会自动增加。
      </p>
      <Form layout="vertical" size="small">
        <Form.Item label="退款原因" required>
          <Input.TextArea
            aria-label="退款原因"
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder="买家可以看到这条原因"
            rows={2}
            value={reason}
          />
        </Form.Item>
        <Checkbox checked={reclaim} onChange={(event) => setReclaim(event.target.checked)}>
          把发出的{order.productKind === "proxy" ? "代理" : "账号"}收回到原来的分组
        </Checkbox>
      </Form>
    </Modal>
  )
}

const CancelDialog = ({
  api,
  onClose,
  order,
}: {
  readonly api: MerchantApi
  readonly onClose: () => void
  readonly order: MallOrderRecord
}): ReactNode => {
  const { message } = App.useApp()
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const mutation = useMutation({
    mutationFn: () => api.cancelOrder(order.id, reason.trim()),
    onError: async (error) => {
      message.error(await mallRequestError(error))
      await client.invalidateQueries({ queryKey: ["merchant", "orders"] })
    },
    onSuccess: async () => {
      message.success(`已取消，${pointsText(order.points)}已退回「${order.groupName}」`)
      onClose()
      await Promise.all([
        client.invalidateQueries({ queryKey: ["merchant"] }),
        client.invalidateQueries({ queryKey: ["mall"] }),
      ])
    },
  })

  return (
    <Modal
      cancelText="返回"
      confirmLoading={mutation.isPending}
      mask={{ closable: false }}
      okButtonProps={{ danger: true, disabled: reason.trim().length === 0 }}
      okText="确认取消"
      onCancel={onClose}
      onOk={() => mutation.mutate()}
      open
      title="取消订单"
    >
      <p>
        取消「{order.groupName}」的 {order.product} × {order.quantity}，退回{" "}
        {pointsText(order.points)}并恢复库存。
      </p>
      <Form layout="vertical" size="small">
        <Form.Item label="取消原因" required>
          <Input.TextArea
            aria-label="取消原因"
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
