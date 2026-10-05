import { Alert, Form, Input, Modal, Select, Switch } from "antd"
import type { ReactNode } from "react"

import { type DeviceFormValues, deviceToForm, emptyDeviceForm, type MytDevice } from "./myt-device"

type DeviceFormDialogProps = {
  readonly isAdministrator: boolean
  readonly onCancel: () => void
  readonly onSubmit: (values: DeviceFormValues) => void
  readonly record: MytDevice | null
}

export const DeviceFormDialog = ({
  isAdministrator,
  onCancel,
  onSubmit,
  record,
}: DeviceFormDialogProps): ReactNode => {
  const [form] = Form.useForm<DeviceFormValues>()
  const isAdd = record === null
  const showSerial = isAdd || isAdministrator
  return (
    <Modal
      cancelText="取消"
      destroyOnHidden
      okText="确认"
      onCancel={onCancel}
      onOk={() => {
        void form.validateFields().then((values) => onSubmit(values))
      }}
      open
      title={isAdd ? "新增设备" : "修改设备"}
      width={500}
    >
      <Alert
        className="device-form-alert"
        showIcon
        title="请使用初始化工具绑定安装,联系客服获取"
        type="warning"
      />
      <Form
        colon={false}
        form={form}
        initialValues={record === null ? emptyDeviceForm() : deviceToForm(record)}
        labelCol={{ style: { width: 80 } }}
        layout="horizontal"
      >
        {showSerial ? (
          <Form.Item
            label="序列号"
            name="serial"
            rules={[{ message: "请输入序列号", required: true }]}
          >
            <Input aria-label="序列号" />
          </Form.Item>
        ) : (
          <Form.Item hidden name="serial">
            <Input />
          </Form.Item>
        )}
        <Form.Item label="IP" name="ip" rules={[{ message: "请输入IP地址", required: true }]}>
          <Input aria-label="IP" />
        </Form.Item>
        <Form.Item label="备注名" name="name">
          <Input />
        </Form.Item>
        <Form.Item label="分组标签" name="tag">
          <Input placeholder="设备分组标签" />
        </Form.Item>
        <Form.Item
          label="设备型号"
          name="model"
          rules={[{ message: "请选择设备型号", required: true }]}
        >
          <Select
            aria-label="设备型号"
            options={[
              { label: "MYT-Q1", value: 1 },
              { label: "MYT-P1", value: 2 },
            ]}
            placeholder="请选择设备型号"
            virtual={false}
          />
        </Form.Item>
        <Form.Item
          extra={<span className="device-form-hint">勾选后标记为海外设备</span>}
          label="海外设备"
          name="overseas"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
        <Form.Item label="启用状态" name="enable" valuePropName="checked">
          <Switch checkedChildren="启用" unCheckedChildren="禁用" />
        </Form.Item>
        <Form.Item label="远程端口" name="remotePort">
          <Input placeholder="默认留空" />
        </Form.Item>
        <Form.Item label="投屏端口" name="remoteScreenPort">
          <Input placeholder="默认使用远程端口" />
        </Form.Item>
        <Form.Item label="映射域名" name="remoteUrl">
          <Input placeholder="例如 device.example.com" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
