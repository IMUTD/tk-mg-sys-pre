import { App, Button, Input, Modal, Space, Table } from "antd"
import type { ReactNode } from "react"
import { useState } from "react"
import { useFilteredRowSelection } from "../../components/tables/filtered-selection"

import type { TagStatistic } from "./tk-reg-resource"

type StatisticsDialogProps = {
  readonly canWrite: boolean
  readonly onCancel: () => void
  readonly onDeleteAll: (tags: readonly string[]) => void
  readonly onDeleteUsed: (tags: readonly string[]) => void
  readonly rows: readonly TagStatistic[]
}

export const StatisticsDialog = ({
  canWrite,
  onCancel,
  onDeleteAll,
  onDeleteUsed,
  rows,
}: StatisticsDialogProps): ReactNode => {
  const { message, modal } = App.useApp()
  const [confirmText, setConfirmText] = useState("")
  const [deleteAllTags, setDeleteAllTags] = useState<readonly string[] | null>(null)
  const [selected, setSelected] = useState<readonly TagStatistic[]>([])
  const statisticSelection = useFilteredRowSelection({
    onChange: (keys) => {
      const chosen = new Set(keys.map((key) => String(key)))
      setSelected(rows.filter((row) => chosen.has(row.tag)))
    },
    rowKey: "tag",
    rows,
    selectedKeys: selected.map((row) => row.tag),
  })
  const selectedUsed = selected.reduce((sum, row) => sum + row.usedCount, 0)
  const selectedTotal = selected.reduce((sum, row) => sum + row.totalCount, 0)

  const confirmDeleteUsed = (tags: readonly string[], count: number): void => {
    if (tags.length === 0) {
      message.warning("请选择包含已使用数据的标签")
      return
    }
    void modal.confirm({
      cancelText: "取消",
      content:
        tags.length === 1
          ? `确定删除分组「${tags[0]}」下的已使用数据吗?`
          : `确定删除选中 ${tags.length} 个标签下的 ${count} 条已使用数据吗?`,
      okText: "确定",
      onOk: () => onDeleteUsed(tags),
      title: "提示",
    })
  }

  const openDeleteAll = (tags: readonly string[]): void => {
    if (tags.length === 0) {
      message.warning("请选择需要删除的标签")
      return
    }
    setConfirmText("")
    setDeleteAllTags(tags)
  }

  const submitDeleteAll = (): void => {
    if (deleteAllTags === null) return
    if (confirmText !== "确认全部删除") {
      message.error("请输入：确认全部删除")
      return
    }
    onDeleteAll(deleteAllTags)
    setDeleteAllTags(null)
    setConfirmText("")
  }

  const deleteAllPrompt =
    deleteAllTags === null
      ? ""
      : deleteAllTags.length === 1
        ? `此操作将删除分组「${deleteAllTags[0]}」下全部 ${rows.find((row) => row.tag === deleteAllTags[0])?.totalCount ?? 0} 条数据，请输入“确认全部删除”继续`
        : `此操作将删除选中 ${deleteAllTags.length} 个标签下全部 ${selectedTotal} 条数据，请输入“确认全部删除”继续`

  return (
    <>
      <Modal
        className="dialog-statics"
        footer={null}
        onCancel={onCancel}
        open
        title="统计"
        width="70%"
      >
        {canWrite ? (
          <Space className="statistics-actions" wrap>
            <Button
              disabled={selected.length === 0 || selectedUsed === 0}
              onClick={() =>
                confirmDeleteUsed(
                  selected.filter((row) => row.usedCount > 0).map((row) => row.tag),
                  selectedUsed,
                )
              }
            >
              {`删除选中已使用(${selectedUsed})`}
            </Button>
            <Button
              danger
              disabled={selected.length === 0 || selectedTotal === 0}
              onClick={() =>
                openDeleteAll(selected.filter((row) => row.totalCount > 0).map((row) => row.tag))
              }
            >
              {`全部删除选中(${selectedTotal})`}
            </Button>
          </Space>
        ) : null}
        <Table
          columns={[
            { dataIndex: "tag", key: "tag", title: "标签" },
            {
              dataIndex: "totalCount",
              key: "totalCount",
              sorter: (left: TagStatistic, right: TagStatistic) =>
                left.totalCount - right.totalCount,
              title: "总数",
              width: 90,
            },
            {
              dataIndex: "availableCount",
              key: "availableCount",
              sorter: (left: TagStatistic, right: TagStatistic) =>
                left.availableCount - right.availableCount,
              title: "未使用",
              width: 90,
            },
            {
              dataIndex: "usedCount",
              key: "usedCount",
              sorter: (left: TagStatistic, right: TagStatistic) => left.usedCount - right.usedCount,
              title: "已使用",
              width: 90,
            },
            ...(canWrite
              ? [
                  {
                    align: "center" as const,
                    fixed: "right" as const,
                    key: "actions",
                    render: (_value: unknown, row: TagStatistic) => (
                      <Space>
                        <Button
                          disabled={row.usedCount === 0}
                          onClick={() => confirmDeleteUsed([row.tag], row.usedCount)}
                          size="small"
                          type="link"
                        >
                          删除已使用
                        </Button>
                        <Button
                          danger
                          disabled={row.totalCount === 0}
                          onClick={() => openDeleteAll([row.tag])}
                          size="small"
                          type="link"
                        >
                          全部删除
                        </Button>
                      </Space>
                    ),
                    title: "操作",
                    width: 210,
                  },
                ]
              : []),
          ]}
          dataSource={[...rows]}
          pagination={false}
          rowKey="tag"
          {...(canWrite ? { rowSelection: statisticSelection } : {})}
          scroll={{ x: "max-content", y: 500 }}
          size="small"
        />
      </Modal>
      <Modal
        cancelText="取消"
        okText="全部删除"
        onCancel={() => setDeleteAllTags(null)}
        onOk={submitDeleteAll}
        open={deleteAllTags !== null}
        title="确认全部删除"
        width={420}
      >
        <p>{deleteAllPrompt}</p>
        <Input
          aria-label="确认全部删除"
          onChange={(event) => setConfirmText(event.target.value)}
          placeholder="确认全部删除"
          value={confirmText}
        />
      </Modal>
    </>
  )
}
