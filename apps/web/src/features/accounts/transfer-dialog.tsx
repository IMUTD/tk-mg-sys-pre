import { Alert, Button, Input, Modal, Space, Table, Tag } from "antd"
import { type ReactNode, useMemo, useState } from "react"
import { useFilteredRowSelection } from "../../components/tables/filtered-selection"
import { PageKey } from "../../lib/pages"
import { BusinessLabelFilter, UNASSIGNED_VALUE } from "../labels/filter-row"
import { hideMiddle, type TransferStatistic } from "./myt-account"

type TransferDialogProps = {
  readonly canWrite: boolean
  readonly onCancel: () => void
  readonly onCopy: (value: string) => void
  readonly onExport: (rows: readonly TransferStatistic[]) => void
  readonly onCreate?: (() => void) | undefined
  readonly onMerge: (keys: readonly string[]) => void
  readonly onRedeem?: ((code: string) => void) | undefined
  readonly onRevoke: (key: string, count: number) => void
  readonly onSplit: (key: string, count: number) => void
  readonly rows: readonly TransferStatistic[]
}

export const TransferDialog = ({
  canWrite,
  onCancel,
  onCopy,
  onExport,
  onCreate,
  onMerge,
  onRedeem,
  onRevoke,
  onSplit,
  rows,
}: TransferDialogProps): ReactNode => {
  const [keyFilter, setKeyFilter] = useState("")
  const [redeemCode, setRedeemCode] = useState("")
  const [tagFilter, setTagFilter] = useState("")
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([])
  const filtered = useMemo(() => {
    const key = keyFilter.trim().toLowerCase()
    const tag = tagFilter.trim().toLowerCase()
    return rows.filter((row) => {
      const matchKey = key.length === 0 || row.transferKey.toLowerCase().includes(key)
      const matchTag =
        tagFilter === UNASSIGNED_VALUE
          ? row.tags.trim().length === 0
          : tag.length === 0 || row.tags.toLowerCase().includes(tag)
      return matchKey && matchTag
    })
  }, [keyFilter, rows, tagFilter])
  const transferSelection = useFilteredRowSelection({
    onChange: (keys) => setSelectedKeys(keys.map((key) => String(key))),
    rowKey: "transferKey",
    rows: filtered,
    selectedKeys: selectedKeys,
  })

  return (
    <Modal footer={null} onCancel={onCancel} open title="转移码统计" width="80%">
      <Alert
        message="转移码用于账号转移,请勿泄露给他人,转移码一旦使用将会失效"
        showIcon
        type="warning"
      />
      <Space className="statistic-toolbar" wrap>
        {canWrite && onCreate !== undefined ? (
          <Button onClick={onCreate} type="primary">
            为选中账号生成
          </Button>
        ) : null}
        {canWrite ? (
          <Button
            disabled={selectedKeys.length < 2}
            onClick={() => onMerge(selectedKeys)}
            type="primary"
          >
            合并转移码
          </Button>
        ) : null}
        {canWrite && onRedeem !== undefined ? (
          <>
            <Input
              allowClear
              aria-label="兑换转移码"
              onChange={(event) => setRedeemCode(event.target.value)}
              placeholder="输入转移码兑换到当前分组"
              style={{ width: 260 }}
              value={redeemCode}
            />
            <Button
              disabled={redeemCode.trim().length === 0}
              onClick={() => onRedeem(redeemCode.trim())}
            >
              兑换
            </Button>
          </>
        ) : null}
        <Button disabled={filtered.length === 0} onClick={() => onExport(filtered)}>
          导出 CSV
        </Button>
        <Input
          allowClear
          aria-label="筛选转移码"
          onChange={(event) => setKeyFilter(event.target.value)}
          placeholder="筛选转移码"
          style={{ width: 260 }}
          value={keyFilter}
        />
      </Space>
      <BusinessLabelFilter
        page={PageKey.Accounts}
        blankLabel="未分组"
        title="筛选包含分组"
        value={tagFilter}
        onChange={setTagFilter}
      />
      <Table
        columns={[
          {
            dataIndex: "transferKey",
            key: "transferKey",
            render: (value: string) => (
              <Tag onClick={() => onCopy(value)} style={{ cursor: "pointer" }}>
                {hideMiddle(value)}
              </Tag>
            ),
            title: "转移码",
          },
          { dataIndex: "tags", key: "tags", title: "包含分组" },
          {
            dataIndex: "count",
            key: "count",
            sorter: (left, right) => left.count - right.count,
            title: "剩余数量",
          },
          ...(canWrite
            ? [
                {
                  align: "center" as const,
                  fixed: "right" as const,
                  key: "actions",
                  render: (_value: unknown, row: TransferStatistic) => (
                    <Space>
                      <Button
                        onClick={() => onSplit(row.transferKey, row.count)}
                        size="small"
                        type="primary"
                      >
                        拆分
                      </Button>
                      <Button
                        danger
                        onClick={() => onRevoke(row.transferKey, row.count)}
                        size="small"
                      >
                        撤销
                      </Button>
                    </Space>
                  ),
                  title: "操作",
                  width: 180,
                },
              ]
            : []),
        ]}
        dataSource={filtered}
        pagination={false}
        rowKey="transferKey"
        rowSelection={transferSelection}
        scroll={{ x: "max-content" }}
        size="small"
      />
    </Modal>
  )
}
