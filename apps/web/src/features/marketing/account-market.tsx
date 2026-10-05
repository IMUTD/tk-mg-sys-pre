import { App, Button, Card, Select, Space, Table, type TableColumnsType, Tag } from "antd"
import { type ReactNode, useMemo, useState } from "react"

import {
  ACCOUNT_STATUS_OPTIONS,
  ACCOUNT_TYPE_OPTIONS,
  type AccountQuery,
  accountStatusColor,
  accountStatusLabel,
  accountTypeLabel,
  applyAccountOffer,
  createSeedAccounts,
  emptyAccountQuery,
  filterAccounts,
  type MarketAccount,
  money,
  uniqueValues,
  WINDOW_OPTIONS,
} from "./catalog"
import "./marketing.css"
import { AccountOfferDialog } from "./offer-dialog"

const columns = (onUpdate: (row: MarketAccount) => void): TableColumnsType<MarketAccount> => [
  { dataIndex: "sku", title: "货号", width: 120 },
  {
    dataIndex: "type",
    render: (value: MarketAccount["type"]) => accountTypeLabel(value),
    title: "类型",
    width: 100,
  },
  { dataIndex: "platform", title: "平台", width: 90 },
  { dataIndex: "followers", title: "粉丝量", width: 90 },
  {
    dataIndex: "windowed",
    render: (value: boolean) => (value ? <Tag color="processing">已开窗</Tag> : <Tag>未开窗</Tag>),
    title: "开窗",
    width: 90,
  },
  { dataIndex: "operator", title: "运营员", width: 100 },
  { dataIndex: "region", title: "地区", width: 90 },
  {
    dataIndex: "price",
    render: (value: number) => money(value),
    title: "价格",
    width: 100,
  },
  {
    dataIndex: "status",
    render: (value: MarketAccount["status"]) => (
      <Tag color={accountStatusColor(value)}>{accountStatusLabel(value)}</Tag>
    ),
    title: "状态",
    width: 90,
  },
  { dataIndex: "lastActive", title: "最近活跃", width: 120 },
  {
    align: "center",
    fixed: "right",
    key: "action",
    render: (_value: unknown, row: MarketAccount) => (
      <Button onClick={() => onUpdate(row)} size="small" type="link">
        更新
      </Button>
    ),
    title: "操作",
    width: 80,
  },
]

export const AccountMarketPage = (): ReactNode => {
  const { message } = App.useApp()
  const [query, setQuery] = useState<AccountQuery>(emptyAccountQuery)
  const [accounts, setAccounts] = useState(createSeedAccounts)
  const [editing, setEditing] = useState<MarketAccount | null>(null)
  const rows = filterAccounts(accounts, query)
  const regions = useMemo(() => uniqueValues(accounts.map((item) => item.region)), [accounts])

  return (
    <section className="module-page marketing-page">
      <Card>
        <Space wrap>
          <Select
            allowClear
            aria-label="类型"
            onChange={(value) => setQuery((current) => ({ ...current, type: value ?? "" }))}
            options={[...ACCOUNT_TYPE_OPTIONS]}
            placeholder="类型"
            style={{ width: 140 }}
            value={query.type.length === 0 ? null : query.type}
            virtual={false}
          />
          <Select
            allowClear
            aria-label="状态"
            onChange={(value) => setQuery((current) => ({ ...current, status: value ?? "" }))}
            options={[...ACCOUNT_STATUS_OPTIONS]}
            placeholder="状态"
            style={{ width: 140 }}
            value={query.status.length === 0 ? null : query.status}
            virtual={false}
          />
          <Select
            allowClear
            aria-label="开窗"
            onChange={(value) => setQuery((current) => ({ ...current, windowed: value ?? "" }))}
            options={[...WINDOW_OPTIONS]}
            placeholder="开窗"
            style={{ width: 140 }}
            value={query.windowed.length === 0 ? null : query.windowed}
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
        <AccountOfferDialog
          onCancel={() => setEditing(null)}
          onSubmit={(record) => {
            setAccounts((current) =>
              current.map((item) =>
                item.id === record.id ? applyAccountOffer(item, record) : item,
              ),
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
