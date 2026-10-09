import {
  CopyOutlined,
  DeleteOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SearchOutlined,
  StopOutlined,
} from "@ant-design/icons"
import type { TableColumnsType } from "antd"
import { App, Button, Card, Input, Progress, Select, Space, Table, Tag } from "antd"
import type { Key } from "react"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"

import { TaskFormDialog } from "./form-dialog"
import { TaskLogDialog } from "./logs-dialog"
import {
  calcProgress,
  childTasksOf,
  createSeedTaskDevices,
  createSeedTaskScripts,
  createSeedTasks,
  createTasksFromForm,
  DEVICE_SEQ_OPTIONS,
  deleteTasks,
  deviceById,
  deviceLabel,
  emptyTask,
  emptyTaskQuery,
  filterTasks,
  groupedDeviceOptions,
  killTasks,
  MAIN_TASK_OPTIONS,
  type MytTask,
  nowText,
  runningTasks,
  scriptById,
  shortDate,
  startTasks,
  TASK_STATUS_OPTIONS,
  type TaskQuery,
  type TaskScript,
  TEMPLATE_OPTIONS,
  taskStatusColor,
  taskStatusLabel,
} from "./myt-task"
import { RunningTaskDialog } from "./running-dialog"
import "./tasks.css"
import { PageKey } from "../../lib/pages"
import { BusinessLabelFilter } from "../labels/filter-row"

type TaskListPageProps = {
  readonly canDelete?: boolean
  readonly canWrite: boolean
}

const taskFromSearchParams = (
  scripts: readonly TaskScript[],
  params: URLSearchParams,
): MytTask | null => {
  const scriptRaw = params.get("scriptId")
  const deviceRaw = params.get("deviceId")
  const seqRaw = params.get("deviceSeq")
  if (scriptRaw === null && deviceRaw === null) return null
  const scriptId = Number(scriptRaw ?? "")
  const deviceId = Number(deviceRaw ?? "")
  const deviceSeq = Number(seqRaw ?? "")
  const script =
    Number.isFinite(scriptId) && scriptId > 0 ? scriptById(scripts, scriptId) : undefined
  const hasDevice = Number.isFinite(deviceId) && deviceId > 0
  const hasSeq = Number.isFinite(deviceSeq) && deviceSeq > 0
  return {
    ...emptyTask(0, nowText()),
    deviceId: hasDevice ? deviceId : null,
    deviceIds: hasDevice ? [deviceId] : [],
    deviceSeq: hasSeq ? deviceSeq : null,
    deviceSeqs: hasSeq ? [deviceSeq] : [],
    name: script?.title ?? "",
    scriptCode: script?.code ?? "",
    scriptId: script?.id ?? 0,
    scriptName: script?.title ?? "",
  }
}

