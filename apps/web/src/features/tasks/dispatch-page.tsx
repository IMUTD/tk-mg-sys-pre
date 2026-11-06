import { DeleteOutlined, PlayCircleOutlined, PlusOutlined } from "@ant-design/icons"
import { App, Button, Card, Progress, Space, Table, type TableColumnsType, Tag } from "antd"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { useFilteredRowSelection } from "../../components/tables/filtered-selection"
import {
  combineChecks,
  type FilterMode,
  FilterModeSwitch,
  pageSlice,
  type SelectionScope,
  SelectionScopeSwitch,
  useClientPagination,
} from "../../components/tables/operation-controls"
import { LabelFilterRow, usageLabel } from "../labels/filter-row"

import {
  createDispatchApi,
  type DispatchAccount,
  type DispatchRow,
  type DispatchSegment,
  type ProgressTone,
} from "./dispatch-api"
import { DispatchForm } from "./dispatch-form"
import "./tasks.css"

type DispatchPageProps = {
  readonly canWrite: boolean
  readonly groupId: string
}

type StepLoad =
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly segments: readonly DispatchSegment[] }

const STATUS_ORDER = [
  "参数未齐",
  "待开始",
  "已下发",
  "排队中",
  "执行中",
  "重跑中",
  "成功",
  "部分成功",
  "失败",
  "已取消",
]

const runLabel = (status: string): string => {
  if (status === "replaying") return "重跑中"
  if (status === "running") return "执行中"
  if (status === "queued") return "排队中"
  if (status === "failed") return "失败"
  if (status === "partial") return "部分成功"
  if (status === "succeeded") return "成功"
  if (status === "cancelled") return "已取消"
  return ""
}

const statusLabel = (status: string, missing: readonly string[], runStatus = ""): string => {
  if (status === "incomplete")
    return missing.length === 0 ? "参数未齐" : `参数未齐：${missing.join("、")}`
  if (status === "ready") return "待开始"
  if (status === "started") {
    const live = runLabel(runStatus)
    return live.length > 0 ? live : "已下发"
  }
  return status
}

const filterStatus = (row: DispatchRow): string => {
  if (row.status === "incomplete") return "参数未齐"
  return statusLabel(row.status, row.missing, row.runStatus ?? "")
}

const statusColor = (status: string, runStatus = ""): string => {
  if (runStatus === "partial") return "#ff5fa2"
  if (runStatus === "failed") return "error"
  if (status === "incomplete") return "error"
  if (status === "ready") return "gold"
  if (status === "started") return "success"
  return "default"
}

const stepStatusLabel = (status: string): string => {
  if (status === "succeeded") return "成功"
  if (status === "failed") return "失败"
  if (status === "cancelled") return "已取消"
  if (status === "running") return "执行中"
  if (status === "pending") return "待执行"
  if (status === "queued") return "排队中"
  if (status === "complete") return "参数已齐"
  if (status === "incomplete") return "参数未齐"
  return status
}

const minuteText = (value: string | null): string => {
  if (value === null || value.length === 0) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  const pad = (part: number): string => String(part).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const tally = (names: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const name of names) {
    if (name.length === 0) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return counts
}

const chipOptions = (counts: ReadonlyMap<string, number>, order: readonly string[] = []) => {
  const keys = [...counts.keys()]
  keys.sort((left, right) => {
    const leftIndex = order.indexOf(left)
    const rightIndex = order.indexOf(right)
    if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right, "zh-CN")
    if (leftIndex === -1) return 1
    if (rightIndex === -1) return -1
    return leftIndex - rightIndex
  })
  return keys.map((key) => ({ label: usageLabel(key, counts.get(key) ?? 0), value: key }))
}

const PINK = "#ff5fa2"

