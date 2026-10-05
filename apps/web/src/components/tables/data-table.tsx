import { Table } from "antd"
import type { ReactNode } from "react"

import { adaptiveTableScroll } from "./adaptive-scroll"

export type TableColumn<Row> = {
  readonly cell: (row: Row) => ReactNode
  readonly fixed?: "left" | "right"
  readonly header: string
  readonly id: string
  readonly width?: number
}

export type ServerPage<Row> = {
  readonly items: readonly Row[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

type TableRow = { readonly id: string }

type DataTableProps<Row extends TableRow> = {
  readonly columns: readonly TableColumn<Row>[]
  readonly emptyMessage: string
  readonly onPageChange: (page: number) => void
  readonly page: ServerPage<Row>
}

export const DataTable = <Row extends TableRow>({
  columns,
  emptyMessage,
  onPageChange,
  page,
}: DataTableProps<Row>): ReactNode => (
  <section aria-label="数据列表" className="data-table">
    <Table
      columns={columns.map((column) => ({
        dataIndex: column.id,
        key: column.id,
        render: (_value: unknown, row: Row) => column.cell(row),
        title: column.header,
        ...(column.fixed === undefined ? {} : { fixed: column.fixed }),
        ...(column.width === undefined ? {} : { width: column.width }),
      }))}
      dataSource={[...page.items]}
      locale={{ emptyText: emptyMessage }}
      pagination={{
        current: page.page,
        hideOnSinglePage: false,
        onChange: onPageChange,
        pageSize: page.pageSize,
        showSizeChanger: false,
        showTotal: (total, range) => `显示 ${range[0]}-${range[1]}，共 ${total} 条`,
        total: page.total,
      }}
      rowKey="id"
      scroll={adaptiveTableScroll}
    />
  </section>
)
