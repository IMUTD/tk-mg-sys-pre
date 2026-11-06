import { App, Button, Modal, Table, type TableColumnsType, Tag } from "antd"
import { type ReactNode, useState } from "react"

import "../mall/mall.css"

type ShipStatus = "pending" | "shipped"

type MerchantOrder = {
  amount: number
  buyer: string
  count: number
  id: string
  kind: "账号" | "代理"
  orderNo: string
  product: string
  status: ShipStatus
}

const STARTING_ORDERS: readonly MerchantOrder[] = [
  {
    amount: 100,
    buyer: "二组管理员",
    count: 2,
    id: "o1",
    kind: "账号",
    orderNo: "M20261106001",
    product: "日本满季度白号",
    status: "pending",
  },
  {
    amount: 200,
    buyer: "一组管理员",
    count: 1,
    id: "o2",
    kind: "代理",
    orderNo: "M20261106002",
    product: "全球动态住宅",
    status: "shipped",
  },
  {
    amount: 400,
    buyer: "三组管理员",
    count: 5,
    id: "o3",
    kind: "账号",
    orderNo: "M20261105018",
    product: "邮箱验证号",
    status: "pending",
  },
  {
    amount: 160,
    buyer: "一组管理员",
    count: 2,
    id: "o4",
    kind: "代理",
    orderNo: "M20261105009",
    product: "美国静态住宅",
    status: "pending",
  },
]

const money = (value: number): string => `¥${value.toLocaleString("zh-CN")}`

export const MerchantOrdersPage = (): ReactNode => {
  const { message } = App.useApp()
  const [orders, setOrders] = useState<MerchantOrder[]>(() =>
    STARTING_ORDERS.map((item) => ({ ...item })),
  )
  const [shipping, setShipping] = useState<MerchantOrder | null>(null)

  const columns: TableColumnsType<MerchantOrder> = [
    { dataIndex: "orderNo", title: "订单号", width: 150 },
    { dataIndex: "buyer", title: "买家" },
    { dataIndex: "kind", title: "类型", width: 80 },
    { dataIndex: "product", title: "商品" },
    { dataIndex: "count", title: "数量", width: 70 },
    { dataIndex: "amount", render: (value: number) => money(value), title: "金额", width: 90 },
    {
      dataIndex: "status",
      render: (value: ShipStatus) => (
        <Tag color={value === "shipped" ? "success" : "warning"}>
          {value === "shipped" ? "已发货" : "待发货"}
        </Tag>
      ),
      title: "状态",
      width: 90,
    },
    {
      render: (_value, order) =>
        order.status === "pending" ? (
          <Button onClick={() => setShipping(order)} size="small" type="primary">
            确认发货
          </Button>
        ) : (
          <span className="muted">已完成</span>
        ),
      title: "操作",
      width: 110,
    },
  ]

  return (
    <section className="module-page mall-page">
      <Table columns={columns} dataSource={orders} pagination={false} rowKey="id" size="small" />
      <Modal
        cancelText="取消"
        okText="确认发货"
        onCancel={() => setShipping(null)}
        onOk={() => {
          if (shipping === null) return
          setOrders((current) =>
            current.map((item) =>
              item.id === shipping.id ? { ...item, status: "shipped" } : item,
            ),
          )
          setShipping(null)
          message.success("已确认发货")
        }}
        open={shipping !== null}
        title="确认发货"
      >
        {shipping === null ? null : (
          <p>
            向「{shipping.buyer}」发出 {shipping.product} × {shipping.count}。
          </p>
        )}
      </Modal>
    </section>
  )
}
