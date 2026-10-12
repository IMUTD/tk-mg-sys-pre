import { DeleteOutlined } from "@ant-design/icons"
import { App, Button, Card, Input, Space, Table, type TableColumnsType } from "antd"
import { type Key, type ReactNode, useCallback, useEffect, useMemo, useState } from "react"

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
      {canWrite ? (
        <Space wrap>
          <Button
            danger
            disabled={selected.length === 0}
            icon={<DeleteOutlined aria-hidden />}
            loading={clearing}
            onClick={clear}
          >
            清空
          </Button>
        </Space>
      ) : null}
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
        pagination={false}
        rowKey="id"
        {...(canWrite
          ? {
              rowSelection: {
                onChange: (keys: readonly Key[]) => setSelected(keys.map((key) => String(key))),
                selectedRowKeys: [...selected],
              },
            }
          : {})}
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
  const [keyword, setKeyword] = useState("")
  const [applied, setApplied] = useState("")
  const rows = useMemo(
    () =>
      createSeedTaskLogs().filter((item) => {
        if (applied.length === 0) return true
        return item.feature.includes(applied) || item.content.includes(applied)
      }),
    [applied],
  )

  return (
    <section className="module-page jobs-page">
      <Card size="small">
        <Space wrap>
          <Input
            allowClear
            aria-label="功能"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="功能"
            style={{ width: 200 }}
            value={keyword}
          />
          <Button onClick={() => setApplied(keyword)} type="primary">
            搜索
          </Button>
          <Button
            onClick={() => {
              setKeyword("")
              setApplied("")
            }}
          >
            重置
          </Button>
          <Button onClick={() => message.success("导出成功")}>导出</Button>
        </Space>
      </Card>
      <Table
        columns={columns}
        dataSource={rows}
        pagination={false}
        rowKey="id"
        scroll={{ x: "max-content" }}
        size="small"
      />
    </section>
  )
}
