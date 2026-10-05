import { Table, type TableColumnsType } from "antd"
import { type ReactNode, useMemo } from "react"

import { createSeedSales, money, netSales, type SalesRow } from "./catalog"
import "./marketing.css"

const columns: TableColumnsType<SalesRow> = [
  { dataIndex: "name", title: "营销员", width: 120 },
  {
    dataIndex: "account",
    render: (value: number) => money(value),
    title: "账号销售额",
  },
  {
    dataIndex: "node",
    render: (value: number) => money(value),
    title: "节点销售额",
  },
  {
    dataIndex: "system",
    render: (value: number) => money(value),
    title: "系统销售额",
  },
  {
    dataIndex: "refund",
    render: (value: number) => money(value),
    title: "退款",
  },
  {
    key: "net",
    render: (_value: unknown, row: SalesRow) => money(netSales(row)),
    title: "净销售",
  },
  { dataIndex: "deals", title: "成交笔数", width: 100 },
]

export const SalesPage = (): ReactNode => {
  const rows = useMemo(
    () =>
      createSeedSales()
        .slice()
        .sort((left, right) => netSales(right) - netSales(left)),
    [],
  )
  return (
    <section className="module-page marketing-page">
      <Table
        columns={columns}
        dataSource={rows}
        pagination={false}
        rowKey="id"
        scroll={{ x: "max-content" }}
        size="small"
      />
    </section>
  )
}
