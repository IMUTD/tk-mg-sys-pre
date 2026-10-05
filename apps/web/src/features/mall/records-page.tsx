import { Button, Card, Input, Select, Space, Table, type TableColumnsType, Tag } from "antd"
import { type ReactNode, useMemo, useState } from "react"

import {
  createSeedPoints,
  filterPoints,
  POINT_TYPE_OPTIONS,
  type PointRecord,
  pointTypeLabel,
} from "./catalog"
import "./mall.css"

const columns: TableColumnsType<PointRecord> = [
  {
    dataIndex: "type",
    render: (value: PointRecord["type"]) => (
      <Tag color={value === "recharge" ? "success" : "warning"}>{pointTypeLabel(value)}</Tag>
    ),
    title: "类型",
    width: 90,
  },
  {
    dataIndex: "delta",
    render: (value: number) => (value > 0 ? `+${value}` : `${value}`),
    title: "余额变动",
    width: 120,
  },
  { dataIndex: "balance", title: "余额", width: 100 },
  { dataIndex: "time", title: "操作时间", width: 180 },
  { dataIndex: "remark", title: "备注" },
  { dataIndex: "taskId", title: "任务ID", width: 100 },
]

export const MallRecordsPage = (): ReactNode => {
  const [type, setType] = useState("")
  const [keyword, setKeyword] = useState("")
  const [applied, setApplied] = useState({ keyword: "", type: "" })
  const rows = useMemo(
    () => filterPoints(createSeedPoints(), applied.type, applied.keyword),
    [applied],
  )

  return (
    <section className="module-page mall-page">
      <Card size="small">
        <Space wrap>
          <Select
            allowClear
            aria-label="类型"
            onChange={(value) => setType(value ?? "")}
            options={[...POINT_TYPE_OPTIONS]}
            placeholder="类型"
            style={{ width: 140 }}
            value={type.length === 0 ? null : type}
            virtual={false}
          />
          <Input
            allowClear
            aria-label="备注"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="备注 / 任务ID"
            style={{ width: 220 }}
            value={keyword}
          />
          <Button onClick={() => setApplied({ keyword, type })} type="primary">
            搜索
          </Button>
          <Button
            onClick={() => {
              setType("")
              setKeyword("")
              setApplied({ keyword: "", type: "" })
            }}
          >
            重置
          </Button>
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
