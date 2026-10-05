import { App, Button, Form, Input, InputNumber, Modal, Select, Switch } from "antd"
import { type ReactNode, useMemo, useState } from "react"

import {
  DEVICE_SEQ_OPTIONS,
  emptyTask,
  groupedDeviceOptions,
  type MytTask,
  type TaskDevice,
  type TaskScript,
} from "./myt-task"

type TaskFormDialogProps = {
  readonly devices: readonly TaskDevice[]
  readonly onCancel: () => void
  readonly onSubmit: (task: MytTask, immediate: boolean) => void
  readonly record: MytTask
  readonly scripts: readonly TaskScript[]
}

export const TaskFormDialog = ({
  devices,
  onCancel,
  onSubmit,
  record,
  scripts,
}: TaskFormDialogProps): ReactNode => {
  const { message } = App.useApp()
  const [delayTime, setDelayTime] = useState(record.delayTime)
  const [deviceIds, setDeviceIds] = useState<number[]>(
    record.deviceIds.length > 0
      ? [...record.deviceIds]
      : record.deviceId === null
        ? []
        : [record.deviceId],
  )
  const [deviceSeqs, setDeviceSeqs] = useState<number[]>(
    record.deviceSeqs.length > 0
      ? [...record.deviceSeqs]
      : record.deviceSeq === null
        ? []
        : [record.deviceSeq],
  )
  const [immediate, setImmediate] = useState(false)
  const [name, setName] = useState(record.name)
  const [planTime, setPlanTime] = useState(record.planTime ?? "")
  const [remark, setRemark] = useState(record.remark)
  const [scriptId, setScriptId] = useState<number | null>(
    record.scriptId === 0 ? null : record.scriptId,
  )
  const [template, setTemplate] = useState(record.template)
  const scriptOptions = scripts.map((item) => ({
    label: `${item.title} (v${item.version})`,
    value: item.id,
  }))
  const deviceGroups = useMemo(() => groupedDeviceOptions(devices), [devices])

  const submit = (): void => {
    const script = scripts.find((item) => item.id === scriptId)
    if (script === undefined) {
      message.error("请选择功能")
      return
    }
    if (deviceIds.length === 0) {
      message.error("请选择设备")
      return
    }
    if (deviceSeqs.length === 0) {
      message.error("请选择机位")
      return
    }
    onSubmit(
      {
        ...emptyTask(record.id, record.createTime),
        delayTime,
        deviceId: deviceIds[0] ?? null,
        deviceIds,
        deviceSeq: deviceSeqs[0] ?? null,
        deviceSeqs,
        id: record.id,
        name: name.trim().length === 0 ? script.title : name.trim(),
        planTime: planTime.trim().length === 0 ? null : planTime.trim(),
        remark,
        scriptCode: script.code,
        scriptId: script.id,
        scriptName: script.title,
        template,
      },
      immediate,
    )
  }

  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel} type="text">
            取消
          </Button>
          <Button onClick={submit} type="primary">
            确认
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title="新增任务"
      width={720}
    >
      <Form labelCol={{ style: { width: 100 } }} layout="horizontal" size="small">
        <Form.Item label="功能" required>
          <Select
            aria-label="功能"
            onChange={(value: number) => {
              setScriptId(value)
              const script = scripts.find((item) => item.id === value)
              if (name.trim().length === 0 && script !== undefined) setName(script.title)
            }}
            options={scriptOptions}
            placeholder="请选择"
            value={scriptId}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="设备" required>
          <Select
            aria-label="设备"
            mode="multiple"
            onChange={(value: number[]) => setDeviceIds(value)}
            optionFilterProp="label"
            options={deviceGroups}
            placeholder="请选择"
            value={deviceIds}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="机位" required>
          <Select
            aria-label="机位"
            mode="multiple"
            onChange={(value: number[]) => setDeviceSeqs(value)}
            options={DEVICE_SEQ_OPTIONS.map((item) => ({ label: String(item), value: item }))}
            placeholder="请选择"
            value={deviceSeqs}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="任务名">
          <Input
            aria-label="任务名"
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </Form.Item>
        <Form.Item label="备注">
          <Input.TextArea
            aria-label="备注"
            onChange={(event) => setRemark(event.target.value)}
            rows={2}
            value={remark}
          />
        </Form.Item>
        <Form.Item label="延迟执行">
          <InputNumber
            addonAfter="秒"
            aria-label="延迟执行"
            min={0}
            onChange={(value) => setDelayTime(value ?? 0)}
            value={delayTime}
          />
        </Form.Item>
        <Form.Item label="计划时间">
          <Input
            aria-label="计划时间"
            onChange={(event) => setPlanTime(event.target.value)}
            placeholder="YYYY-MM-DD HH:mm:ss，可稍后手动启动"
            value={planTime}
          />
        </Form.Item>
        <Form.Item label="保存模板">
          <Switch checked={template} onChange={setTemplate} />
        </Form.Item>
        <Form.Item label="立即执行">
          <Switch checked={immediate} onChange={setImmediate} />
          <span className="form-hint">默认不自动执行，需在列表手动启动</span>
        </Form.Item>
      </Form>
    </Modal>
  )
}
