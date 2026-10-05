import { App, Button, Form, Input, Modal, Select, Switch } from "antd"
import { type ReactNode, useState } from "react"

import {
  type AccountProxy,
  APP_OPTIONS,
  applyParsedResourceFields,
  formatProxyOptionLabel,
  type MytAccount,
  PARSED_RESOURCE_FIELD_OPTIONS,
  type ParsedResourceField,
  parsedResourceFields,
  proxyUsedCounts,
  STATUS_OPTIONS,
} from "./myt-account"

type AccountFormDialogProps = {
  readonly accounts: readonly MytAccount[]
  readonly onCancel: () => void
  readonly onSubmit: (account: MytAccount) => void
  readonly proxies: readonly AccountProxy[]
  readonly record: MytAccount
}

type EditableParsedResourceField = ParsedResourceField & {
  readonly editorId: string
}

const toEditableField = (field: ParsedResourceField): EditableParsedResourceField => ({
  ...field,
  editorId: crypto.randomUUID(),
})

const toParsedField = ({ editorId: _editorId, ...field }: EditableParsedResourceField) => field

export const AccountFormDialog = ({
  accounts,
  onCancel,
  onSubmit,
  proxies,
  record,
}: AccountFormDialogProps): ReactNode => {
  const { message } = App.useApp()
  const [app] = useState(record.app)
  const [enable, setEnable] = useState(record.enable)
  const [fields, setFields] = useState<EditableParsedResourceField[]>(() =>
    parsedResourceFields(record.extra).map(toEditableField),
  )
  const [password, setPassword] = useState(record.password)
  const [proxyId, setProxyId] = useState<number | null>(record.proxyId)
  const [remark, setRemark] = useState(record.remark)
  const [status, setStatus] = useState(record.status)
  const [tag, setTag] = useState(record.tag)
  const [totp, setTotp] = useState(record.totp)
  const [uid, setUid] = useState(record.uid)
  const [username, setUsername] = useState(record.username)
  const used = proxyUsedCounts(accounts)

  const submit = (): void => {
    if (uid.trim().length === 0) {
      message.error("uid不能为空")
      return
    }
    if (password.trim() === "******") {
      message.error("密码不能为******，请填写真实密码后再提交")
      return
    }
    const extra = applyParsedResourceFields(record.extra, fields.map(toParsedField))
    if (typeof extra === "string") {
      message.error(`绑定数据字段重复：${extra}`)
      return
    }
    onSubmit({
      ...record,
      app,
      enable,
      extra,
      password,
      proxyId,
      remark,
      status,
      tag,
      totp,
      uid: uid.trim(),
      username,
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
      title="编辑账号"
      width={680}
    >
      <Form labelCol={{ style: { width: 80 } }} layout="horizontal" size="small">
        <Form.Item label="账号分组">
          <Input
            aria-label="账号分组"
            onChange={(event) => setTag(event.target.value)}
            value={tag}
          />
        </Form.Item>
        <Form.Item label="uid" required>
          <Input aria-label="uid" onChange={(event) => setUid(event.target.value)} value={uid} />
        </Form.Item>
        <Form.Item label="账号">
          <Input
            aria-label="账号"
            onChange={(event) => setUsername(event.target.value)}
            value={username}
          />
        </Form.Item>
        <Form.Item label="密码">
          <Input.Password
            aria-label="密码"
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
            value={password}
          />
        </Form.Item>
        <Form.Item label="2FA">
          <Input.Password
            aria-label="2FA"
            autoComplete="new-password"
            onChange={(event) => setTotp(event.target.value)}
            value={totp}
          />
        </Form.Item>
        <Form.Item label="绑定数据">
          <div className="parsed-resource-editor">
            {fields.length === 0 ? <div className="parsed-resource-empty">暂无绑定数据</div> : null}
            {fields.map((field, index) => (
              <div className="parsed-resource-row" key={field.editorId}>
                <Select
                  allowClear
                  aria-label={`绑定数据字段${index + 1}`}
                  onChange={(value: string | null) =>
                    setFields((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, key: value ?? "" } : item,
                      ),
                    )
                  }
                  options={[...PARSED_RESOURCE_FIELD_OPTIONS]}
                  placeholder="字段"
                  showSearch
                  style={{ width: 140 }}
                  value={field.key.length === 0 ? null : field.key}
                  virtual={false}
                />
                <Input
                  aria-label={`绑定数据值${index + 1}`}
                  onChange={(event) =>
                    setFields((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, value: event.target.value } : item,
                      ),
                    )
                  }
                  placeholder="字段值"
                  value={field.value}
                />
                <Button
                  onClick={() =>
                    setFields((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                  type="text"
                >
                  删除
                </Button>
              </div>
            ))}
            <Button
              onClick={() =>
                setFields((current) => [...current, toEditableField({ key: "", value: "" })])
              }
              type="primary"
            >
              添加字段
            </Button>
          </div>
        </Form.Item>
        <Form.Item label="代理">
          <Select
            allowClear
            aria-label="代理"
            onChange={(value: number | null) => setProxyId(value ?? null)}
            options={proxies.map((proxy) => ({
              label: formatProxyOptionLabel(proxy, used.get(proxy.id) ?? 0),
              value: proxy.id,
            }))}
            placeholder="请选择"
            showSearch
            value={proxyId}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="启用">
          <Switch checked={enable} onChange={setEnable} />
        </Form.Item>
        <Form.Item label="状态">
          <Select
            aria-label="状态"
            onChange={setStatus}
            options={[...STATUS_OPTIONS]}
            value={status}
            virtual={false}
          />
        </Form.Item>
        <Form.Item label="备注">
          <Input
            aria-label="备注"
            onChange={(event) => setRemark(event.target.value)}
            value={remark}
          />
        </Form.Item>
        <Form.Item label="APP">
          <Input
            disabled
            value={APP_OPTIONS.find((option) => option.value === app)?.label ?? app}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
