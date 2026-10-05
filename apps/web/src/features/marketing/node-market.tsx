import { App, Button, Card, Select, Space, Table, type TableColumnsType, Tag } from "antd"
import { type ReactNode, useMemo, useState } from "react"

import {
  applyNodeOffer,
  createSeedNodes,
  emptyNodeQuery,
  filterNodes,
  type MarketNode,
  money,
  NODE_STATUS_OPTIONS,
  NODE_TYPE_OPTIONS,
  type NodeQuery,
  nodeTypeLabel,
  uniqueValues,
} from "./catalog"
import "./marketing.css"
import { NodeOfferDialog } from "./offer-dialog"

const columns = (onUpdate: (row: MarketNode) => void): TableColumnsType<MarketNode> => [
  { dataIndex: "name", title: "名称" },
  {
    dataIndex: "type",
    render: (value: MarketNode["type"]) => nodeTypeLabel(value),
    title: "类型",
    width: 90,
  },
  { dataIndex: "region", title: "地区", width: 90 },
  { dataIndex: "bandwidth", title: "带宽", width: 110 },
  { dataIndex: "stock", title: "库存", width: 80 },
  {
    dataIndex: "price",
    render: (value: number) => money(value),
    title: "价格",
    width: 90,
  },
  {
    dataIndex: "status",
    render: (value: MarketNode["status"]) =>
      value === "stock" ? <Tag color="success">在售</Tag> : <Tag>售罄</Tag>,
    title: "状态",
    width: 90,
  },
  {
    align: "center",
    fixed: "right",
    key: "action",
    render: (_value: unknown, row: MarketNode) => (
      <Button onClick={() => onUpdate(row)} size="small" type="link">
        更新
      </Button>
    ),
    title: "操作",
    width: 80,
  },
]

export const NodeMarketPage = (): ReactNode => {
  const { message } = App.useApp()
  const [query, setQuery] = useState<NodeQuery>(emptyNodeQuery)
  const [nodes, setNodes] = useState(createSeedNodes)
  const [editing, setEditing] = useState<MarketNode | null>(null)
  const rows = filterNodes(nodes, query)
  const regions = useMemo(() => uniqueValues(nodes.map((item) => item.region)), [nodes])

  return (
    <section className="module-page marketing-page">
      <Card>
        <Space wrap>
          <Select
            allowClear
            aria-label="类型"
            onChange={(value) => setQuery((current) => ({ ...current, type: value ?? "" }))}
            options={[...NODE_TYPE_OPTIONS]}
            placeholder="类型"
            style={{ width: 140 }}
            value={query.type.length === 0 ? null : query.type}
            virtual={false}
          />
          <Select
            allowClear
            aria-label="状态"
            onChange={(value) => setQuery((current) => ({ ...current, status: value ?? "" }))}
            options={[...NODE_STATUS_OPTIONS]}
            placeholder="状态"
            style={{ width: 140 }}
            value={query.status.length === 0 ? null : query.status}
            virtual={false}
          />
          <Select
            allowClear
            aria-label="地区"
            onChange={(value) => setQuery((current) => ({ ...current, region: value ?? "" }))}
            options={regions}
            placeholder="地区"
            style={{ width: 140 }}
            value={query.region.length === 0 ? null : query.region}
            virtual={false}
          />
        </Space>
      </Card>
      <Table
        columns={columns((row) => setEditing(row))}
        dataSource={rows}
        pagination={false}
        rowKey="id"
        scroll={{ x: "max-content" }}
        size="small"
      />
      {editing === null ? null : (
        <NodeOfferDialog
          onCancel={() => setEditing(null)}
          onSubmit={(record) => {
            setNodes((current) =>
              current.map((item) => (item.id === record.id ? applyNodeOffer(item, record) : item)),
            )
            setEditing(null)
            message.success("更新成功")
          }}
          record={editing}
        />
      )}
    </section>
  )
}
