import { useQuery } from "@tanstack/react-query"
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  Select,
  Space,
  Table,
  type TableColumnsType,
  Tag,
} from "antd"
import { type ReactNode, useState } from "react"

import { createMallApi, type MallApi, type OrderQuery } from "./api"
import {
  money,
  ORDER_STATUS_OPTIONS,
  ORDER_TYPE_OPTIONS,
  orderStatusLabel,
  type ShopOrder,
} from "./catalog"
import { MallGroupBar, useMallGroup } from "./group-wallet"
import "./mall.css"

const defaultApi = createMallApi()
const PAGE_SIZE = 20

const columns: TableColumnsType<ShopOrder> = [
  { dataIndex: "title", title: "订单标题", width: 110 },
  { dataIndex: "description", title: "订单描述" },
  { dataIndex: "product", title: "商品名" },
  {
    dataIndex: "total",
    render: (value: number) => money(value),
    title: "总价",
    width: 90,
  },
  {
    dataIndex: "deduction",
    render: (value: number) => money(value),
    title: "积分抵扣",
    width: 100,
  },
  {
    dataIndex: "finalPrice",
    render: (value: number) => money(value),
    title: "最终价格",
    width: 100,
  },
  { dataIndex: "delivery", title: "发货内容" },
  { dataIndex: "paidAt", title: "支付时间", width: 170 },
  { dataIndex: "createdAt", title: "创建时间", width: 170 },
  {
    dataIndex: "status",
    render: (value: ShopOrder["status"]) => (
      <Tag color={value === "paid" ? "success" : "warning"}>{orderStatusLabel(value)}</Tag>
    ),
    title: "状态",
    width: 90,
  },
]

export const MallOrdersPage = ({ api = defaultApi }: { readonly api?: MallApi }): ReactNode => {
  const { message } = App.useApp()
  const group = useMallGroup(api)
  const groupId = group.selected?.groupId ?? null
  const [type, setType] = useState("")
  const [status, setStatus] = useState("")
  const [keyword, setKeyword] = useState("")
  const [applied, setApplied] = useState({ keyword: "", status: "", type: "" })
  const [page, setPage] = useState(1)
  const query: OrderQuery = {
    page,
    pageSize: PAGE_SIZE,
    ...(applied.keyword.length > 0 ? { keyword: applied.keyword } : {}),
    ...(applied.status.length > 0 ? { status: applied.status } : {}),
    ...(applied.type.length > 0 ? { type: applied.type } : {}),
  }
  const orders = useQuery({
    enabled: groupId !== null,
    queryFn: () => api.orders(groupId ?? "", query),
    queryKey: ["mall", "orders", groupId, query],
  })

  return (
    <section className="module-page mall-page">
      <MallGroupBar state={group} />
      <Card size="small">
        <Space wrap>
          <Select
            allowClear
            aria-label="订单类型"
            onChange={(value) => setType(value ?? "")}
            options={[...ORDER_TYPE_OPTIONS]}
            placeholder="订单类型"
            style={{ width: 140 }}
            value={type.length === 0 ? null : type}
            virtual={false}
          />
          <Input
            allowClear
            aria-label="订单号"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="订单号"
            style={{ width: 180 }}
            value={keyword}
          />
          <Select
            allowClear
            aria-label="状态"
            onChange={(value) => setStatus(value ?? "")}
            options={[...ORDER_STATUS_OPTIONS]}
            placeholder="状态"
            style={{ width: 140 }}
            value={status.length === 0 ? null : status}
            virtual={false}
          />
          <Button
            onClick={() => {
              setPage(1)
              setApplied({ keyword: keyword.trim(), status, type })
            }}
            type="primary"
          >
            搜索
          </Button>
          <Button
            onClick={() => {
              setKeyword("")
              setStatus("")
              setType("")
              setPage(1)
              setApplied({ keyword: "", status: "", type: "" })
            }}
          >
            重置
          </Button>
          <Button onClick={() => message.success("导出成功")}>导出</Button>
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
    </section>
  )
}
