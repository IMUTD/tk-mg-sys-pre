import { App, Button, Form, Input, InputNumber, Modal, Select } from "antd"
import { type ReactNode, useState } from "react"

import {
  defaultPort,
  engineLabel,
  NAS_PROTOCOL_OPTIONS,
  protocolLabel,
  SQL_ENGINE_OPTIONS,
  type StorageTarget,
  testConnection,
  validateTarget,
} from "./storage-target"

type TargetFormDialogProps = {
  readonly onCancel: () => void
  readonly onSubmit: (target: StorageTarget) => void
  readonly record: StorageTarget
}

export const TargetFormDialog = ({
  onCancel,
  onSubmit,
  record,
}: TargetFormDialogProps): ReactNode => {
  const { message } = App.useApp()
  const [database, setDatabase] = useState(record.database)
  const [engine, setEngine] = useState(record.engine)
  const [host, setHost] = useState(record.host)
  const [name, setName] = useState(record.name)
  const [password, setPassword] = useState("")
  const [port, setPort] = useState(record.port)
  const [protocol, setProtocol] = useState(record.protocol)
  const [remark, setRemark] = useState(record.remark)
  const [rootPath, setRootPath] = useState(record.rootPath)
  const [username, setUsername] = useState(record.username)

  const draft = (): StorageTarget => ({
    ...record,
    database,
    engine,
    host,
    name,
    password: password.length === 0 ? record.password : password,
    port,
    protocol,
    remark,
    rootPath,
    username,
  })

  const runTest = (): boolean => {
    const result = testConnection(draft())
    if (result.ok) message.success(result.message)
    else message.error(result.message)
    return result.ok
  }

  const submit = (): void => {
    const next = draft()
    const error = validateTarget(next)
    if (error !== null) {
      message.error(error)
      return
    }
    onSubmit(next)
  }

  const title =
    record.kind === "nas"
      ? record.id === 0
        ? "新增 NAS"
        : "修改 NAS"
      : record.id === 0
        ? "新增数据库"
        : "修改数据库"

  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel} type="text">
            取消
          </Button>
          <Button onClick={runTest}>测试连接</Button>
          <Button onClick={submit} type="primary">
            确认
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title={title}
      width={520}
    >
      <Form labelCol={{ style: { width: 90 } }} layout="horizontal" size="small">
        <Form.Item label="名称" required>
          <Input
            aria-label="名称"
            onChange={(event) => setName(event.target.value)}
            placeholder="请输入名称"
            value={name}
          />
        </Form.Item>
        {record.kind === "nas" ? (
          <Form.Item label="协议">
            <Select
              aria-label="协议"
              onChange={(value: string) => {
                setProtocol(value as StorageTarget["protocol"])
                setPort(defaultPort("nas", value, engine))
              }}
              options={[...NAS_PROTOCOL_OPTIONS]}
              style={{ width: 360 }}
              value={protocol.length === 0 ? null : protocol}
              virtual={false}
            />
          </Form.Item>
        ) : (
          <Form.Item label="数据库类型">
            <Select
              aria-label="数据库类型"
              onChange={(value: string) => {
                setEngine(value as StorageTarget["engine"])
                setPort(defaultPort("sql", protocol, value))
              }}
              options={[...SQL_ENGINE_OPTIONS]}
              style={{ width: 360 }}
              value={engine.length === 0 ? null : engine}
              virtual={false}
            />
          </Form.Item>
        )}
        <Form.Item label="主机" required>
          <Input
            aria-label="主机"
            onChange={(event) => setHost(event.target.value)}
            placeholder="主机名或 IP"
            value={host}
          />
        </Form.Item>
        <Form.Item label="端口" required>
          <InputNumber
            aria-label="端口"
            max={65535}
            min={1}
            onChange={(value) => setPort(value ?? 0)}
            style={{ width: 160 }}
            value={port}
          />
        </Form.Item>
        {record.kind === "nas" ? (
          <Form.Item label="根目录" required>
            <Input
              aria-label="根目录"
              onChange={(event) => setRootPath(event.target.value)}
              placeholder="/"
              value={rootPath}
            />
          </Form.Item>
        ) : (
          <Form.Item label="数据库名" required>
            <Input
              aria-label="数据库名"
              onChange={(event) => setDatabase(event.target.value)}
              placeholder="请输入数据库名"
              value={database}
            />
          </Form.Item>
        )}
        <Form.Item label="用户名">
          <Input
            aria-label="用户名"
            onChange={(event) => setUsername(event.target.value)}
            placeholder="可选"
            value={username}
          />
        </Form.Item>
        <Form.Item label="密码">
          <Input.Password
            aria-label="密码"
            onChange={(event) => setPassword(event.target.value)}
            placeholder={record.password.length > 0 ? "已配置，不回显" : "可选"}
            value={password}
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
      <p className="storage-form-hint">
        {record.kind === "nas"
          ? `当前类型：${protocolLabel(protocol.length === 0 ? "smb" : protocol)}`
          : `当前类型：${engineLabel(engine.length === 0 ? "postgresql" : engine)}`}
        。测试连接不会把密码写到列表。
      </p>
    </Modal>
  )
}
