import { StopOutlined } from "@ant-design/icons"
import { Button, Checkbox, Modal, Table, Tag } from "antd"
import { type ReactNode, useMemo, useState } from "react"

import {
  deviceById,
  deviceLabel,
  groupedDeviceOptions,
  type MytTask,
  type TaskDevice,
} from "./myt-task"

type RunningTaskDialogProps = {
  readonly devices: readonly TaskDevice[]
  readonly onCancel: () => void
  readonly onKill: (ids: readonly number[]) => void
  readonly tasks: readonly MytTask[]
}

export const RunningTaskDialog = ({
  devices,
  onCancel,
  onKill,
  tasks,
}: RunningTaskDialogProps): ReactNode => {
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<number[]>(
    devices.map((item) => item.id),
  )
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const groups = useMemo(() => groupedDeviceOptions(devices), [devices])
  const queried = tasks.filter(
    (item) =>
      item.status === "2" && item.deviceId !== null && selectedDeviceIds.includes(item.deviceId),
  )

  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button
            danger
            disabled={queried.length === 0}
            onClick={() => onKill(queried.map((item) => item.id))}
          >
            终止当前结果
          </Button>
          <Button
            disabled={selectedIds.length === 0}
            onClick={() => onKill(selectedIds)}
            type="primary"
          >
            终止选中 ({selectedIds.length})
          </Button>
          <Button onClick={onCancel}>关闭</Button>
        </div>
      }
      onCancel={onCancel}
      open
      title="正在执行"
      width={960}
    >
      <div className="running-task-query-panel">
        <div className="running-task-panel-title">
          查询设备
          <span className="muted">
            已选择 {selectedDeviceIds.length} / {devices.length} 台设备
          </span>
        </div>
        {groups.map((group) => (
          <div className="running-device-group" key={group.label}>
            <Checkbox
              checked={group.options.every((item) => selectedDeviceIds.includes(item.value))}
              indeterminate={
                group.options.some((item) => selectedDeviceIds.includes(item.value)) &&
                !group.options.every((item) => selectedDeviceIds.includes(item.value))
              }
              onChange={(event) => {
                const ids = group.options.map((item) => item.value)
                setSelectedDeviceIds((current) =>
                  event.target.checked
                    ? [...new Set([...current, ...ids])]
                    : current.filter((id) => !ids.includes(id)),
                )
              }}
            >
              {group.label} ({group.options.length})
            </Checkbox>
            <div className="running-device-checkboxes">
              {group.options.map((item) => (
                <Checkbox
                  checked={selectedDeviceIds.includes(item.value)}
                  key={item.value}
                  onChange={(event) =>
                    setSelectedDeviceIds((current) =>
                      event.target.checked
                        ? [...current, item.value]
                        : current.filter((id) => id !== item.value),
                    )
                  }
                >
                  {item.label}
                </Checkbox>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Table
        columns={[
          { dataIndex: "id", key: "id", title: "任务ID", width: 90 },
          { dataIndex: "name", ellipsis: true, key: "name", title: "任务名" },
          { dataIndex: "scriptName", key: "scriptName", title: "功能", width: 120 },
          {
            key: "device",
            render: (_value: unknown, item: MytTask) =>
              deviceLabel(deviceById(devices, item.deviceId), item.deviceSeq),
            title: "设备/机位",
            width: 160,
          },
          {
            key: "status",
            render: () => <Tag color="processing">执行中</Tag>,
            title: "状态",
            width: 90,
          },
          {
            align: "center" as const,
            fixed: "right" as const,
            key: "kill",
            render: (_value: unknown, item: MytTask) => (
              <Button
                danger
                icon={<StopOutlined aria-hidden />}
                onClick={() => onKill([item.id])}
                size="small"
                type="link"
              >
                终止
              </Button>
            ),
            title: "操作",
            width: 80,
          },
        ]}
        dataSource={queried}
        pagination={false}
        rowKey="id"
        rowSelection={{
          onChange: (keys) => setSelectedIds(keys.map((key) => Number(key))),
          selectedRowKeys: selectedIds,
        }}
        scroll={{ x: "max-content" }}
        size="small"
      />
    </Modal>
  )
}
