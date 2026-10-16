import { CopyOutlined, DeleteOutlined, PlusOutlined, QuestionCircleOutlined } from "@ant-design/icons"
import type { TableColumnsType } from "antd"
import { Alert, App, Button, Card, Input, Space, Table } from "antd"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"

import { FilteredSelectCheckbox } from "../../components/tables/filtered-selection"
import {
  type FilterMode,
  type SelectionScope,
  FilterModeSwitch,
  SelectionScopeSwitch,
} from "../../components/tables/operation-controls"
import "./account-pool.css"
import { AccountListDialog, HelpDialog, ProgressDialog, StatsDialog } from "./analysis-dialogs"
import { createAccountPoolsApi, poolRequestError, type StoredPool } from "./api"
import { PoolFilterDialog } from "./filter-dialog"
import { TaskResFormDialog } from "./form-dialog"
import {
  allowCopy,
  emptyTaskResQuery,
  type MytTaskRes,
  nowText,
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
  const [filterMode, setFilterMode] = useState<FilterMode>("and")
  const [selectionScope, setSelectionScope] = useState<SelectionScope>("all")
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
  const [recordIndex, setRecordIndex] = useState<ReadonlyMap<number, string>>(() => new Map())
  const [selectingAll, setSelectingAll] = useState(false)
  const selectRequest = useRef(0)
  const [editRecord, setEditRecord] = useState<MytTaskRes | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
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
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  useEffect(() => {
    selectRequest.current += 1
    const request = selectRequest.current
    setSelectingAll(false)
    if (groupId === undefined) {
      setSelectedIds([])
      setRecordIndex(new Map())
      return
    }
    const chosen = selectedIdsRef.current
    if (chosen.length === 0) return
    let active = true
    void (async () => {
      const items: StoredPool[] = []
      let pageNo = 1
      let totalCount = 0
      try {
        do {
          const result = await api.list(groupId, { ...query, page: pageNo, pageSize: 500 })
          if (!active || selectRequest.current !== request) return
          items.push(...result.items)
          totalCount = result.total
          pageNo += 1
          if (result.items.length === 0) break
        } while (items.length < totalCount && pageNo <= 20)
      } catch {
        if (active && selectRequest.current === request) setSelectedIds([])
        return
      }
      if (!active || selectRequest.current !== request) return
      const allowed = new Set(items.map((item) => item.displayId))
      setSelectedIds(chosen.filter((id) => allowed.has(id)))
      setRecordIndex((current) => {
        const next = new Map<number, string>()
        for (const item of items) {
          if (chosen.includes(item.displayId)) next.set(item.displayId, item.id)
        }
        for (const [id, recordId] of current) {
          if (allowed.has(id) && !next.has(id)) next.set(id, recordId)
        }
        return next
      })
    })()
    return () => {
      active = false
    }
  }, [api, groupId, query])
  useEffect(() => {
    setRecordIndex((current) => {
      const next = new Map(current)
      let changed = false
      for (const item of pools) {
        if (item.recordId !== undefined && next.get(item.id) !== item.recordId) {
          next.set(item.id, item.recordId)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [pools])
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
    setFilterOpen(false)
    setEditRecord(null)
    setAnalysis(null)
    setAnalysisLoading(null)
    detailRequest.current += 1
  }, [groupId])

  const applyQuery = (next = draft): void => {
    setDraft(next)
    setQuery(next)
    setPage(1)
  }

  const selectAllMatching = async (): Promise<void> => {
    if (groupId === undefined) return
    const request = ++selectRequest.current
    setSelectingAll(true)
    try {
      const items: StoredPool[] = []
      let pageNo = 1
      let totalCount = 0
      do {
        const result = await api.list(groupId, { ...query, page: pageNo, pageSize: 500 })
        if (selectRequest.current !== request) return
        items.push(...result.items)
        totalCount = result.total
        pageNo += 1
        if (result.items.length === 0) break
      } while (items.length < totalCount && pageNo <= 20)
      if (selectRequest.current !== request) return
      const mapped = items.map((item) => deskPool(item, devices))
      setRecordIndex((current) => {
        const next = new Map(current)
        for (const item of mapped) {
          if (item.recordId !== undefined) next.set(item.id, item.recordId)
        }
        return next
      })
      setSelectedIds(mapped.map((item) => item.id))
    } catch (error) {
      if (selectRequest.current === request) message.error(await poolRequestError(error))
    } finally {
      if (selectRequest.current === request) setSelectingAll(false)
    }
  }

  const deleteIds = async (ids: readonly number[]): Promise<void> => {
    if (groupId === undefined) return
    const recordIds = ids.flatMap((id) => {
      const recordId = recordIndex.get(id)
      return recordId === undefined ? [] : [recordId]
    })
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
    { dataIndex: "recordId", ellipsis: true, key: "id", title: "ID", width: 280 },
    { dataIndex: "userId", ellipsis: true, key: "userId", title: "用户", width: 120 },
    { dataIndex: "key", ellipsis: true, key: "key", title: "命名", width: 220 },
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
      <Card className="condition-panel filter-bar" size="small">
        <Space className="condition-search resource-filter-row" wrap>
          <span className="filter-label">搜索</span>
          <Input
            allowClear
            aria-label="搜索"
            onChange={(event) => applyQuery({ ...draft, key: event.target.value })}
            placeholder="用户/命名"
            style={{ width: 220 }}
            value={draft.key}
          />
          <Button
            onClick={() => {
              setFilterMode("and")
              applyQuery(emptyTaskResQuery())
            }}
          >
            重置
          </Button>
          <FilterModeSwitch mode={filterMode} onChange={setFilterMode} />
        </Space>
      </Card>
      <div className="resource-crud-toolbar">
        <Space wrap>
          <SelectionScopeSwitch onChange={setSelectionScope} scope={selectionScope} />
          {canWrite ? (
            <>
              <Button
                icon={<PlusOutlined aria-hidden />}
                onClick={() => setFilterOpen(true)}
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
          pageSizeOptions: [10, 20, 50, 100],
          showSizeChanger: true,
          showTotal: (count) => `共 ${count} 条`,
          onChange: (nextPage, size) => {
            setPage(size === pageSize ? nextPage : 1)
            setPageSize(size)
          },
        }}
        rowKey="id"
        scroll={{ x: "max-content" }}
        size="small"
        {...(canWrite
          ? {
              rowSelection: {
                columnTitle: (
                  <FilteredSelectCheckbox
                    busy={selectingAll}
                    filteredCount={selectionScope === "page" ? pools.length : total}
                    onClear={() => {
                      if (selectionScope === "page") {
                        const pageIds = new Set(pools.map((item) => item.id))
                        setSelectedIds((current) => current.filter((id) => !pageIds.has(id)))
                        return
                      }
                      setSelectedIds([])
                    }}
                    onSelectAll={() => {
                      if (selectionScope === "page") {
                        setSelectedIds((current) => [
                          ...new Set([...current, ...pools.map((item) => item.id)]),
                        ])
                        return
                      }
                      void selectAllMatching()
                    }}
                    selectedCount={
                      selectionScope === "page"
                        ? pools.filter((item) => selectedIds.includes(item.id)).length
                        : selectedIds.length
                    }
                  />
                ),
                getCheckboxProps: (item: MytTaskRes) => ({
                  "aria-label": `选择 ${item.key}`,
                }),
                onChange: (keys, _rows, info) => {
                  if (info.type === "all" || info.type === "none") return
                  setSelectedIds(keys.map((key) => Number(key)))
                },
                preserveSelectedRowKeys: true,
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
      {filterOpen && groupId !== undefined ? (
        <PoolFilterDialog
          groupId={groupId}
          onCancel={() => setFilterOpen(false)}
          onSubmit={async (query, name) => {
            try {
              await api.createDesk(groupId, query, name)
            } catch (error) {
              message.error(await poolRequestError(error))
              throw error
            }
            if (groupRef.current !== groupId) return
            message.success("新增成功")
            setFilterOpen(false)
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
