import { App, Button, Form, Input, InputNumber, Modal, Select } from "antd"
import { type ReactNode, useMemo, useState } from "react"

import type { AccountDevice, MytAccount } from "../accounts/myt-account"
import {
  countMatchingAccounts,
  createPoolFromAccounts,
  DEVICE_SEQ_OPTIONS,
  type MytTaskRes,
  needsDevice,
  needsSeq,
  nowText,
  POOL_BACK_TYPE_OPTIONS,
  uniqueSourceTags,
  validatePoolKey,
} from "./myt-task-res"

type TaskResFormDialogProps = {
  readonly devices: readonly AccountDevice[]
  readonly onCancel: () => void
  readonly onSubmit: (pool: MytTaskRes) => void
  readonly record: MytTaskRes
  readonly sourceAccounts: readonly MytAccount[]
}

export const TaskResFormDialog = ({
  devices,
  onCancel,
  onSubmit,
  record,
  sourceAccounts,
}: TaskResFormDialogProps): ReactNode => {
  const { message } = App.useApp()
  const [backType, setBackType] = useState(record.backType)
  const [deviceId, setDeviceId] = useState<number | null>(record.deviceId)
  const [deviceSeq, setDeviceSeq] = useState<number | null>(record.deviceSeq)
  const [key, setKey] = useState(record.key)
  const [remark, setRemark] = useState(record.remark)
  const [tag, setTag] = useState<readonly string[]>(record.tag)
  const [times, setTimes] = useState(record.times)
  const tagQuery = {
    backType,
    deviceId,
    deviceSeq,
    online: null as boolean | null,
    status: "",
    tag: [] as readonly string[],
    tagExclude: [] as readonly string[],
    tagInclude: [] as readonly string[],
    tagQueryMode: "AND" as const,
  }
  const [tagOptions, setTagOptions] = useState(() => uniqueSourceTags(sourceAccounts, tagQuery))
  const count = useMemo(
    () => countMatchingAccounts(sourceAccounts, tag, backType, deviceId),
    [backType, deviceId, sourceAccounts, tag],
  )

  const changeBackType = (value: string): void => {
    setBackType(value)
    setDeviceId(null)
    setDeviceSeq(null)
    setTag([])
    setTagOptions([])
  }

  const refreshTags = (): void => {
    if (needsDevice(backType) && deviceId === null) {
      message.error("请选择设备")
      return
    }
    setTagOptions(
      uniqueSourceTags(sourceAccounts, {
        ...tagQuery,
        backType,
        deviceId,
        deviceSeq,
      }),
    )
    message.success("刷新成功")
  }

  const submit = (): void => {
    const keyError = validatePoolKey(key)
    if (keyError !== null) {
      message.error(keyError)
      return
    }
    if (needsDevice(backType) && deviceId === null) {
      message.error("请选择设备")
      return
    }
    if (tag.length === 0) {
      message.error("标签不能为空")
      return
    }
    if (count <= 0) {
      message.error("总数必须大于0")
      return
    }
    const members = sourceAccounts.filter((account) => {
      if (account.deleted) return false
      if (needsDevice(backType) && account.deviceId !== deviceId) return false
      return tag.includes(account.tag)
    })
    onSubmit({
      ...createPoolFromAccounts(
        members,
        {
          backType,
          deviceId,
          deviceSeq: needsSeq(backType) ? deviceSeq : null,
          key: key.trim(),
          remark,
          tag,
          times,
        },
        record.id,
        nowText(),
      ),
      createTime: record.id === 0 ? nowText() : record.createTime,
      enable: record.enable,
      filterCondition: record.filterCondition,
      userId: record.userId,
    })
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
      title="新增账号池"
      width={520}
    >
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
            options={[...POOL_BACK_TYPE_OPTIONS]}
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
                setDeviceId(value)
                setTag([])
                if (value !== null) {
                  setTagOptions(
                    uniqueSourceTags(sourceAccounts, { ...tagQuery, backType, deviceId: value }),
                  )
                }
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
              onChange={(value: number | null) => setDeviceSeq(value)}
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
