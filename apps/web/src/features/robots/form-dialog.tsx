import { App, Button, Form, Input, InputNumber, Modal, Select } from "antd"
import { type ReactNode, useState } from "react"

import { useChains } from "../behaviors/chain-store"
import { DEVICE_GROUP_OPTIONS, POOL_OPTIONS, type Robot, validateRobot } from "./robot"

type RobotFormDialogProps = {
  readonly onCancel: () => void
  readonly onSubmit: (robot: Robot) => void
  readonly record: Robot
}

export const RobotFormDialog = ({
  onCancel,
  onSubmit,
  record,
}: RobotFormDialogProps): ReactNode => {
  const { message } = App.useApp()
  const chains = useChains()
  const [accountCount, setAccountCount] = useState(record.accountCount)
  const [chainId, setChainId] = useState(record.chainId)
  const [concurrency, setConcurrency] = useState(record.concurrency)
  const [deviceGroup, setDeviceGroup] = useState(record.deviceGroup)
  const [durationMinutes, setDurationMinutes] = useState(record.durationMinutes)
  const [name, setName] = useState(record.name)
  const [poolName, setPoolName] = useState(record.poolName)
  const [remark, setRemark] = useState(record.remark)

  const draft = (): Robot => {
    const chain = chains.find((item) => item.id === String(chainId))
    return {
      ...record,
      accountCount,
      chainId,
      chainName: chain?.name ?? "",
      concurrency,
      deviceGroup,
      durationMinutes,
      name,
      poolName,
      remark,
    }
  }

  const submit = (): void => {
    const next = draft()
    const error = validateRobot(next)
    if (error !== null) {
      message.error(error)
      return
    }
    onSubmit(next)
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
      title={record.id === 0 ? "新增" : "修改"}
      width={560}
    >
      <Form labelCol={{ style: { width: 108 } }} layout="horizontal" size="small">
        <Form.Item label="名称" required>
          <Input
            aria-label="名称"
            onChange={(event) => setName(event.target.value)}
            placeholder="请输入名称"
            value={name}
          />
        </Form.Item>
        <Form.Item label="行为链" required>
          <Select
            aria-label="行为链"
            onChange={setChainId}
            options={chains.map((item) => ({ label: item.name, value: item.id }))}
            placeholder="选择行为中心中的行为链"
            style={{ width: 360 }}
            value={chainId === 0 ? null : chainId}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="账号池" required>
          <Select
            aria-label="账号池"
            onChange={setPoolName}
            options={[...POOL_OPTIONS]}
            style={{ width: 360 }}
            value={poolName.length === 0 ? null : poolName}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="盒子组" required>
          <Select
            aria-label="盒子组"
            onChange={setDeviceGroup}
            options={[...DEVICE_GROUP_OPTIONS]}
            style={{ width: 360 }}
            value={deviceGroup.length === 0 ? null : deviceGroup}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="本周期账号数" required>
          <InputNumber
            aria-label="本周期账号数"
            min={1}
            onChange={(value) => setAccountCount(value ?? 0)}
            style={{ width: 160 }}
            value={accountCount}
          />
        </Form.Item>
        <Form.Item label="并发" required>
          <InputNumber
            aria-label="并发"
            min={1}
            onChange={(value) => setConcurrency(value ?? 0)}
            style={{ width: 160 }}
            value={concurrency}
          />
        </Form.Item>
        <Form.Item label="每号时长" required>
          <InputNumber
            addonAfter="分钟"
            aria-label="每号时长"
            min={1}
            onChange={(value) => setDurationMinutes(value ?? 0)}
            style={{ width: 200 }}
            value={durationMinutes}
          />
        </Form.Item>
        <Form.Item label="备注">
          <Input
            aria-label="备注"
            onChange={(event) => setRemark(event.target.value)}
            value={remark}
          />
        </Form.Item>
      </Form>
      <p className="robot-form-hint">行为链在行为中心制定，AI 与 RPA 的区别只存在于制定过程。</p>
    </Modal>
  )
}
