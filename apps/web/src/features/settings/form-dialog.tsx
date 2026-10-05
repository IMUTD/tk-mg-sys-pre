import { App, Button, Form, Input, Modal, Select, Switch } from "antd"
import { type ReactNode, useState } from "react"

import { applyConfigKey, CONFIG_KEY_OPTIONS, type ConfigKey, type MytConfig } from "./myt-config"

type ConfigFormDialogProps = {
  readonly onCancel: () => void
  readonly onSubmit: (config: MytConfig) => void
  readonly record: MytConfig
}

const isConfigKey = (value: ConfigKey | ""): value is ConfigKey => value.length > 0

export const ConfigFormDialog = ({
  onCancel,
  onSubmit,
  record,
}: ConfigFormDialogProps): ReactNode => {
  const { message } = App.useApp()
  const [enable, setEnable] = useState(record.enable)
  const [key, setKey] = useState<ConfigKey | "">(record.key)
  const [name, setName] = useState(record.name)
  const [password, setPassword] = useState(record.password)
  const [remark, setRemark] = useState(record.remark)
  const [url, setUrl] = useState(record.url)
  const [username, setUsername] = useState(record.username)

  const submit = (): void => {
    if (!isConfigKey(key)) {
      message.error("请选择配置项")
      return
    }
    const selectedKey = key
    onSubmit({
      ...record,
      enable,
      key: selectedKey,
      name: name.trim().length === 0 ? applyConfigKey(record, selectedKey).name : name.trim(),
      password: password.trim(),
      remark,
      url,
      username: username.trim(),
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
      title={record.id === 0 ? "新增配置" : "修改配置"}
      width={500}
    >
      <Form labelCol={{ style: { width: 80 } }} layout="horizontal" size="small">
        <Form.Item label="配置项" required>
          <Select
            aria-label="配置项"
            onChange={(value: ConfigKey) => {
              const next = applyConfigKey({ ...record, name, url }, value)
              setKey(value)
              setName(next.name)
              setUrl(next.url)
            }}
            options={CONFIG_KEY_OPTIONS.map((item) => ({
              label: item.label,
              value: item.value,
            }))}
            placeholder="请选择"
            style={{ width: 370 }}
            value={isConfigKey(key) ? key : null}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="URL">
          <Input
            aria-label="URL"
            onChange={(event) => setUrl(event.target.value)}
            style={{ width: 370 }}
            value={url}
          />
        </Form.Item>
        <Form.Item label="账号">
          <Input
            aria-label="账号"
            onChange={(event) => setUsername(event.target.value)}
            style={{ width: 370 }}
            value={username}
          />
        </Form.Item>
        <Form.Item label="密码">
          <Input.Password
            aria-label="密码"
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
            style={{ width: 370 }}
            value={password}
          />
        </Form.Item>
        <Form.Item label="备注">
          <Input
            aria-label="备注"
            onChange={(event) => setRemark(event.target.value)}
            style={{ width: 370 }}
            value={remark}
          />
        </Form.Item>
        <Form.Item label="启用">
          <Switch aria-label="启用" checked={enable} onChange={setEnable} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
