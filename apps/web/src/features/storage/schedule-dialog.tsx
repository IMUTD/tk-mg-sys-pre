import { Button, Form, Input, Modal, Select, Switch } from "antd"
import { type ReactNode, useState } from "react"

import {
  BACKUP_CYCLE_OPTIONS,
  type BackupSchedule,
  type StorageTarget,
  WEEKDAY_OPTIONS,
} from "./storage-target"

type ScheduleDialogProps = {
  readonly onCancel: () => void
  readonly onRun: (schedule: BackupSchedule) => void
  readonly onSubmit: (schedule: BackupSchedule) => void
  readonly target: StorageTarget
}

const normalizeTime = (value: string): string => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (match === null || match[1] === undefined || match[2] === undefined) return "02:00"
  const hour = Math.min(23, Number(match[1]))
  const minute = Math.min(59, Number(match[2]))
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`
}

export const ScheduleDialog = ({
  onCancel,
  onRun,
  onSubmit,
  target,
}: ScheduleDialogProps): ReactNode => {
  const [cycle, setCycle] = useState(target.schedule.cycle)
  const [enabled, setEnabled] = useState(target.schedule.enabled)
  const [time, setTime] = useState(target.schedule.time)
  const [weekday, setWeekday] = useState(target.schedule.weekday)

  const schedule = (): BackupSchedule => ({
    cycle,
    enabled,
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
          <Button onClick={() => onRun(schedule())}>立即备份</Button>
          <Button onClick={() => onSubmit(schedule())} type="primary">
            确认
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title={`定时备份 · ${target.name}`}
      width={460}
    >
      <Form labelCol={{ style: { width: 90 } }} layout="horizontal" size="small">
        <Form.Item label="启用">
          <Switch aria-label="启用定时备份" checked={enabled} onChange={setEnabled} />
        </Form.Item>
        <Form.Item label="备份周期">
          <Select
            aria-label="备份周期"
            onChange={setCycle}
            options={[...BACKUP_CYCLE_OPTIONS]}
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
        <Form.Item label="备份时间">
          <Input
            aria-label="备份时间"
            onChange={(event) => setTime(event.target.value)}
            placeholder="HH:mm"
            style={{ width: 160 }}
            value={time}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
