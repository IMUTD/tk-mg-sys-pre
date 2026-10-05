import {
  CopyOutlined,
  DeleteOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
} from "@ant-design/icons"
import type { TableColumnsType } from "antd"
import { App, Button, Card, Input, Space, Table } from "antd"
import type { Key } from "react"
import { type ReactNode, useMemo, useState } from "react"

import "./account-pool.css"
import { AccountListDialog, HelpDialog, ProgressDialog, StatsDialog } from "./analysis-dialogs"
import { CreatePoolDialog } from "./create-dialog"
import { TaskResFormDialog } from "./form-dialog"
import {
  allowCopy,
  createSeedDevices,
  createSeedSourceAccounts,
  createSeedTaskRes,
  deviceLabel,
  emptyTaskRes,
  emptyTaskResQuery,
  filterTaskRes,
  type MytTaskRes,
  nowText,
  poolBackTypeLabel,
  remainingDays,
  shortDate,
  type TaskResQuery,
} from "./myt-task-res"

type AccountPoolListPageProps = {
  readonly canDelete?: boolean
  readonly canWrite: boolean
}

type AnalysisState = { kind: "accounts" | "beta" | "progress" | "stats"; pool: MytTaskRes } | null

export const AccountPoolListPage = ({
  canDelete,
  canWrite,
}: AccountPoolListPageProps): ReactNode => {
  const allowDelete = canDelete === true
  const { message, modal } = App.useApp()
  const [draft, setDraft] = useState<TaskResQuery>(emptyTaskResQuery)
  const [query, setQuery] = useState<TaskResQuery>(emptyTaskResQuery)
  const [pools, setPools] = useState<MytTaskRes[]>(() => createSeedTaskRes())
  const [sourceAccounts] = useState(() => createSeedSourceAccounts())
  const [devices] = useState(() => createSeedDevices())
  const [selectedIds, setSelectedIds] = useState<readonly number[]>([])
  const [editRecord, setEditRecord] = useState<MytTaskRes | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [analysis, setAnalysis] = useState<AnalysisState>(null)
  const filtered = useMemo(() => filterTaskRes(pools, query), [pools, query])
  const nextId = Math.max(0, ...pools.map((item) => item.id)) + 1

  const applyQuery = (next = draft): void => {
    setDraft(next)
    setQuery(next)
    setSelectedIds([])
  }

  const resetQuery = (): void => {
    const empty = emptyTaskResQuery()
    setDraft(empty)
    setQuery(empty)
    setSelectedIds([])
  }

  const deleteIds = (ids: readonly number[]): void => {
    const idSet = new Set(ids)
    setPools((current) => current.filter((item) => !idSet.has(item.id)))
    setSelectedIds((current) => current.filter((id) => !ids.includes(id)))
  }

  const confirmDelete = (ids: readonly number[]): void => {
    if (ids.length === 0) return
    void modal.confirm({
      cancelText: "取消",
      content: ids.length === 1 ? "确定删除吗？" : `确认删除选中的${ids.length}条数据?`,
      okText: "确定",
      onOk: () => {
        deleteIds(ids)
        message.success("删除成功")
      },
      title: "提示",
    })
  }

  const copyPool = (item: MytTaskRes): void => {
    setEditRecord({
      ...item,
      createTime: nowText(),
      id: 0,
      updateTime: nowText(),
    })
  }

  const columns: TableColumnsType<MytTaskRes> = [
    { dataIndex: "id", key: "id", title: "ID", width: 70 },
    { dataIndex: "userId", key: "userId", title: "用户", width: 70 },
    { dataIndex: "remark", ellipsis: true, key: "remark", title: "备注", width: 140 },
    { dataIndex: "key", ellipsis: true, key: "key", title: "编码", width: 140 },
    { dataIndex: "times", key: "times", title: "重复次数", width: 90 },
    {
      key: "backType",
      render: (_value: unknown, item: MytTaskRes) => poolBackTypeLabel(item.backType),
      title: "备份方式",
      width: 120,
    },
    {
      ellipsis: true,
      key: "device",
      render: (_value: unknown, item: MytTaskRes) => deviceLabel(devices, item),
      title: "绑定设备",
      width: 180,
    },
    { dataIndex: "count", key: "count", title: "账号总数", width: 90 },
    {
      key: "analysis",
      render: (_value: unknown, item: MytTaskRes) => (
        <Space className="pool-analysis" size={0} wrap>
          <Button
            onClick={() => setAnalysis({ kind: "stats", pool: item })}
            size="small"
            type="link"
          >
            数据统计
          </Button>
          <Button
            onClick={() => setAnalysis({ kind: "beta", pool: item })}
            size="small"
            type="link"
          >
            统计(备用)
          </Button>
          <Button
            onClick={() => setAnalysis({ kind: "progress", pool: item })}
            size="small"
            type="link"
          >
            消耗进度
          </Button>
          <Button
            onClick={() => setAnalysis({ kind: "accounts", pool: item })}
            size="small"
            type="link"
          >
            账号列表
          </Button>
        </Space>
      ),
      title: "分析",
      width: 280,
    },
    {
      key: "updateTime",
      render: (_value: unknown, item: MytTaskRes) => shortDate(item.updateTime),
      title: "更新时间",
      width: 140,
    },
    {
      key: "expire",
      render: (_value: unknown, item: MytTaskRes) => remainingDays(item.createTime),
      title: "过期",
      width: 80,
    },
    ...(canWrite
      ? [
          {
            align: "center" as const,
            fixed: "right" as const,
            key: "actions",
            render: (_value: unknown, item: MytTaskRes) => (
              <Space size={0}>
                {allowCopy(item) ? (
                  <Button
                    icon={<CopyOutlined aria-hidden />}
                    onClick={() => copyPool(item)}
                    size="small"
                    type="link"
                  >
                    复制
                  </Button>
                ) : null}
                {allowDelete ? (
                  <Button danger onClick={() => confirmDelete([item.id])} size="small" type="link">
                    删除
                  </Button>
                ) : null}
              </Space>
            ),
            title: "操作",
            width: 140,
          },
        ]
      : []),
  ]

  return (
    <section className="module-page account-pool-page">
      <Card className="filter-bar" size="small">
        <Space className="resource-filter-row" wrap>
          <span className="filter-label">ID</span>
          <Input
            allowClear
            aria-label="ID"
            onChange={(event) => setDraft({ ...draft, id: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="ID"
            style={{ width: 100 }}
            value={draft.id}
          />
          <span className="filter-label">编码</span>
          <Input
            allowClear
            aria-label="编码"
            onChange={(event) => setDraft({ ...draft, key: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="编码"
            style={{ width: 185 }}
            value={draft.key}
          />
          <span className="filter-label">备注</span>
          <Input
            allowClear
            aria-label="备注"
            onChange={(event) => setDraft({ ...draft, remark: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="备注"
            style={{ width: 185 }}
            value={draft.remark}
          />
          <Button icon={<SearchOutlined aria-hidden />} onClick={() => applyQuery()} type="primary">
            搜索
          </Button>
          <Button onClick={resetQuery}>重置</Button>
        </Space>
      </Card>
      <div className="resource-crud-toolbar">
        <Space wrap>
          {canWrite ? (
            <>
              <Button
                icon={<PlusOutlined aria-hidden />}
                onClick={() => setEditRecord(emptyTaskRes(0, nowText()))}
                type="primary"
              >
                新增
              </Button>
              {allowDelete ? (
                <Button
                  danger
                  disabled={selectedIds.length === 0}
                  icon={<DeleteOutlined aria-hidden />}
                  onClick={() => confirmDelete(selectedIds)}
                >
                  {selectedIds.length > 0 ? `删除(${selectedIds.length})` : "删除"}
                </Button>
              ) : null}
              <Button onClick={() => setCreateOpen(true)}>创建账号池</Button>
            </>
          ) : null}
          <Button
            icon={<QuestionCircleOutlined aria-hidden />}
            onClick={() => setHelpOpen(true)}
            type="link"
          >
            什么是账号池?
          </Button>
        </Space>
      </div>
      <Table
        columns={columns}
        dataSource={filtered}
        pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
        rowKey="id"
        scroll={{ x: "max-content" }}
        size="small"
        {...(canWrite
          ? {
              rowSelection: {
                getCheckboxProps: (item: MytTaskRes) => ({
                  "aria-label": `选择 ${item.key}`,
                }),
                onChange: (keys: readonly Key[]) => setSelectedIds(keys.map((key) => Number(key))),
                selectedRowKeys: [...selectedIds],
              },
            }
          : {})}
      />
      {editRecord === null ? null : (
        <TaskResFormDialog
          devices={devices}
          onCancel={() => setEditRecord(null)}
          onSubmit={(item) => {
            if (item.id === 0) {
              setPools((current) => [{ ...item, id: nextId }, ...current])
              message.success("新增成功")
            } else {
              setPools((current) => current.map((entry) => (entry.id === item.id ? item : entry)))
              message.success("修改成功")
            }
            setEditRecord(null)
          }}
          record={editRecord}
          sourceAccounts={sourceAccounts}
        />
      )}
      {createOpen ? (
        <CreatePoolDialog
          devices={devices}
          nextId={nextId}
          onCancel={() => setCreateOpen(false)}
          onSubmit={(item) => {
            setPools((current) => [item, ...current])
            setCreateOpen(false)
            message.success("新建成功")
          }}
          sourceAccounts={sourceAccounts}
        />
      ) : null}
      {helpOpen ? <HelpDialog onClose={() => setHelpOpen(false)} /> : null}
      {analysis?.kind === "stats" ? (
        <StatsDialog onClose={() => setAnalysis(null)} pool={analysis.pool} variant="main" />
      ) : null}
      {analysis?.kind === "beta" ? (
        <StatsDialog onClose={() => setAnalysis(null)} pool={analysis.pool} variant="beta" />
      ) : null}
      {analysis?.kind === "progress" ? (
        <ProgressDialog onClose={() => setAnalysis(null)} pool={analysis.pool} />
      ) : null}
      {analysis?.kind === "accounts" ? (
        <AccountListDialog onClose={() => setAnalysis(null)} pool={analysis.pool} />
      ) : null}
    </section>
  )
}
