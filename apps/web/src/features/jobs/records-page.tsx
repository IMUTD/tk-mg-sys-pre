import { App, Button, Card, Input, Space, Table, type TableColumnsType } from "antd"
import { type ReactNode, useMemo, useState } from "react"

import { createSeedTaskLogs, type TaskLog } from "./catalog"
import "../mall/mall.css"

const columns: TableColumnsType<TaskLog> = [
  { dataIndex: "id", title: "记录ID", width: 120 },
  { dataIndex: "feature", title: "功能", width: 140 },
  { dataIndex: "content", title: "内容" },
  { dataIndex: "createdAt", title: "创建时间", width: 180 },
  { dataIndex: "updatedAt", title: "更新时间", width: 180 },
]

export const TaskRecordsPage = (): ReactNode => {
  const { message } = App.useApp()
  const [keyword, setKeyword] = useState("")
  const [applied, setApplied] = useState("")
  const rows = useMemo(
    () =>
      createSeedTaskLogs().filter((item) => {
        if (applied.length === 0) return true
        return item.feature.includes(applied) || item.content.includes(applied)
      }),
    [applied],
  )

  return (
    <section className="module-page jobs-page">
      <Card size="small">
        <Space wrap>
          <Input
            allowClear
            aria-label="功能"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="功能"
            style={{ width: 200 }}
            value={keyword}
          />
          <Button onClick={() => setApplied(keyword)} type="primary">
            搜索
          </Button>
          <Button
            onClick={() => {
              setKeyword("")
              setApplied("")
            }}
          >
            重置
          </Button>
          <Button onClick={() => message.success("导出成功")}>导出</Button>
        </Space>
      </Card>
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