export const TaskListPage = ({ canDelete, canWrite }: TaskListPageProps): ReactNode => {
  const allowDelete = canDelete === true
  const { message, modal } = App.useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  const [draft, setDraft] = useState<TaskQuery>(emptyTaskQuery)
  const [query, setQuery] = useState<TaskQuery>(emptyTaskQuery)
  const [tasks, setTasks] = useState<MytTask[]>(() => createSeedTasks())
  const [devices] = useState(() => createSeedTaskDevices())
  const [scripts] = useState(() => createSeedTaskScripts())
  const [selectedIds, setSelectedIds] = useState<readonly number[]>([])
  const [editRecord, setEditRecord] = useState<MytTask | null>(() =>
    taskFromSearchParams(createSeedTaskScripts(), searchParams),
  )
  const [logTask, setLogTask] = useState<MytTask | null>(null)
  const [runningOpen, setRunningOpen] = useState(false)
  const [deviceGroup, setDeviceGroup] = useState("")

  const filtered = useMemo(
    () =>
      filterTasks(tasks, query).filter(
        (task) => deviceGroup === "" || deviceById(devices, task.deviceId)?.tag === deviceGroup,
      ),
    [query, tasks, devices, deviceGroup],
  )
  const running = runningTasks(tasks)
  const nextId = Math.max(0, ...tasks.map((item) => item.id)) + 1
  const deviceGroups = groupedDeviceOptions(devices)

  useEffect(() => {
    if (searchParams.get("scriptId") === null && searchParams.get("deviceId") === null) return
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  const applyQuery = (next = draft): void => {
    setDraft(next)
    setQuery(next)
    setSelectedIds([])
  }

  const changeSelectQuery = (patch: Partial<TaskQuery>): void => {
    applyQuery({ ...draft, ...patch })
  }

  const resetQuery = (): void => {
    setDeviceGroup("")
    const empty = emptyTaskQuery()
    setDraft(empty)
    setQuery(empty)
    setSelectedIds([])
  }

  const deleteIds = (ids: readonly number[], withChildren: boolean): void => {
    setTasks((current) => deleteTasks(current, ids, withChildren))
    setSelectedIds((current) => current.filter((id) => !ids.includes(id)))
  }

  const confirmDelete = (ids: readonly number[]): void => {
    const targets = tasks.filter((item) => ids.includes(item.id))
    const hasChildren = targets.some((item) => item.childCount > 0)
    void modal.confirm({
      cancelText: "取消",
      content: hasChildren
        ? "当前任务包含子任务,是否要同步删除子任务,删除任务不会终止已下发任务"
        : "确定删除吗？",
      okText: hasChildren ? "同步删除子任务" : "确定",
      onOk: () => {
        deleteIds(ids, hasChildren)
        message.success("删除成功")
      },
      title: "提示",
    })
  }

  const startOne = (task: MytTask): void => {
    setTasks((current) => startTasks(current, [task.id], nowText()))
    message.success("已启动任务")
  }

  const killOne = (task: MytTask): void => {
    void modal.confirm({
      cancelText: "取消",
      content: "确定要终止该任务吗?",
      okText: "确定",
      onOk: () => {
        setTasks((current) => killTasks(current, [task.id], nowText()))
        message.success("已终止")
      },
      title: "提示",
    })
  }

  const columns: TableColumnsType<MytTask> = [
    {
      key: "childCount",
      render: (_value: unknown, item: MytTask) =>
        item.childCount > 0 ? <Tag>{item.childCount}</Tag> : null,
      title: "展开子任务",
      width: 100,
    },
    {
      key: "id",
      render: (_value: unknown, item: MytTask) => (
        <Space size={4}>
          <Tag color={item.main ? "success" : "default"} title={item.main ? "主任务" : "子任务"}>
            {item.id}
          </Tag>
          {item.template ? <Tag color="gold">模板</Tag> : null}
        </Space>
      ),
      title: "任务ID",
      width: 140,
    },
    {
      key: "device",
      render: (_value: unknown, item: MytTask) =>
        deviceLabel(deviceById(devices, item.deviceId), item.deviceSeq),
      title: "设备/机位",
      width: 140,
    },
    {
      key: "scriptName",
      render: (_value: unknown, item: MytTask) => {
        const script = scriptById(scripts, item.scriptId)
        return (
          <Space size={4}>
            <span>{item.scriptName}</span>
            {script !== undefined ? <Tag>v{script.version}</Tag> : null}
          </Space>
        )
      },
      title: "功能",
      width: 160,
    },
    {
      key: "status",
      render: (_value: unknown, item: MytTask) => (
        <Space size={4} wrap>
          <Tag color={taskStatusColor(item.status)}>{taskStatusLabel(item.status)}</Tag>
          {item.status === "2" ? <Tag color="processing">运行中</Tag> : null}
        </Space>
      ),
      title: "状态",
      width: 140,
    },
    { dataIndex: "name", ellipsis: true, key: "name", title: "任务名" },
    {
      key: "progress",
      render: (_value: unknown, item: MytTask) => (
        <Progress percent={calcProgress(item)} size="small" status="success" />
      ),
      title: "执行进度",
      width: 120,
    },
    {
      key: "planTime",
      render: (_value: unknown, item: MytTask) => (
        <div className="task-time-cell">
          <div>计划时间: {shortDate(item.planTime)}</div>
          <div>执行时间: {shortDate(item.executeTime)}</div>
        </div>
      ),
      title: "计划时间",
      width: 170,
    },
    {
      key: "createTime",
      render: (_value: unknown, item: MytTask) => (
        <div className="task-time-cell">
          <div>创建时间: {shortDate(item.createTime)}</div>
          <div>更新时间: {shortDate(item.updateTime)}</div>
        </div>
      ),
      title: "创建时间",
      width: 170,
    },
    ...(canWrite
      ? [
          {
            align: "center" as const,
            fixed: "right" as const,
            key: "actions",
            render: (_value: unknown, item: MytTask) => (
              <Space size={0} wrap>
                {item.status === "0" || item.status === "6" ? (
                  <Button
                    icon={<PlayCircleOutlined aria-hidden />}
                    onClick={() => startOne(item)}
                    size="small"
                    type="link"
                  >
                    启动
                  </Button>
                ) : null}
                {item.status === "1" || item.status === "2" || item.status === "6" ? (
                  <Button
                    danger
                    icon={<StopOutlined aria-hidden />}
                    onClick={() => killOne(item)}
                    size="small"
                    type="link"
                  >
                    终止
                  </Button>
                ) : null}
                <Button
                  icon={<CopyOutlined aria-hidden />}
                  onClick={() => setEditRecord({ ...item, id: 0, template: false })}
                  size="small"
                  type="link"
                >
                  复制
                </Button>
                <Button
                  icon={<FileTextOutlined aria-hidden />}
                  onClick={() => setLogTask(item)}
                  size="small"
                  type="link"
                >
                  日志
                </Button>
                {allowDelete ? (
                  <Button danger onClick={() => confirmDelete([item.id])} size="small" type="link">
                    删除
                  </Button>
                ) : null}
              </Space>
            ),
            title: "操作",
            width: 220,
          },
        ]
      : [
          {
            align: "center" as const,
            fixed: "right" as const,
            key: "actions",
            render: (_value: unknown, item: MytTask) => (
              <Button onClick={() => setLogTask(item)} size="small" type="link">
                日志
              </Button>
            ),
            title: "操作",
            width: 80,
          },
        ]),
  ]

  return (
    <section className="module-page tasks-page">
      <Card className="filter-bar" size="small">
        <BusinessLabelFilter
          page={PageKey.Tasks}
          title="设备分组"
          options={deviceGroups
            .filter((group) => group.label !== "未分组")
            .map((group) => ({ value: group.label, label: group.label }))}
          value={deviceGroup}
          onChange={(group) => {
            setDeviceGroup(group)
            changeSelectQuery({ deviceId: "" })
          }}
        />
        <Space className="resource-filter-row" wrap>
          <span className="filter-label">任务ID</span>
          <Input
            allowClear
            aria-label="任务ID"
            onChange={(event) => setDraft({ ...draft, id: event.target.value })}
            onPressEnter={() => applyQuery()}
            style={{ width: 100 }}
            value={draft.id}
          />
          <span className="filter-label">任务名</span>
          <Input
            allowClear
            aria-label="任务名"
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="任务名"
            style={{ width: 160 }}
            value={draft.name}
          />
          <span className="filter-label">功能</span>
          <Input
            allowClear
            aria-label="功能"
            onChange={(event) => setDraft({ ...draft, scriptName: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="功能"
            style={{ width: 140 }}
            value={draft.scriptName}
          />
          <span className="filter-label">设备</span>
          <Select
            allowClear
            aria-label="设备"
            onChange={(value: string | undefined) => changeSelectQuery({ deviceId: value ?? "" })}
            options={devices
              .filter((device) => deviceGroup === "" || device.tag === deviceGroup)
              .map((device) => ({ value: String(device.id), label: deviceLabel(device, null) }))}
            placeholder="设备"
            style={{ width: 220 }}
            value={draft.deviceId || undefined}
          />
          <span className="filter-label">机位</span>
          <Select
            allowClear
            aria-label="机位"
            onChange={(value: number | null) =>
              changeSelectQuery({ deviceSeq: value === null ? "" : String(value) })
            }
            options={DEVICE_SEQ_OPTIONS.map((item) => ({ label: String(item), value: item }))}
            placeholder="机位"
            style={{ width: 90 }}
            value={draft.deviceSeq.length === 0 ? null : Number(draft.deviceSeq)}
            virtual={false}
          />
          <span className="filter-label">状态</span>
          <Select
            allowClear
            aria-label="状态"
            onChange={(value: string | null) => changeSelectQuery({ status: value ?? "" })}
            options={TASK_STATUS_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
            placeholder="状态"
            style={{ width: 110 }}
            value={draft.status.length === 0 ? null : draft.status}
            virtual={false}
          />
          <span className="filter-label">模板</span>
          <Select
            allowClear
            aria-label="模板"
            onChange={(value: string | null) => changeSelectQuery({ template: value ?? "" })}
            options={[...TEMPLATE_OPTIONS]}
            placeholder="模板"
            style={{ width: 90 }}
            value={draft.template.length === 0 ? null : draft.template}
            virtual={false}
          />
          <span className="filter-label">主任务</span>
          <Select
            aria-label="主任务"
            onChange={(value: string) => changeSelectQuery({ main: value })}
            options={[...MAIN_TASK_OPTIONS]}
            style={{ width: 150 }}
            value={draft.main}
            virtual={false}
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
            <Button
              icon={<PlusOutlined aria-hidden />}
              onClick={() => setEditRecord(emptyTask(0, nowText()))}
              type="primary"
            >
              新增
            </Button>
          ) : null}
          {allowDelete ? (
            <Button
              danger
              disabled={selectedIds.length === 0}
              icon={<DeleteOutlined aria-hidden />}
              onClick={() => confirmDelete(selectedIds)}
            >
              删除
            </Button>
          ) : null}
        </Space>
        <Space wrap>
          <Button onClick={() => setRunningOpen(true)} type="primary">
            查看正在执行 [{running.length}]
          </Button>
          <span className="task-history-tip">
            任务历史数据仅保留30天。任务下发后,大约需要1分钟时间准备数据,请耐心等待
          </span>
        </Space>
      </div>
      <Table
        columns={columns}
        dataSource={filtered}
        expandable={{
          expandedRowRender: (item: MytTask) => (
            <Table
              columns={columns.filter((column) => column.key !== "childCount")}
              dataSource={childTasksOf(tasks, item.id)}
              pagination={false}
              rowKey="id"
              scroll={{ x: "max-content" }}
              size="small"
            />
          ),
          rowExpandable: (item: MytTask) => item.childCount > 0,
        }}
        pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
        rowKey="id"
        rowSelection={{
          getCheckboxProps: (item: MytTask) => ({
            "aria-label": `选择 ${item.name}`,
          }),
          onChange: (keys: readonly Key[]) => setSelectedIds(keys.map((key) => Number(key))),
          selectedRowKeys: [...selectedIds],
        }}
        scroll={{ x: "max-content" }}
        size="small"
      />
      {editRecord === null ? null : (
        <TaskFormDialog
          devices={devices}
          onCancel={() => setEditRecord(null)}
          onSubmit={(item, immediate) => {
            const created = createTasksFromForm(
              {
                delayTime: item.delayTime,
                deviceIds: item.deviceIds,
                deviceSeqs: item.deviceSeqs,
                immediate,
                name: item.name,
                planTime: item.planTime,
                proxyIds: item.proxyIds,
                remark: item.remark,
                script: scriptById(scripts, item.scriptId) ?? {
                  code: item.scriptCode,
                  id: item.scriptId,
                  name: item.scriptCode,
                  title: item.scriptName,
                  version: "1.0.0",
                },
                template: item.template,
              },
              nextId,
              nowText(),
            )
            setTasks((current) => [...created, ...current])
            message.success(immediate ? "新增成功，已开始执行" : "新增成功，请在列表手动启动")
            setEditRecord(null)
          }}
          record={editRecord}
          scripts={scripts}
        />
      )}
      {logTask === null ? null : <TaskLogDialog onCancel={() => setLogTask(null)} task={logTask} />}
      {runningOpen ? (
        <RunningTaskDialog
          devices={devices}
          onCancel={() => setRunningOpen(false)}
          onKill={(ids) => {
            setTasks((current) => killTasks(current, ids, nowText()))
            message.success("已终止")
          }}
          tasks={tasks}
        />
      ) : null}
    </section>
  )
}