const ProgressCell = ({
  finished,
  tone,
  total,
}: {
  readonly finished: number
  readonly tone: ProgressTone
  readonly total: number
}): ReactNode => (
  <Progress
    className={tone === "partial" ? "task-progress is-partial" : "task-progress"}
    format={() => (tone === "partial" ? `${finished}/${total} 部分成功` : `${finished}/${total}`)}
    percent={total === 0 ? 0 : Math.round((finished / total) * 100)}
    size="small"
    status={tone === "partial" ? "normal" : tone}
    strokeColor={tone === "partial" ? PINK : undefined}
  />
)

const parameterText = (parameters: Readonly<Record<string, string>>): string =>
  Object.entries(parameters)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")

const stepColumns: TableColumnsType<DispatchSegment["steps"][number]> = [
  { dataIndex: "sequence", title: "步骤", width: 72, render: (value: number) => value + 1 },
  { dataIndex: "skill", title: "接口", width: 180 },
  {
    title: "状态",
    width: 160,
    render: (_value: unknown, step) =>
      step.errorCode.length > 0
        ? `${stepStatusLabel(step.status)} ${step.errorCode}`
        : stepStatusLabel(step.status),
  },
  {
    title: "参数",
    render: (_value: unknown, step) => {
      const text = parameterText(step.parameters)
      return text.length === 0 ? "-" : <pre className="task-params">{text}</pre>
    },
  },
]

const SegmentList = ({ segments }: { readonly segments: readonly DispatchSegment[] }): ReactNode => (
  <div>
    {segments.map((segment) => (
      <section className="task-segment" key={`${segment.stagePosition}:${segment.repeatIndex}`}>
        <div className="task-segment-title">{segment.title}</div>
        {segment.note.length > 0 ? <div className="task-segment-note">{segment.note}</div> : null}
        <Table
          columns={stepColumns}
          dataSource={[...segment.steps]}
          pagination={false}
          rowKey="sequence"
          size="small"
        />
      </section>
    ))}
  </div>
)

