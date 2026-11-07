import { useQuery } from "@tanstack/react-query"
import { Alert, Button, Card, Input, Select, Space, Table, type TableColumnsType, Tag } from "antd"
import { type ReactNode, useState } from "react"

import { createMallApi, type LedgerQuery, type MallApi } from "./api"
import { POINT_TYPE_OPTIONS, type PointRecord, pointTypeLabel } from "./catalog"
import { MallGroupBar, useMallGroup } from "./group-wallet"
import "./mall.css"

const defaultApi = createMallApi()
const PAGE_SIZE = 20

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

export const MallRecordsPage = ({ api = defaultApi }: { readonly api?: MallApi }): ReactNode => {
  const group = useMallGroup(api)
  const groupId = group.selected?.groupId ?? null
  const [type, setType] = useState("")
  const [keyword, setKeyword] = useState("")
  const [applied, setApplied] = useState({ keyword: "", type: "" })
  const [page, setPage] = useState(1)
  const query: LedgerQuery = {
    page,
    pageSize: PAGE_SIZE,
    ...(applied.keyword.length > 0 ? { keyword: applied.keyword } : {}),
    ...(applied.type.length > 0 ? { type: applied.type } : {}),
  }
  const ledger = useQuery({
    enabled: groupId !== null,
    queryFn: () => api.ledger(groupId ?? "", query),
    queryKey: ["mall", "ledger", groupId, query],
  })

  return (
    <section className="module-page mall-page">
      <MallGroupBar state={group} />
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
            placeholder="备注"
            style={{ width: 220 }}
            value={keyword}
          />
          <Button
            onClick={() => {
              setPage(1)
              setApplied({ keyword: keyword.trim(), type })
            }}
            type="primary"
          >
            搜索
          </Button>
          <Button
            onClick={() => {
              setType("")
              setKeyword("")
              setPage(1)
              setApplied({ keyword: "", type: "" })
            }}
          >
            重置
          </Button>
        </Space>
      </Card>
      {ledger.isError ? <Alert title="积分记录加载失败，请稍后重试" type="error" /> : null}
      <Table
        columns={columns}
        dataSource={[...(ledger.data?.items ?? [])]}
        loading={ledger.isFetching}
        pagination={{
          current: page,
          onChange: setPage,
          pageSize: PAGE_SIZE,
          showSizeChanger: false,
          total: ledger.data?.total ?? 0,
        }}
        rowKey="id"
        scroll={{ x: "max-content" }}
        size="small"
      />
    </section>
  )
}
