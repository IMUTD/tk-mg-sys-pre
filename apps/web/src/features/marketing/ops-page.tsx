import { Table, type TableColumnsType } from "antd"
import { type ReactNode, useMemo } from "react"

import { createSeedOps, type OpsRow, soldRate } from "./catalog"
import "./marketing.css"

const columns: TableColumnsType<OpsRow> = [
  { dataIndex: "name", title: "运营员", width: 120 },
  { dataIndex: "remaining", title: "剩余成品" },
  { dataIndex: "total", title: "总账号数" },
  { dataIndex: "sold", title: "售出账号数" },
  { dataIndex: "windowedLeft", title: "剩余开窗" },
  { dataIndex: "kiloLeft", title: "剩余千粉" },
  { dataIndex: "scrap", title: "报废" },
  {
    key: "rate",
    render: (_value: unknown, row: OpsRow) => `${soldRate(row)}%`,
    title: "售出率",
  },
]

export const OpsPage = (): ReactNode => {
  const rows = useMemo(() => createSeedOps(), [])
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
