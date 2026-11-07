import { useQuery } from "@tanstack/react-query"
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  Modal,
  Select,
  Space,
  Table,
  type TableColumnsType,
  Tag,
} from "antd"
import { type ReactNode, useState } from "react"

import { createMallApi, type MallApi, mallRequestError, type OrderQuery } from "./api"
import {
  ORDER_STATUS_OPTIONS,
  ORDER_TYPE_OPTIONS,
  orderStatusColor,
  orderStatusLabel,
  type ShopOrder,
} from "./catalog"
import { downloadCsv, toCsv } from "./export-csv"
import { MallGroupBar, useMallGroup } from "./group-wallet"
import "./mall.css"

const defaultApi = createMallApi()
const PAGE_SIZE = 20
const EXPORT_PAGE_SIZE = 100
/** 导出在浏览器里拼文件，太多会卡，也容易让人误以为导全了。 */
const MAX_EXPORT_ROWS = 10_000
const EXPORT_HEADERS = [
  "订单号",
  "订单标题",
  "订单描述",
  "商品名",
  "总价",
  "积分抵扣",
  "最终价格",
  "发货内容",
  "支付时间",
  "创建时间",
  "状态",
]

const ShipmentDialog = ({
  api,
  groupId,
  onClose,
  order,
}: {
  readonly api: MallApi
  readonly groupId: string
  readonly onClose: () => void
  readonly order: ShopOrder
}): ReactNode => {
  const items = useQuery({
    queryFn: () => api.orderItems(groupId, order.id),
    queryKey: ["mall", "order-items", groupId, order.id],
  })
  return (
    <Modal footer={null} onCancel={onClose} open title={`发货明细 ${order.orderNo}`}>
      {items.isError ? <Alert title="明细加载失败，请稍后重试" type="error" /> : null}
      <p className="muted">
        已转入当前分组，可以在账号管理或代理管理里查看。账号收到后建议尽快修改密码。
      </p>
      <Table
        columns={[{ dataIndex: "name", title: "名称" }]}
        dataSource={[...(items.data ?? [])]}
        loading={items.isPending}
        pagination={false}
        rowKey="id"
        scroll={{ y: 360 }}
        size="small"
      />
    </Modal>
  )
}

export const MallOrdersPage = ({ api = defaultApi }: { readonly api?: MallApi }): ReactNode => {
  const { message } = App.useApp()
  const group = useMallGroup(api)
  const groupId = group.selected?.groupId ?? null
  const [type, setType] = useState("")
  const [status, setStatus] = useState("")
  const [keyword, setKeyword] = useState("")
  const [applied, setApplied] = useState({ keyword: "", status: "", type: "" })
  const [page, setPage] = useState(1)
  const [viewing, setViewing] = useState<ShopOrder | null>(null)
  const [exporting, setExporting] = useState(false)
  const columns: TableColumnsType<ShopOrder> = [
    { dataIndex: "title", title: "订单标题", width: 110 },
    { dataIndex: "description", title: "订单描述" },
    { dataIndex: "product", title: "商品名" },
    { dataIndex: "total", title: "总价", width: 120 },
    { dataIndex: "deduction", title: "积分抵扣", width: 120 },
    { dataIndex: "finalPrice", title: "最终价格", width: 100 },
    {
      render: (_value, order) => (
        <Space size={4}>
          {order.delivery}
          {order.status === "shipped" ? (
            <Button
              aria-label={`查看明细${order.orderNo}`}
              onClick={() => setViewing(order)}
              size="small"
              type="link"
            >
              查看明细
            </Button>
          ) : null}
        </Space>
      ),
      title: "发货内容",
    },
    { dataIndex: "paidAt", title: "支付时间", width: 170 },
    { dataIndex: "createdAt", title: "创建时间", width: 170 },
    {
      dataIndex: "status",
      render: (value: ShopOrder["status"]) => (
        <Tag color={orderStatusColor(value)}>{orderStatusLabel(value)}</Tag>
      ),
      title: "状态",
      width: 90,
    },
  ]
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

  const exportOrders = async (): Promise<void> => {
    if (groupId === null) return
    setExporting(true)
    try {
      const rows: ShopOrder[] = []
      let total = 0
      for (let current = 1; ; current++) {
        const result = await api.orders(groupId, {
          ...query,
          page: current,
          pageSize: EXPORT_PAGE_SIZE,
        })
        rows.push(...result.items)
        total = result.total
        if (rows.length >= total || result.items.length === 0 || rows.length >= MAX_EXPORT_ROWS) {
          break
        }
      }
      if (rows.length === 0) {
        message.info("没有可导出的订单")
        return
      }
      downloadCsv(
        "我的订单.csv",
        toCsv(
          EXPORT_HEADERS,
          rows.map((order) => [
            order.orderNo,
            order.title,
            order.description,
            order.product,
            order.total,
            order.deduction,
            order.finalPrice,
            order.delivery,
            order.paidAt,
            order.createdAt,
            orderStatusLabel(order.status),
          ]),
        ),
      )
      if (rows.length < total) {
        message.warning(`共 ${total} 条，只导出了前 ${rows.length} 条，请缩小筛选范围`)
      } else {
        message.success(`已导出 ${rows.length} 条订单`)
      }
    } catch (error) {
      message.error(await mallRequestError(error))
    } finally {
      setExporting(false)
    }
  }

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
          <Button
            disabled={groupId === null}
            loading={exporting}
            onClick={() => void exportOrders()}
          >
            导出
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
      {viewing === null || groupId === null ? null : (
        <ShipmentDialog
          api={api}
          groupId={groupId}
          onClose={() => setViewing(null)}
          order={viewing}
        />
      )}
    </section>
  )
}
