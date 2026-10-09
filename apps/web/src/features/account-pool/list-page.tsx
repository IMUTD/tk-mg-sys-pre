import {
  CopyOutlined,
  DeleteOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
} from "@ant-design/icons"
import type { TableColumnsType } from "antd"
import { Alert, App, Button, Card, Input, Space, Table } from "antd"
import type { Key } from "react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"

import "./account-pool.css"
import { AccountListDialog, HelpDialog, ProgressDialog, StatsDialog } from "./analysis-dialogs"
import { createAccountPoolsApi, poolRequestError, type StoredPool } from "./api"
import { CreatePoolDialog } from "./create-dialog"
import { TaskResFormDialog } from "./form-dialog"
import {
  allowCopy,
  deviceLabel,
  emptyTaskRes,
  emptyTaskResQuery,
  type MytTaskRes,
  nowText,
  poolBackTypeLabel,
  remainingDays,
  shortDate,
  type TaskResQuery,
} from "./myt-task-res"
import { deskPool, deskPoolDetails, type PoolDeskDevice, poolDevices } from "./wiring"

type AccountPoolListPageProps = {
  readonly canDelete?: boolean
  readonly canWrite: boolean
  readonly groupId?: string | undefined
}

type AnalysisState = { kind: "accounts" | "beta" | "progress" | "stats"; pool: MytTaskRes } | null

