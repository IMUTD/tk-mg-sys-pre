import { DeleteOutlined } from "@ant-design/icons"
import { App, Button, Card, Input, Space, Table, type TableColumnsType } from "antd"
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

import {
  createDispatchApi,
  type DispatchRecordBox,
  type DispatchRecordTask,
} from "../tasks/dispatch-api"
import { createSeedTaskLogs, type TaskLog } from "./catalog"
import "../mall/mall.css"

type TaskRecordsPageProps = {
  readonly canWrite?: boolean
  readonly groupId?: string
}

const segmentsOf = (steps: DispatchRecordTask["steps"]) => {
  const groups = new Map<string, DispatchRecordTask["steps"][number][]>()
  for (const step of steps) {
    const key = `${step.stagePosition}:${step.repeatIndex}`
    const list = groups.get(key) ?? []
    list.push(step)
    groups.set(key, list)
  }
  return [...groups.entries()].map(([key, rows]) => {
    const head = rows[0]
    const latestAttempt = Math.max(...rows.map((item) => item.attempt))
    const latest = rows.find((item) => item.attempt === latestAttempt)
    const repeat =
      head !== undefined && head.repeatCount > 1
        ? ` 第 ${head.repeatIndex + 1}/${head.repeatCount} 次`
        : ""
    const title =
      head === undefined ? "" : `${head.stageName.length > 0 ? head.stageName : `第 ${head.stagePosition + 1} 段`}${repeat}`
    const used = latest?.autoUsed ?? 0
    const note =
      used > 0
        ? `已自动重跑 ${used}/${latest?.autoRetryLimit ?? 0} 次`
        : latest?.replayOrigin === "manual"
          ? "已手动重跑"
          : ""
    return {
      key,
      note,
      steps: rows,
      title,
    }
  })
}

const stepColumns: TableColumnsType<DispatchRecordTask["steps"][number]> = [
  { dataIndex: "sequence", title: "步骤", width: 80, render: (value: number) => value + 1 },
  {
    dataIndex: "skill",
    title: "接口",
    width: 180,
    render: (value: string, step) => (step.attempt > 1 ? `重跑 ${value}` : value),
  },
  { dataIndex: "status", title: "状态", width: 120 },
  {
    dataIndex: "parameters",
    title: "参数",
    render: (value: Record<string, string>) => JSON.stringify(value),
  },
]

const recordStatus = (task: DispatchRecordTask): string => {
  if (!task.started) return task.status === "incomplete" ? "参数未齐" : "待开始"
  const named = runLabel(task.runStatus ?? "")
  if (named.length > 0) return named
  const attempts = new Map<string, { attempt: number; priority: number; repeat: number; stage: number; status: string }>()
  for (const step of task.steps) {
    if (step.taskId.length === 0) continue
    const key = `${step.stagePosition}:${step.repeatIndex}`
    const current = attempts.get(key)
    if (current !== undefined && current.attempt > step.attempt) continue
    attempts.set(key, {
      attempt: step.attempt,
      priority: step.queuePriority ?? 0,
      repeat: step.repeatIndex,
      stage: step.stagePosition,
      status: step.taskStatus,
    })
  }
  const ordered = [...attempts.values()].sort((left, right) => left.stage - right.stage || left.repeat - right.repeat)
  if (ordered.length === 0) return "已下发"
  const current = ordered.every((item) => item.status === "succeeded")
    ? { priority: 0, status: "succeeded" }
    : ordered.find((item) => item.status !== "succeeded")
  if (current === undefined) return "已下发"
  if (current.status === "failed") return "失败"
  if (current.status === "cancelled") return "已取消"
  if (current.status === "succeeded") return "成功"
  if (current.priority === 1) return "重跑中"
  if (current.status === "running" || current.status === "ood") return "执行中"
  if (current.status === "queued" || current.status === "dispatching") return "排队中"
  return "已下发"
}

const runLabel = (status: string): string => {
  if (status === "replaying") return "重跑中"
  if (status === "running") return "执行中"
  if (status === "queued") return "排队中"
  if (status === "failed") return "失败"
  if (status === "succeeded") return "成功"
  if (status === "cancelled") return "已取消"
  return ""
}

const taskColumns: TableColumnsType<DispatchRecordTask> = [
  { dataIndex: "name", title: "任务", width: 180 },
  { dataIndex: "account", title: "账号", width: 180 },
  {
    title: "状态",
    width: 120,
    render: (_value: unknown, item: DispatchRecordTask) => recordStatus(item),
  },
]

