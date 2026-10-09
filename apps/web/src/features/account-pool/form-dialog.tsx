import { Alert, App, Button, Form, Input, InputNumber, Modal, Select } from "antd"
import { type ReactNode, useState } from "react"
import { type AccountPoolsApi, type PoolWrite, poolRequestError } from "./api"
import {
  CREATE_BACK_TYPE_OPTIONS,
  DEVICE_SEQ_OPTIONS,
  type MytTaskRes,
  needsDevice,
  needsSeq,
  POOL_BACK_TYPE_OPTIONS,
  validatePoolKey,
} from "./myt-task-res"
import { type PoolDeskDevice, poolFormQuery, sourceFilter, usePoolSources } from "./wiring"

type TaskResFormDialogProps = {
  readonly devices: readonly PoolDeskDevice[]
  readonly api: AccountPoolsApi
  readonly groupId: string
  readonly onCancel: () => void
  readonly onSubmit: (pool: PoolWrite) => Promise<void>
  readonly record: MytTaskRes
}

export const TaskResFormDialog = ({
  devices,
  api,
  groupId,
  onCancel,
  onSubmit,
  record,
}: TaskResFormDialogProps): ReactNode => {
  const { message } = App.useApp()
  const [backType, setBackType] = useState(record.backType)
  const [deviceId, setDeviceId] = useState<number | null>(record.deviceId)
  const [deviceSeq, setDeviceSeq] = useState<number | null>(record.deviceSeq)
  const [key, setKey] = useState(record.key)
  const [remark, setRemark] = useState(record.remark)
  const [tag, setTag] = useState<readonly string[]>(record.tag)
  const [times, setTimes] = useState(record.times)
  const [savedQuery, setSavedQuery] = useState(() => poolFormQuery(record))
  const [saving, setSaving] = useState(false)
  const tagQuery = {
    ...savedQuery,
    backType,
    deviceId,
    deviceSeq,
    tag,
  }
  const source = usePoolSources(groupId, api, tagQuery, devices)
  const tagOptions = source.groups
  const count = source.total

  const changeBackType = (value: string): void => {
    setBackType(value)
    setDeviceId(null)
    setDeviceSeq(null)
    setTag([])
    setSavedQuery(poolFormQuery({ ...record, filterCondition: "" }))
  }

  const refreshTags = (): void => {
    if (needsDevice(backType) && deviceId === null) {
      message.error("请选择设备")
      return
    }
    source.refresh()
  }

  const submit = async (): Promise<void> => {
    if (saving || source.loading || source.error) return
    const keyError = validatePoolKey(key)
    if (keyError !== null) {
      message.error(keyError)
      return
    }
    if (needsDevice(backType) && deviceId === null) {
      message.error("请选择设备")
      return
    }
    if (tag.length === 0 && record.filterCondition.length === 0) {
      message.error("标签不能为空")
      return
    }
    if (count <= 0) {
      message.error("总数必须大于0")
      return
    }
    setSaving(true)
    try {
      await onSubmit({
        filter: sourceFilter(
          { ...tagQuery, deviceSeq: needsSeq(backType) ? deviceSeq : null },
          devices,
        ),
        key: key.trim(),
        mode: "all",
        remark,
        times,
      })
    } catch (error) {
      message.error(await poolRequestError(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel} type="text">
            取消
          </Button>
          <Button
            disabled={source.loading || source.error}
            loading={saving}
            onClick={() => void submit()}
            type="primary"
          >
            确认
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title="新增账号池"
      width={520}
    >
      {source.error ? <Alert type="error" showIcon message="候选账号加载失败" /> : null}
      <Form labelCol={{ style: { width: 90 } }} layout="horizontal" size="small">
        <Form.Item label="账号池名" required>
          <Input
            aria-label="账号池名"
            onChange={(event) => setKey(event.target.value)}
            placeholder="不能包含 +"
            value={key}
          />
        </Form.Item>
        <Form.Item label="重复次数">
          <InputNumber
            aria-label="重复次数"
            max={20}
            min={1}
            onChange={(value) => setTimes(value ?? 1)}
            value={times}
          />
        </Form.Item>
        <Form.Item label="备份类型">
          <Select
            aria-label="备份类型"
            onChange={changeBackType}
            options={[
              ...POOL_BACK_TYPE_OPTIONS,
              ...CREATE_BACK_TYPE_OPTIONS.filter(
                (item) =>
                  !POOL_BACK_TYPE_OPTIONS.some((option) => String(option.value) === item.value) &&
                  item.value === backType,
              ),
            ]}
            style={{ width: 280 }}
            value={backType}
            virtual={false}
          />
        </Form.Item>
        {needsDevice(backType) ? (
          <Form.Item label="设备" required>
            <Select
              allowClear
              aria-label="设备"
              onChange={(value: number | null) => {
                setDeviceId(value ?? null)
                setTag([])
              }}
              options={devices.map((item) => ({
                label: `${item.ip}-${item.name}`,
                value: item.id,
              }))}
              placeholder="请选择"
              style={{ width: 280 }}
              value={deviceId}
              virtual={false}
            />
          </Form.Item>
        ) : null}
        {needsSeq(backType) ? (
          <Form.Item label="序号">
            <Select
              allowClear
              aria-label="序号"
              onChange={(value: number | null) => setDeviceSeq(value ?? null)}
              options={DEVICE_SEQ_OPTIONS.map((item) => ({ label: String(item), value: item }))}
              placeholder="请选择"
              style={{ width: 160 }}
              value={deviceSeq}
              virtual={false}
            />
          </Form.Item>
        ) : null}
        <Form.Item label="账号分组" required>
          <Select
            aria-label="账号分组"
            mode="multiple"
            onChange={(value: string[]) => setTag(value)}
            options={tagOptions.map((item) => ({
              label: `${item.tag}(${item.total})`,
              value: item.tag,
            }))}
            placeholder="请选择"
            style={{ width: 280 }}
            value={[...tag]}
            virtual={false}
          />
          <Button onClick={refreshTags} style={{ marginLeft: 8 }} type="primary">
            刷新
          </Button>
        </Form.Item>
        <Form.Item label="备注">
          <Input
            aria-label="备注"
            onChange={(event) => setRemark(event.target.value)}
            value={remark}
          />
        </Form.Item>
        <Form.Item label="总数">
          <InputNumber aria-label="总数" disabled value={count} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
