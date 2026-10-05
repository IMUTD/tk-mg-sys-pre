import { CopyOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons"
import { App, Button, Card, Progress, Space, Switch, Tag } from "antd"
import { type ReactNode, useEffect, useMemo, useState } from "react"

import { RobotFormDialog } from "./form-dialog"
import { LogsDialog } from "./logs-dialog"
import {
  advanceRun,
  createSeedRobots,
  displayStatus,
  duplicateRobot,
  emptyRobot,
  nextRunFromSchedule,
  nowText,
  type Robot,
  type RobotSchedule,
  scheduleLabel,
  scopeText,
  sortRobots,
  startRun,
  statusColor,
  statusLabel,
  toggleEnabled,
} from "./robot"
import "./robots.css"
import { ScheduleDialog } from "./schedule-dialog"

type RobotsPageProps = {
  readonly canDelete?: boolean
  readonly canWrite: boolean
}

const RUN_TICK_MS = 140

export const RobotsPage = ({ canDelete, canWrite }: RobotsPageProps): ReactNode => {
  const allowDelete = canDelete === true
  const { message, modal } = App.useApp()
  const [robots, setRobots] = useState<Robot[]>(() => createSeedRobots())
  const [editRecord, setEditRecord] = useState<Robot | null>(null)
  const [scheduleRobot, setScheduleRobot] = useState<Robot | null>(null)
  const [logRobot, setLogRobot] = useState<Robot | null>(null)
  const filtered = useMemo(() => sortRobots(robots), [robots])
  const nextId = Math.max(0, ...robots.map((item) => item.id)) + 1
  const hasRunning = robots.some((item) => item.run.status === "running")

  useEffect(() => {
    if (!hasRunning) return
    const timer = window.setInterval(() => {
      const stamp = nowText()
      setRobots((current) => current.map((item) => advanceRun(item, stamp)))
    }, RUN_TICK_MS)
    return () => window.clearInterval(timer)
  }, [hasRunning])

  const patchRobot = (id: number, updater: (item: Robot) => Robot): void => {
    setRobots((current) => current.map((item) => (item.id === id ? updater(item) : item)))
  }

  const confirmDelete = (robot: Robot): void => {
    void modal.confirm({
      cancelText: "取消",
      content: `确定删除「${robot.name}」吗？`,
      okText: "确定",
      onOk: () => {
        setRobots((current) => current.filter((item) => item.id !== robot.id))
        message.success("删除成功")
      },
      title: "提示",
    })
  }

  const runNow = (robot: Robot): void => {
    if (!robot.enabled) {
      message.warning("请先启用机器人")
      return
    }
    if (robot.run.status === "running") {
      message.warning("正在执行中")
      return
    }
    patchRobot(robot.id, startRun)
    message.success("已开始执行")
  }

  const saveSchedule = (robot: Robot, schedule: RobotSchedule, runImmediately: boolean): void => {
    const stamp = nowText()
    patchRobot(robot.id, (item) => {
      const next = {
        ...item,
        nextRunAt: nextRunFromSchedule(schedule, stamp),
        schedule,
        updateTime: stamp,
      }
      return runImmediately ? startRun({ ...next, enabled: true }) : next
    })
    setScheduleRobot(null)
    message.success(runImmediately ? "已保存并开始执行" : "周期任务已保存")
  }

  const copyRobot = (robot: Robot): void => {
    const stamp = nowText()
    setRobots((current) => [duplicateRobot(robot, nextId, stamp), ...current])
    message.success("已复制")
  }

  return (
    <section className="module-page robots-page">
      <div className="robots-kind-bar">
        <span className="robots-hint">机器人只负责按周期执行行为链，不区分 AI 或自动。</span>
        {canWrite ? (
          <Button
            icon={<PlusOutlined aria-hidden />}
            onClick={() => setEditRecord(emptyRobot(0, nowText()))}
            type="primary"
          >
            新增
          </Button>
        ) : null}
      </div>
      {filtered.length === 0 ? (
        <Card className="robots-empty">暂无运营机器人</Card>
      ) : (
        <div className="robots-card-grid">
          {filtered.map((item) => {
            const health = displayStatus(item)
            return (
              <Card
                className="robots-card"
                extra={
                  canWrite ? (
                    <Space size={0}>
                      <Switch
                        aria-label={`${item.name}启用`}
                        checked={item.enabled}
                        onChange={(checked) => {
                          const stamp = nowText()
                          patchRobot(item.id, (current) => toggleEnabled(current, checked, stamp))
                        }}
                        size="small"
                      />
                      <Button
                        icon={<EditOutlined aria-hidden />}
                        onClick={() => setEditRecord(item)}
                        size="small"
                        type="link"
                      >
                        编辑
                      </Button>
                      <Button
                        icon={<CopyOutlined aria-hidden />}
                        onClick={() => copyRobot(item)}
                        size="small"
                        type="link"
                      >
                        复制
                      </Button>
                      {allowDelete ? (
                        <Button danger onClick={() => confirmDelete(item)} size="small" type="link">
                          删除
                        </Button>
                      ) : null}
                    </Space>
                  ) : null
                }
                key={item.id}
                title={item.name}
              >
                <p className="robots-scope">{scopeText(item)}</p>
                <Space wrap>
                  <Tag color={statusColor(health)}>{statusLabel(health)}</Tag>
                  <Tag>{scheduleLabel(item.schedule)}</Tag>
                  {item.run.status === "success" ? <Tag color="success">最近成功</Tag> : null}
                </Space>
                <p className="robots-meta">
                  上次执行：{item.lastRunAt.length === 0 ? "暂无" : item.lastRunAt}
                </p>
                <p className="robots-meta">
                  下次执行：{item.nextRunAt.length === 0 ? "未排期" : item.nextRunAt}
                </p>
                {item.remark.length === 0 ? null : (
                  <p className="robots-meta">备注：{item.remark}</p>
                )}
                {item.run.status === "running" ? (
                  <Progress
                    format={() => `${item.run.done}/${item.run.total}`}
                    percent={item.run.percent}
                    size="small"
                    status="active"
                  />
                ) : null}
                <Space className="robots-card-actions" wrap>
                  {canWrite ? (
                    <>
                      <Button onClick={() => runNow(item)} type="primary">
                        立即执行
                      </Button>
                      <Button onClick={() => setScheduleRobot(item)}>周期任务</Button>
                    </>
                  ) : null}
                  <Button onClick={() => setLogRobot(item)}>日志</Button>
                </Space>
              </Card>
            )
          })}
        </div>
      )}
      {editRecord === null ? null : (
        <RobotFormDialog
          onCancel={() => setEditRecord(null)}
          onSubmit={(item) => {
            const stamp = nowText()
            const saved = {
              ...item,
              run: { ...item.run, total: item.accountCount },
              updateTime: stamp,
            }
            if (item.id === 0) {
              setRobots((current) => [{ ...saved, id: nextId }, ...current])
              message.success("新增成功")
            } else {
              setRobots((current) => current.map((entry) => (entry.id === item.id ? saved : entry)))
              message.success("修改成功")
            }
            setEditRecord(null)
          }}
          record={editRecord}
        />
      )}
      {scheduleRobot === null ? null : (
        <ScheduleDialog
          onCancel={() => setScheduleRobot(null)}
          onRun={(schedule) => saveSchedule(scheduleRobot, schedule, true)}
          onSubmit={(schedule) => saveSchedule(scheduleRobot, schedule, false)}
          robot={scheduleRobot}
        />
      )}
      {logRobot === null ? null : (
        <LogsDialog onCancel={() => setLogRobot(null)} robot={logRobot} />
      )}
    </section>
  )
}