export const DispatchListPage = ({ canWrite, groupId }: DispatchPageProps): ReactNode => {
  const { message, modal } = App.useApp()
  const [rows, setRows] = useState<readonly DispatchRow[]>([])
  const [selectionScope, setSelectionScope] = useState<SelectionScope>("all")
  const [selected, setSelected] = useState<readonly string[]>([])
  const [creating, setCreating] = useState(false)
  const [starting, setStarting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [filterMode, setFilterMode] = useState<FilterMode>("and")
  const [statusFilters, setStatusFilters] = useState<readonly string[]>([])
  const [accountFilters, setAccountFilters] = useState<readonly string[]>([])
  const [chainFilters, setChainFilters] = useState<readonly string[]>([])
  const [stepsOf, setStepsOf] = useState<Readonly<Record<string, StepLoad>>>({})
  const selectedRows = rows.filter((item) => selected.includes(item.id))
  const blocked = selectedRows.some((item) => item.status === "incomplete")
  const visible = useMemo(
    () =>
      rows.filter((row) =>
        combineChecks(filterMode, [
          statusFilters.length === 0 ? null : statusFilters.includes(filterStatus(row)),
          accountFilters.length === 0 ? null : accountFilters.includes(row.requesterName),
          chainFilters.length === 0 ? null : chainFilters.includes(row.chainName),
        ]),
      ),
    [accountFilters, chainFilters, filterMode, rows, statusFilters],
  )
  const statusOptions = useMemo(
    () => chipOptions(tally(rows.map((row) => filterStatus(row))), STATUS_ORDER),
    [rows],
  )
  const accountOptions = useMemo(
    () => chipOptions(tally(rows.map((row) => row.requesterName))),
    [rows],
  )
  const chainOptions = useMemo(() => chipOptions(tally(rows.map((row) => row.chainName))), [rows])

  const reload = useCallback(async (): Promise<void> => {
    if (groupId.length === 0) return
    try {
      setRows(await createDispatchApi(groupId).list())
      setStepsOf({})
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败")
    }
  }, [groupId, message])

  useEffect(() => {
    void reload()
  }, [reload])

  const start = (): void => {
    if (selected.length === 0 || blocked) return
    setStarting(true)
    void createDispatchApi(groupId)
      .start(selected)
      .then(async () => {
        message.success("已开始")
        setSelected([])
        await reload()
      })
      .catch((error: unknown) => {
        message.error(error instanceof Error ? error.message : "保存失败")
      })
      .finally(() => setStarting(false))
  }

  const clearRecords = (): void => {
    const names = selectedRows.map((row) => row.name)
    if (names.length === 0) return
    const listed =
      names.length > 3 ? `${names.slice(0, 3).join("、")}等 ${names.length} 条` : names.join("、")
    modal.confirm({
      cancelText: "取消",
      content: `将删除所选 ${names.length} 条任务。${listed}`,
      okButtonProps: { danger: true },
      okText: "清空",
      title: "删除所选任务",
      onOk: async () => {
        setClearing(true)
        try {
          const removed = await createDispatchApi(groupId).clearRecords({
            dispatchIds: selected,
          })
          setSelected([])
          message.success(`已清空 ${removed.removed} 条任务`)
          await reload()
        } catch (error: unknown) {
          message.error(error instanceof Error ? error.message : "保存失败")
        } finally {
          setClearing(false)
        }
      },
      title: "清空所选盒子的任务记录",
    })
  }

  const loadSteps = (dispatchId: string, itemId: string): void => {
    const current = stepsOf[itemId]
    if (current?.kind === "loading" || current?.kind === "ready") return
    setStepsOf((prev) => ({ ...prev, [itemId]: { kind: "loading" } }))
    void createDispatchApi(groupId)
      .itemSteps(dispatchId, itemId)
      .then((payload) => {
        setStepsOf((prev) => ({ ...prev, [itemId]: { kind: "ready", segments: payload.segments } }))
      })
      .catch((error: unknown) => {
        setStepsOf((prev) => ({
          ...prev,
          [itemId]: {
            kind: "error",
            message: error instanceof Error ? error.message : "步骤加载失败",
          },
        }))
      })
  }

  const dispatchPaging = useClientPagination(
    `${groupId}:${filterMode}:${statusFilters.join("\n")}:${accountFilters.join("\n")}:${chainFilters.join("\n")}`,
  )
  const dispatchSelection = useFilteredRowSelection({
    onChange: (keys) => setSelected(keys.map((key) => String(key))),
    pageKeys: pageSlice(visible, dispatchPaging.current, dispatchPaging.pageSize).map(
      (item) => item.id,
    ),
    rowKey: "id",
    rows: visible,
    selectedKeys: selected,
    selectionScope,
  })

  const columns: TableColumnsType<DispatchRow> = [
    { dataIndex: "name", title: "任务", width: 180 },
    {
      render: (_value: unknown, item: DispatchRow) => (
        <ProgressCell finished={item.taskFinished} tone={item.taskTone} total={item.taskCount} />
      ),
      title: "任务数",
      width: 180,
    },
    {
      render: (_value: unknown, item: DispatchRow) => (
        <div className="task-time-cell">
          <div>创建 {minuteText(item.createdAt)}</div>
          <div>开始 {minuteText(item.startedAt)}</div>
          <div>结束 {minuteText(item.finishedAt)}</div>
        </div>
      ),
      title: "时间",
      width: 190,
    },
    {
      render: (_value: unknown, item: DispatchRow) =>
        item.requesterName.length > 0 ? item.requesterName : "-",
      title: "账号",
      width: 120,
    },
    {
      render: (_value: unknown, item: DispatchRow) => (
        <Tag color={statusColor(item.status, item.runStatus)}>
          {statusLabel(item.status, item.missing, item.runStatus)}
        </Tag>
      ),
      title: "状态",
      width: 160,
    },
    { dataIndex: "chainName", title: "任务链", width: 180 },
  ]
  const accountColumns: TableColumnsType<DispatchAccount> = [
    {
      render: (_value: unknown, item: DispatchAccount) => item.deviceName || item.deviceHost || "-",
      title: "盒子",
      width: 180,
    },
    {
      render: (_value: unknown, item: DispatchAccount) => item.instanceIndex ?? "-",
      title: "坑位",
      width: 80,
    },
    {
      ellipsis: true,
      render: (_value: unknown, item: DispatchAccount) =>
        item.account.length > 0 ? item.account : "-",
      title: "账号",
      width: 240,
    },
    {
      render: (_value: unknown, item: DispatchAccount) =>
        item.proxyEndpoint.length > 0 ? item.proxyEndpoint : "-",
      title: "代理",
      width: 180,
    },
    {
      render: (_value: unknown, item: DispatchAccount) => (
        <Tag color={statusColor(item.status, item.runStatus)}>
          {statusLabel(item.status, item.missing, item.runStatus)}
        </Tag>
      ),
      title: "状态",
      width: 160,
    },
    {
      render: (_value: unknown, item: DispatchAccount) => (
        <ProgressCell finished={item.stepFinished} tone={item.stepTone} total={item.stepCount} />
      ),
      title: "总步骤数",
      width: 180,
    },
  ]

  return (
    <section className="module-page tasks-page">
      <Card className="condition-panel filter-bar" size="small">
        <LabelFilterRow
          multiple
          onChange={setStatusFilters}
          options={statusOptions}
          selected={statusFilters}
          system
          title="状态"
          tone="status"
        />
        <LabelFilterRow
          multiple
          onChange={setAccountFilters}
          options={accountOptions}
          selected={accountFilters}
          system
          title="账号"
        />
        <LabelFilterRow
          multiple
          onChange={setChainFilters}
          options={chainOptions}
          selected={chainFilters}
          system
          title="任务链"
        />
        <div className="resource-filter-actions">
          <Button
            onClick={() => {
              setStatusFilters([])
              setAccountFilters([])
              setChainFilters([])
              setFilterMode("and")
            }}
          >
            重置
          </Button>
          <FilterModeSwitch mode={filterMode} onChange={setFilterMode} />
        </div>
      </Card>
      <div className="resource-crud-toolbar">
        <Space wrap>
          <SelectionScopeSwitch onChange={setSelectionScope} scope={selectionScope} />
          {canWrite ? (
            <Button
              icon={<PlusOutlined aria-hidden />}
              onClick={() => setCreating(true)}
              type="primary"
            >
              新增
            </Button>
          ) : null}
          {canWrite ? (
            <Button
              disabled={selected.length === 0 || blocked}
              icon={<PlayCircleOutlined aria-hidden />}
              loading={starting}
              onClick={start}
              type="primary"
            >
              开始
            </Button>
          ) : null}
          {canWrite ? (
            <Button
              danger
              disabled={selected.length === 0}
              icon={<DeleteOutlined aria-hidden />}
              loading={clearing}
              onClick={clearRecords}
            >
              清空
            </Button>
          ) : null}
        </Space>
      </div>
      <Table
        columns={columns}
        dataSource={[...visible]}
        expandable={{
          expandedRowRender: (item: DispatchRow) => (
            <Table
              columns={accountColumns}
              dataSource={[...item.accounts]}
              expandable={{
                expandedRowRender: (account: DispatchAccount) => {
                  const loaded = stepsOf[account.id]
                  if (loaded === undefined || loaded.kind === "loading") {
                    return <span className="muted">加载中</span>
                  }
                  if (loaded.kind === "error") return <span className="muted">{loaded.message}</span>
                  if (loaded.segments.length === 0) return <span className="muted">没有步骤</span>
                  return <SegmentList segments={loaded.segments} />
                },
                onExpand: (expanded, account) => {
                  if (expanded) loadSteps(item.id, account.id)
                },
              }}
              pagination={false}
              rowKey="id"
              size="small"
            />
          ),
        }}
        pagination={{ ...dispatchPaging.pagination, total: visible.length }}
        rowKey="id"
        rowSelection={dispatchSelection}
        size="small"
      />
      {creating ? (
        <DispatchForm
          groupId={groupId}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            void reload()
          }}
        />
      ) : null}
    </section>
  )
}
