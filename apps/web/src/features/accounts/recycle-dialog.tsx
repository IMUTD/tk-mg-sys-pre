import { Alert, Button, Input, Modal, Select, Space, Table } from "antd"
import { type ReactNode, useMemo, useState } from "react"
import { useFilteredRowSelection } from "../../components/tables/filtered-selection"
import { useClientPagination } from "../../components/tables/operation-controls"
import { PageKey } from "../../lib/pages"
import { BusinessLabelFilter, UNASSIGNED_VALUE } from "../labels/filter-row"
import {
  type AccountQuery,
  APP_OPTIONS,
  appLabel,
  emptyAccountQuery,
  filterAccounts,
  type MytAccount,
  STATUS_OPTIONS,
  statusLabel,
} from "./myt-account"

type RecycleDialogProps = {
  readonly accounts: readonly MytAccount[]
  readonly canDelete: boolean
  readonly canWrite: boolean
  readonly onCancel: () => void
  readonly onDelete: (ids: readonly number[]) => void
  readonly onRestore: (ids: readonly number[]) => void
}

export const RecycleDialog = ({
  accounts,
  canDelete,
  canWrite,
  onCancel,
  onDelete,
  onRestore,
}: RecycleDialogProps): ReactNode => {
  const [draft, setDraft] = useState<AccountQuery>(emptyAccountQuery())
  const [query, setQuery] = useState<AccountQuery>(emptyAccountQuery())
  const [selectedIds, setSelectedIds] = useState<readonly number[]>([])
  const rows = useMemo(() => filterAccounts(accounts, query, true), [accounts, query])
  const recyclePaging = useClientPagination(JSON.stringify(query), 20)
  const recycleSelection = useFilteredRowSelection({
    getCheckboxProps: (account: MytAccount) => ({
      "aria-label": `选择 ${account.username || account.uid}`,
    }),
    onChange: (keys) => setSelectedIds(keys.map((key) => Number(key))),
    rowKey: "id",
    rows,
    selectedKeys: selectedIds,
  })

  return (
    <Modal footer={null} onCancel={onCancel} open title="账号回收站" width="85%">
      <BusinessLabelFilter
        page={PageKey.Accounts}
        title="回收站分组"
        options={[...new Set(accounts.filter((item) => item.deleted).map((item) => item.tag))]
          .filter(Boolean)
          .map((tag) => ({ value: tag, label: tag }))}
        blankLabel="未分组"
        value={draft.ungrouped ? UNASSIGNED_VALUE : draft.tag}
        onChange={(tag) => {
          const next =
            tag === UNASSIGNED_VALUE
              ? { ...draft, tag: "", ungrouped: true }
              : { ...draft, tag, ungrouped: false }
          setDraft(next)
          setQuery(next)
        }}
      />
      <Space className="recycle-filter" wrap>
        <Input
          allowClear
          aria-label="回收站用户名"
          onChange={(event) => setDraft({ ...draft, username: event.target.value })}
          placeholder="用户名"
          style={{ width: 160 }}
          value={draft.username}
        />
        <Input
          allowClear
          aria-label="回收站UID"
          onChange={(event) => setDraft({ ...draft, uidQuery: event.target.value })}
          placeholder="UID"
          style={{ width: 180 }}
          value={draft.uidQuery}
        />
        <Input
          allowClear
          aria-label="回收站备注"
          onChange={(event) => setDraft({ ...draft, remark: event.target.value })}
          placeholder="备注"
          style={{ width: 160 }}
          value={draft.remark}
        />
        <Select
          allowClear
          aria-label="回收站APP类型"
          onChange={(value: string | null) => setDraft({ ...draft, app: value ?? "" })}
          options={[...APP_OPTIONS]}
          placeholder="APP类型"
          style={{ width: 140 }}
          value={draft.app.length === 0 ? null : draft.app}
          virtual={false}
        />
        <Select
          allowClear
          aria-label="回收站账号状态"
          onChange={(value: string | null) => setDraft({ ...draft, status: value ?? "" })}
          options={[...STATUS_OPTIONS]}
          placeholder="账号状态"
          style={{ width: 140 }}
          value={draft.status.length === 0 ? null : draft.status}
          virtual={false}
        />
        <Button
          onClick={() => {
            setQuery(draft)
          }}
          type="primary"
        >
          搜索
        </Button>
        <Button
          onClick={() => {
            const empty = emptyAccountQuery()
            setDraft(empty)
            setQuery(empty)
          }}
        >
          重置
        </Button>
        {canWrite ? (
          <Button
            disabled={selectedIds.length === 0}
            onClick={() => onRestore(selectedIds)}
            type="primary"
          >
            批量恢复
          </Button>
        ) : null}
        {canWrite && canDelete ? (
          <Button
            danger
            disabled={selectedIds.length === 0}
            onClick={() => onDelete(selectedIds)}
            type="primary"
          >
            批量删除
          </Button>
        ) : null}
      </Space>
      <Alert
        className="recycle-alert"
        message="这里只展示最近 7 天内删除的账号，恢复后会重新进入正常账号列表。"
        showIcon
        type="info"
      />
      <Table
        columns={[
          { dataIndex: "tag", key: "tag", title: "分组" },
          { dataIndex: "uid", key: "uid", title: "UID" },
          { dataIndex: "username", key: "username", title: "账号" },
          {
            key: "app",
            render: (_value: unknown, account: MytAccount) => appLabel(account.app),
            title: "APP类型",
          },
          {
            key: "status",
            render: (_value: unknown, account: MytAccount) => statusLabel(account.status),
            title: "状态",
          },
          { dataIndex: "region", key: "region", title: "地区" },
          {
            dataIndex: "remark",
            ellipsis: true,
            key: "remark",
            title: "备注",
          },
          { dataIndex: "updateTime", key: "updateTime", title: "删除时间" },
          ...(canWrite
            ? [
                {
                  align: "center" as const,
                  fixed: "right" as const,
                  key: "actions",
                  render: (_value: unknown, account: MytAccount) => (
                    <Space>
                      <Button onClick={() => onRestore([account.id])} size="small" type="primary">
                        恢复
                      </Button>
                      {canDelete ? (
                        <Button danger onClick={() => onDelete([account.id])} size="small">
                          删除
                        </Button>
                      ) : null}
                    </Space>
                  ),
                  title: "操作",
                  width: canDelete ? 160 : 120,
                },
              ]
            : []),
        ]}
        dataSource={rows}
        locale={{ emptyText: "暂无数据" }}
        pagination={{ ...recyclePaging.pagination, total: rows.length }}
        rowKey="id"
        rowSelection={recycleSelection}
        scroll={{ x: "max-content" }}
        size="small"
      />
    </Modal>
  )
}
