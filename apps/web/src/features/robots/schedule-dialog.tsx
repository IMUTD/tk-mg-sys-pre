import { Button, Form, Input, InputNumber, Modal, Select, Switch } from "antd"
import { type ReactNode, useState } from "react"

import { type Robot, type RobotSchedule, SCHEDULE_CYCLE_OPTIONS, WEEKDAY_OPTIONS } from "./robot"

type ScheduleDialogProps = {
  readonly onCancel: () => void
  readonly onRun: (schedule: RobotSchedule) => void
  readonly onSubmit: (schedule: RobotSchedule) => void
  readonly robot: Robot
}

const normalizeTime = (value: string): string => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (match === null || match[1] === undefined || match[2] === undefined) return "09:00"
  const hour = Math.min(23, Number(match[1]))
  const minute = Math.min(59, Number(match[2]))
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`
}

export const ScheduleDialog = ({
  onCancel,
  onRun,
  onSubmit,
  robot,
}: ScheduleDialogProps): ReactNode => {
  const [cycle, setCycle] = useState(robot.schedule.cycle)
  const [enabled, setEnabled] = useState(robot.schedule.enabled)
  const [intervalHours, setIntervalHours] = useState(robot.schedule.intervalHours)
  const [time, setTime] = useState(robot.schedule.time)
  const [weekday, setWeekday] = useState(robot.schedule.weekday)

  const schedule = (): RobotSchedule => ({
    cycle,
    enabled,
    intervalHours: Math.max(1, intervalHours),
    time: normalizeTime(time),
    weekday,
  })

  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel} type="text">
            取消
          </Button>
          <Button onClick={() => onRun(schedule())}>立即执行</Button>
          <Button onClick={() => onSubmit(schedule())} type="primary">
            确认
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title={`周期任务 · ${robot.name}`}
      width={460}
    >
      <Form labelCol={{ style: { width: 90 } }} layout="horizontal" size="small">
        <Form.Item label="启用">
          <Switch aria-label="启用周期任务" checked={enabled} onChange={setEnabled} />
        </Form.Item>
        <Form.Item label="执行周期">
          <Select
            aria-label="执行周期"
            onChange={setCycle}
            options={[...SCHEDULE_CYCLE_OPTIONS]}
            style={{ width: 280 }}
            value={cycle}
            virtual={false}
          />
        </Form.Item>
        {cycle === "weekly" ? (
          <Form.Item label="星期">
            <Select
              aria-label="星期"
              onChange={setWeekday}
              options={[...WEEKDAY_OPTIONS]}
              style={{ width: 280 }}
              value={weekday}
              virtual={false}
            />
          </Form.Item>
        ) : null}
        {cycle === "interval" ? (
          <Form.Item label="间隔小时">
            <InputNumber
              aria-label="间隔小时"
              max={24}
              min={1}
              onChange={(value) => setIntervalHours(value ?? 1)}
              style={{ width: 160 }}
              value={intervalHours}
            />
          </Form.Item>
        ) : (
          <Form.Item label="执行时间">
            <Input
              aria-label="执行时间"
              onChange={(event) => setTime(event.target.value)}
              placeholder="HH:mm"
              style={{ width: 160 }}
              value={time}
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}
