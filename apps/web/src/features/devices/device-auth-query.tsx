import { Button, Empty, Input, Modal, Table, Tag } from "antd"
import type { ReactNode } from "react"

import { authStateText, type DeviceAuthSlot, isExpired, remainingDaysLabel } from "./myt-device"

type DeviceAuthQueryProps = {
  readonly onClose: () => void
  readonly queried: boolean
  readonly serial: string
  readonly slots: readonly DeviceAuthSlot[]
}

const stateColor = (state: DeviceAuthSlot["state"]): "success" | "warning" | "error" => {
  if (state === 0) return "success"
  if (state === 1) return "warning"
  return "error"
}

const extimeColor = (slot: DeviceAuthSlot): string => {
  if (isExpired(slot.extime)) return "#F56C6C"
  if (slot.state === 1) return "#E6A23C"
  return "#67C23A"
}

export const DeviceAuthQuery = ({
  onClose,
  queried,
  serial,
  slots,
}: DeviceAuthQueryProps): ReactNode => (
  <Modal
    footer={
      <Button onClick={onClose} type="default">
        关闭
      </Button>
    }
    onCancel={onClose}
    open
    style={{ top: "8vh" }}
    title="设备授权查询"
    width={700}
  >
    <div className="auth-query-section">
      <Input aria-label="设备序列号" readOnly style={{ width: 400 }} value={serial} />
    </div>
    {slots.length > 0 ? (
      <Table
        bordered
        className="auth-result-section"
        columns={[
          { dataIndex: "slot", key: "slot", title: "插槽", width: 250 },
          { dataIndex: "uid", key: "uid", title: "用户ID", width: 100 },
          {
            dataIndex: "state",
            key: "state",
            render: (state: DeviceAuthSlot["state"]) => (
              <Tag color={stateColor(state)}>{authStateText(state)}</Tag>
            ),
            title: "状态",
            width: 80,
          },
          {
            key: "extime",
            render: (_value: unknown, slot: DeviceAuthSlot) => (
              <span>
                <span style={{ color: extimeColor(slot) }}>{slot.extime}</span>
                {isExpired(slot.extime) ? (
                  <Tag color="error" style={{ marginLeft: 5 }}>
                    已过期
                  </Tag>
                ) : (
                  <Tag color={slot.state === 1 ? "warning" : "success"} style={{ marginLeft: 5 }}>
                    {remainingDaysLabel(slot.extime)}
                  </Tag>
                )}
              </span>
            ),
            title: "到期时间",
          },
        ]}
        dataSource={[...slots]}
        pagination={false}
        rowKey="slot"
        scroll={{ x: "max-content" }}
        size="small"
        style={{ marginTop: 15 }}
      />
    ) : null}
    {queried && slots.length === 0 ? <Empty description="未查询到授权信息" /> : null}
  </Modal>
)
