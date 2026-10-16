import { Button, Modal, Progress, Space, Table, Tag } from "antd"
import { type ReactNode, useMemo, useState } from "react"
import { useFilteredRowSelection } from "../../components/tables/filtered-selection"
import { PageKey } from "../../lib/pages"
import { BusinessLabelFilter } from "../labels/filter-row"
import { type AccountTagStatistic, bannedRate } from "./myt-account"

type StatisticsDialogProps = {
  readonly accountInfoCount: number
  readonly canWrite: boolean
  readonly onBatchCheck: (tags: readonly string[]) => void
  readonly onCancel: () => void
  readonly onCheck: (tag: string) => void
  readonly onCopyTag: (tag: string) => void
  readonly onDeleteAll: (tag: string) => void
  readonly onDeleteBanned: (tag: string) => void
  readonly onReset: (tag: string) => void
  readonly rows: readonly AccountTagStatistic[]
}

export const AccountStatisticsDialog = ({
  accountInfoCount,
  canWrite,
  onBatchCheck,
  onCancel,
  onCheck,
  onCopyTag,
  onDeleteAll,
  onDeleteBanned,
  onReset,
  rows,
}: StatisticsDialogProps): ReactNode => {
  const [keyword, setKeyword] = useState("")
  const [selectedTags, setSelectedTags] = useState<readonly string[]>([])
  const filtered = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    return text.length === 0
      ? [...rows]
      : rows.filter((row) => row.tag.toLowerCase().includes(text))
  }, [keyword, rows])
  const statisticsSelection = useFilteredRowSelection({
    onChange: (keys) => setSelectedTags(keys.map((key) => String(key))),
    rowKey: "tag",
    rows: filtered,
    selectedKeys: selectedTags,
  })
  const selectedCount = selectedTags.reduce((sum, tag) => {
    const row = rows.find((item) => item.tag === tag)
    return sum + (row?.available ?? 0)
  }, 0)

  return (
    <Modal footer={null} onCancel={onCancel} open title="统计" width="80%">
      <BusinessLabelFilter
        page={PageKey.Accounts}
        title="过滤分组"
        options={rows.map((row) => ({ value: row.tag, label: row.tag }))}
        value={keyword}
        onChange={setKeyword}
      />
      <Space className="statistic-toolbar" wrap>
        {canWrite ? (
          <Button
            disabled={selectedTags.length === 0}
            onClick={() => onBatchCheck(selectedTags)}
            type="primary"
          >
            批量检查 {selectedCount > 0 ? `(${selectedCount}/10000)` : ""}
          </Button>
        ) : null}
        <Tag color="red">今日剩余检测次数: {accountInfoCount}</Tag>
      </Space>
      <Table
        columns={[
          {
            dataIndex: "tag",
            key: "tag",
            render: (tag: string) => (
              <Tag onClick={() => onCopyTag(tag)} style={{ cursor: "pointer" }}>
                {tag}
              </Tag>
            ),
            title: "分组",
            width: 220,
          },
          {
            dataIndex: "total",
            key: "total",
            sorter: (left, right) => left.total - right.total,
            title: "总数",
            width: 80,
          },
          {
            dataIndex: "baned",
            key: "baned",
            sorter: (left, right) => left.baned - right.baned,
            title: "封号",
            width: 80,
          },
          {
            key: "baned_rate",
            render: (_value: unknown, row: AccountTagStatistic) => (
              <Progress percent={bannedRate(row)} size="small" status="normal" />
            ),
            title: "封号率",
          },
          {
            dataIndex: "available",
            key: "available",
            sorter: (left, right) => left.available - right.available,
            title: "可用",
            width: 80,
          },
          { dataIndex: "transferred", key: "transferred", title: "已转移", width: 80 },
          ...(canWrite
            ? [
                {
                  align: "center" as const,
                  fixed: "right" as const,
                  key: "actions",
                  render: (_value: unknown, row: AccountTagStatistic) => (
                    <Space wrap>
                      <Button onClick={() => onCheck(row.tag)} size="small" type="primary">
                        检查
                      </Button>
                      <Button danger onClick={() => onDeleteBanned(row.tag)} size="small">
                        封号
                      </Button>
                      <Button onClick={() => onReset(row.tag)} size="small" type="primary">
                        重置
                      </Button>
                      <Button danger onClick={() => onDeleteAll(row.tag)} size="small">
                        全部删除
                      </Button>
                    </Space>
                  ),
                  title: "操作",
                  width: 360,
                },
              ]
            : []),
        ]}
        dataSource={filtered}
        pagination={{
          pageSize: 100,
          pageSizeOptions: [50, 100, 200],
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 个分组`,
        }}
        rowKey="tag"
        rowSelection={statisticsSelection}
        scroll={{ x: "max-content" }}
        size="small"
        summary={() => {
          const total = filtered.reduce(
            (sum, row) => ({
              available: sum.available + row.available,
              baned: sum.baned + row.baned,
              total: sum.total + row.total,
              transferred: sum.transferred + row.transferred,
            }),
            { available: 0, baned: 0, total: 0, transferred: 0 },
          )
          return (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} />
              <Table.Summary.Cell index={1}>合计</Table.Summary.Cell>
              <Table.Summary.Cell index={2}>{total.total}</Table.Summary.Cell>
              <Table.Summary.Cell index={3}>{total.baned}</Table.Summary.Cell>
              <Table.Summary.Cell index={4}>
                {total.total > 0 ? `${Math.floor((total.baned / total.total) * 100)}%` : "0%"}
              </Table.Summary.Cell>
              <Table.Summary.Cell index={5}>{total.available}</Table.Summary.Cell>
              <Table.Summary.Cell index={6}>{total.transferred}</Table.Summary.Cell>
              {canWrite ? <Table.Summary.Cell index={7} /> : null}
            </Table.Summary.Row>
          )
        }}
      />
    </Modal>
  )
}
