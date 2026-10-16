import { DeleteOutlined } from "@ant-design/icons"
import { App, Button, Card, Input, Space, Table, type TableColumnsType } from "antd"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { useFilteredRowSelection } from "../../components/tables/filtered-selection"
import {
  type FilterMode,
  type SelectionScope,
  FilterModeSwitch,
  SelectionScopeSwitch,
  pageSlice,
  useClientPagination,
} from "../../components/tables/operation-controls"

import { createDispatchApi, type DispatchRecordBox, type DispatchRecordTask } from "../tasks/dispatch-api"
import { createSeedTaskLogs, type TaskLog } from "./catalog"
import "../mall/mall.css"

type TaskRecordsPageProps = {
  readonly canWrite?: boolean
  readonly groupId?: string
}

const stepColumns: TableColumnsType<DispatchRecordTask["steps"][number]> = [
  { dataIndex: "sequence", title: "步骤", width: 80, render: (value: number) => value + 1 },
  { dataIndex: "skill", title: "接口", width: 180 },
  { dataIndex: "status", title: "状态", width: 120 },
  {
    dataIndex: "parameters",
    title: "参数",
    render: (value: Record<string, string>) => JSON.stringify(value),
  },
]

const taskColumns: TableColumnsType<DispatchRecordTask> = [
  { dataIndex: "name", title: "任务", width: 180 },
  { dataIndex: "account", title: "账号", width: 180 },
  {
    title: "状态",
    width: 120,
    render: (_value: unknown, item: DispatchRecordTask) =>
      item.started ? item.status : item.status === "incomplete" ? "参数未齐" : "待开始",
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
                  <Table
                    columns={stepColumns}
                    dataSource={task.steps.map((step) => ({ ...step, id: `${task.id}-${step.sequence}` }))}
                    pagination={false}
                    rowKey="id"
                    size="small"
                  />
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

export const TaskRecordsPage = ({ canWrite = false, groupId = "" }: TaskRecordsPageProps): ReactNode => {
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
        if (keyword.length === 0) return true
        return item.feature.includes(keyword) || item.content.includes(keyword)
      }),
    [keyword],
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
