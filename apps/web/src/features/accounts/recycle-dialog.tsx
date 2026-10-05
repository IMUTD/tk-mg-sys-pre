import { Alert, Button, Input, Modal, Select, Space, Table } from "antd"
import type { Key } from "react"
import { type ReactNode, useMemo, useState } from "react"

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
  readonly canWrite: boolean
  readonly onCancel: () => void
  readonly onRestore: (ids: readonly number[]) => void
}

export const RecycleDialog = ({
  accounts,
  canWrite,
  onCancel,
  onRestore,
}: RecycleDialogProps): ReactNode => {
  const [draft, setDraft] = useState<AccountQuery>(emptyAccountQuery())
  const [query, setQuery] = useState<AccountQuery>(emptyAccountQuery())
  const [selectedIds, setSelectedIds] = useState<readonly number[]>([])
  const rows = useMemo(() => filterAccounts(accounts, query, true), [accounts, query])

  return (
    <Modal footer={null} onCancel={onCancel} open title="账号回收站" width="85%">
      <Space className="recycle-filter" wrap>
        <Input
          allowClear
          aria-label="回收站分组"
          onChange={(event) => setDraft({ ...draft, tag: event.target.value })}
          placeholder="分组"
          style={{ width: 140 }}
          value={draft.tag}
        />
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
            setSelectedIds([])
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
            setSelectedIds([])
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
                    <Button onClick={() => onRestore([account.id])} size="small" type="primary">
                      恢复
                    </Button>
                  ),
                  title: "操作",
                  width: 120,
                },
              ]
            : []),
        ]}
        dataSource={rows}
        locale={{ emptyText: "暂无数据" }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
        rowKey="id"
        rowSelection={{
          getCheckboxProps: (account: MytAccount) => ({
            "aria-label": `选择 ${account.username || account.uid}`,
          }),
          onChange: (keys: readonly Key[]) => setSelectedIds(keys.map((key) => Number(key))),
          selectedRowKeys: [...selectedIds],
        }}
        scroll={{ x: "max-content" }}
        size="small"
      />
    </Modal>
  )
}