export const AccountPoolListPage = ({
  canDelete,
  canWrite,
  groupId,
}: AccountPoolListPageProps): ReactNode => {
  const allowDelete = canDelete === true
  const { message, modal } = App.useApp()
  const [draft, setDraft] = useState<TaskResQuery>(emptyTaskResQuery)
  const [query, setQuery] = useState<TaskResQuery>(emptyTaskResQuery)
  const [api] = useState(createAccountPoolsApi)
  const [storedPools, setStoredPools] = useState<readonly StoredPool[]>([])
  const [devices, setDevices] = useState<readonly PoolDeskDevice[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [deviceError, setDeviceError] = useState(false)
  const [deviceRevision, setDeviceRevision] = useState(0)
  const groupRef = useRef(groupId)
  groupRef.current = groupId
  const detailRequest = useRef(0)
  const [analysisLoading, setAnalysisLoading] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<readonly number[]>([])
  const [editRecord, setEditRecord] = useState<MytTaskRes | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [analysis, setAnalysis] = useState<AnalysisState>(null)
  const pools = useMemo(
    () => storedPools.map((item) => deskPool(item, devices)),
    [storedPools, devices],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: Revision reloads the saved list after a successful write.
  useEffect(() => {
    let active = true
    setStoredPools([])
    setSelectedIds([])
    setTotal(0)
    setLoadError(false)
    if (groupId === undefined) {
      setLoading(false)
      return
    }
    setLoading(true)
    void api
      .list(groupId, { ...query, page, pageSize })
      .then((result) => {
        if (!active) return
        setStoredPools(result.items)
        setTotal(result.total)
      })
      .catch(() => {
        if (active) setLoadError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [api, groupId, query, page, pageSize, revision])
  // biome-ignore lint/correctness/useExhaustiveDependencies: Device revision retries a failed device read.
  useEffect(() => {
    let active = true
    setDevices([])
    setDeviceError(false)
    if (groupId !== undefined && canWrite) {
      void api
        .devices(groupId)
        .then((items) => {
          if (active) setDevices(poolDevices(items))
        })
        .catch(() => {
          if (active) setDeviceError(true)
        })
    }
    return () => {
      active = false
    }
  }, [api, groupId, canWrite, deviceRevision])
  // biome-ignore lint/correctness/useExhaustiveDependencies: Changing the authorization group closes all scoped dialogs.
  useEffect(() => {
    setCreateOpen(false)
    setEditRecord(null)
    setAnalysis(null)
    setAnalysisLoading(null)
    detailRequest.current += 1
  }, [groupId])

  const applyQuery = (next = draft): void => {
    setDraft(next)
    setQuery(next)
    setSelectedIds([])
    setPage(1)
  }

  const resetQuery = (): void => {
    const empty = emptyTaskResQuery()
    setDraft(empty)
    setQuery(empty)
    setSelectedIds([])
    setPage(1)
  }

  const deleteIds = async (ids: readonly number[]): Promise<void> => {
    if (groupId === undefined) return
    const recordIds = pools
      .filter((item) => ids.includes(item.id))
      .map((item) => item.recordId)
      .filter((id): id is string => id !== undefined)
    await api.remove(groupId, recordIds)
    if (groupRef.current !== groupId) return
    setSelectedIds([])
    setPage(1)
    setRevision((value) => value + 1)
  }

  const confirmDelete = (ids: readonly number[]): void => {
    if (ids.length === 0) return
    void modal.confirm({
      cancelText: "取消",
      content: ids.length === 1 ? "确定删除吗？" : `确认删除选中的${ids.length}条数据?`,
      okText: "确定",
      onOk: async () => {
        try {
          await deleteIds(ids)
          message.success("删除成功")
        } catch (error) {
          message.error(await poolRequestError(error))
          throw error
        }
      },
      title: "提示",
    })
  }

  const copyPool = async (item: MytTaskRes): Promise<void> => {
    if (groupId === undefined || item.recordId === undefined) return
    const request = ++detailRequest.current
    setAnalysisLoading(null)
    try {
      const full = deskPoolDetails(await api.details(groupId, item.recordId), devices)
      if (groupRef.current !== groupId || detailRequest.current !== request) return
      setEditRecord({ ...full, createTime: nowText(), id: 0, updateTime: nowText() })
    } catch (error) {
      if (groupRef.current === groupId && detailRequest.current === request)
        message.error(await poolRequestError(error))
    }
  }
  const openAnalysis = async (
    kind: NonNullable<AnalysisState>["kind"],
    item: MytTaskRes,
  ): Promise<void> => {
    if (groupId === undefined || item.recordId === undefined) return
    const request = ++detailRequest.current
    setAnalysisLoading(item.id)
    try {
      const full = deskPoolDetails(await api.details(groupId, item.recordId), devices)
      if (groupRef.current !== groupId || detailRequest.current !== request) return
      setAnalysis({ kind, pool: full })
    } catch (error) {
      if (groupRef.current === groupId && detailRequest.current === request)
        message.error(await poolRequestError(error))
    } finally {
      if (groupRef.current === groupId && detailRequest.current === request)
        setAnalysisLoading(null)
    }
  }

  const columns: TableColumnsType<MytTaskRes> = [
    { dataIndex: "id", key: "id", title: "ID", width: 70 },
    { dataIndex: "userId", ellipsis: true, key: "userId", title: "用户", width: 70 },
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
            disabled={analysisLoading === item.id}
            onClick={() => void openAnalysis("stats", item)}
            size="small"
            type="link"
          >
            数据统计
          </Button>
          <Button
            disabled={analysisLoading === item.id}
            onClick={() => void openAnalysis("beta", item)}
            size="small"
            type="link"
          >
            统计(备用)
          </Button>
          <Button
            disabled={analysisLoading === item.id}
            onClick={() => void openAnalysis("progress", item)}
            size="small"
            type="link"
          >
            消耗进度
          </Button>
          <Button
            disabled={analysisLoading === item.id}
            onClick={() => void openAnalysis("accounts", item)}
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
      render: (_value: unknown, item: MytTaskRes) =>
        item.expiresAt === undefined
          ? remainingDays(item.createTime)
          : Math.ceil((new Date(item.expiresAt).getTime() - Date.now()) / 86_400_000) <= 0
            ? "过期"
            : `${Math.ceil((new Date(item.expiresAt).getTime() - Date.now()) / 86_400_000)}天`,
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
                    onClick={() => void copyPool(item)}
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
      {loadError || groupId === undefined ? (
        <Alert type="error" showIcon message="账号池加载失败" />
      ) : null}
      {deviceError ? (
        <Alert
          type="error"
          showIcon
          message="设备加载失败"
          action={
            <Button size="small" onClick={() => setDeviceRevision((value) => value + 1)}>
              重试
            </Button>
          }
        />
      ) : null}
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
        dataSource={pools}
        loading={loading}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (count) => `共 ${count} 条`,
          onChange: (nextPage, size) => {
            setPage(size === pageSize ? nextPage : 1)
            setPageSize(size)
            setSelectedIds([])
          },
        }}
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
          api={api}
          groupId={groupId ?? ""}
          devices={devices}
          onCancel={() => setEditRecord(null)}
          onSubmit={async (input) => {
            if (groupId === undefined) return
            await api.create(groupId, input)
            if (groupRef.current !== groupId) return
            message.success("新增成功")
            setEditRecord(null)
            setPage(1)
            setRevision((value) => value + 1)
          }}
          record={editRecord}
        />
      )}
      {createOpen ? (
        <CreatePoolDialog
          api={api}
          groupId={groupId ?? ""}
          devices={devices}
          onCancel={() => setCreateOpen(false)}
          onSubmit={async (input) => {
            if (groupId === undefined) return
            await api.create(groupId, input)
            if (groupRef.current !== groupId) return
            setCreateOpen(false)
            message.success("新建成功")
            setPage(1)
            setRevision((value) => value + 1)
          }}
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