const LiveRecords = ({
  canWrite,
  groupId,
}: {
  readonly canWrite: boolean
  readonly groupId: string
}): ReactNode => {
  const { message, modal } = App.useApp()
  const [boxes, setBoxes] = useState<readonly DispatchRecordBox[]>([])
  const [selectionScope, setSelectionScope] = useState<SelectionScope>("all")
  const [selected, setSelected] = useState<readonly string[]>([])
  const [clearing, setClearing] = useState(false)
  const reload = useCallback(() => {
    void createDispatchApi(groupId)
      .records()
      .then(setBoxes)
      .catch((error: unknown) => {
        message.error(error instanceof Error ? error.message : "保存失败")
      })
  }, [groupId, message])
  useEffect(() => {
    reload()
  }, [reload])
  const recordPaging = useClientPagination(groupId)
  const recordSelection = useFilteredRowSelection({
    onChange: (keys) => setSelected(keys.map((key) => String(key))),
    pageKeys: pageSlice(boxes, recordPaging.current, recordPaging.pageSize).map((item) => item.id),
    rowKey: "id",
    rows: boxes,
    selectedKeys: selected,
    selectionScope,
  })
  const clear = () => {
    const names = boxes.filter((box) => selected.includes(box.id)).map((box) => box.name)
    modal.confirm({
      cancelText: "取消",
      content: `将删除 ${names.join("、")} 上的任务记录。`,
      okButtonProps: { danger: true },
      okText: "清空",
      onOk: async () => {
        setClearing(true)
        try {
          const removed = await createDispatchApi(groupId).clearRecords({
            deviceIds: selected.filter((id) => id.length > 0),
            unassigned: selected.includes(""),
          })
          setSelected([])
          message.success(`已清空 ${removed.removed} 条任务`)
          reload()
        } catch (error: unknown) {
          message.error(error instanceof Error ? error.message : "保存失败")
        } finally {
          setClearing(false)
        }
      },
      title: "清空所选盒子的任务记录",
    })
  }
  return (
    <section className="module-page jobs-page">
      <Space wrap>
        {canWrite ? (
          <SelectionScopeSwitch onChange={setSelectionScope} scope={selectionScope} />
        ) : null}
        {canWrite ? (
          <Button
            danger
            disabled={selected.length === 0}
            icon={<DeleteOutlined aria-hidden />}
            loading={clearing}
            onClick={clear}
          >
            清空
          </Button>
        ) : null}
      </Space>
      <Table
        columns={[
          { dataIndex: "name", title: "盒子" },
          {
            title: "任务数",
            width: 100,
            render: (_value: unknown, item: DispatchRecordBox) => item.tasks.length,
          },
        ]}
        dataSource={[...boxes]}
        expandable={{
          expandedRowRender: (box: DispatchRecordBox) => (
            <Table
              columns={taskColumns}
              dataSource={[...box.tasks]}
              expandable={{
                expandedRowRender: (task: DispatchRecordTask) => (
                  <div>
                    {segmentsOf(task.steps).map((segment) => (
                      <div key={segment.key}>
                        <div style={{ margin: "8px 0" }}>{segment.title}</div>
                        {segment.note.length > 0 ? <div>{segment.note}</div> : null}
                        <Table
                          columns={stepColumns}
                          dataSource={segment.steps.map((step, index) => ({
                            ...step,
                            id: `${task.id}-${segment.key}-${index}`,
                          }))}
                          pagination={false}
                          rowKey="id"
                          size="small"
                        />
                      </div>
                    ))}
                  </div>
                ),
              }}
              pagination={false}
              rowKey="id"
              size="small"
            />
          ),
        }}
        pagination={{ ...recordPaging.pagination, total: boxes.length }}
        rowKey="id"
        {...(canWrite ? { rowSelection: recordSelection } : {})}
        size="small"
      />
    </section>
  )
}

const columns: TableColumnsType<TaskLog> = [
  { dataIndex: "id", title: "记录ID", width: 120 },
  { dataIndex: "feature", title: "功能", width: 140 },
  { dataIndex: "content", title: "内容" },
  { dataIndex: "createdAt", title: "创建时间", width: 180 },
  { dataIndex: "updatedAt", title: "更新时间", width: 180 },
]

export const TaskRecordsPage = ({
  canWrite = false,
  groupId = "",
}: TaskRecordsPageProps): ReactNode => {
  if (groupId.length > 0) return <LiveRecords canWrite={canWrite} groupId={groupId} />
  return <SeedRecords />
}

const SeedRecords = (): ReactNode => {
  const { message } = App.useApp()
  const [filterMode, setFilterMode] = useState<FilterMode>("and")
  const [keyword, setKeyword] = useState("")
  const seedPaging = useClientPagination(keyword)
  const rows = useMemo(
    () =>
      createSeedTaskLogs().filter((item) => {
        const hit =
          keyword.length === 0 || item.feature.includes(keyword) || item.content.includes(keyword)
        return hit && combineChecks(filterMode, [])
      }),
    [filterMode, keyword],
  )

  return (
    <section className="module-page jobs-page">
      <Card className="condition-panel filter-bar" size="small">
        <div className="condition-search">
          <span className="filter-label">搜索</span>
          <Input
            allowClear
            aria-label="功能"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="功能"
            style={{ width: 200 }}
            value={keyword}
          />
          <Button
            onClick={() => {
              setFilterMode("and")
              setKeyword("")
            }}
          >
            重置
          </Button>
          <FilterModeSwitch mode={filterMode} onChange={setFilterMode} />
        </div>
      </Card>
      <div className="resource-crud-toolbar">
        <Space wrap>
          <Button onClick={() => message.success("导出成功")}>导出</Button>
        </Space>
      </div>
      <Table
        columns={columns}
        dataSource={rows}
        pagination={{ ...seedPaging.pagination, total: rows.length }}
        rowKey="id"
        scroll={{ x: "max-content" }}
        size="small"
      />
    </section>
  )
}
