import { Alert, Button, Form, Input, Modal, Select, Space, Switch } from "antd"
import { type ReactNode, useEffect, useState } from "react"

import { CONFIGURABLE_ROLE_OPTIONS, MEMBER_ROLE_OPTIONS } from "../../lib/pages"
import {
  type Member,
  type MemberCreate,
  MemberCreateSchema,
  type MembersApi,
  type MemberUpdate,
  MemberUpdateSchema,
} from "./api"

type MemberDialogProps = {
  readonly api: MembersApi
  readonly errorMessage?: string
  readonly member: Member | null
  readonly onClose: () => void
  readonly onCreate: (input: MemberCreate) => void
  readonly onUpdate: (input: MemberUpdate) => void
  readonly submitting?: boolean
}

export const MemberDialog = ({
  api,
  errorMessage,
  member,
  onClose,
  onCreate,
  onUpdate,
  submitting = false,
}: MemberDialogProps): ReactNode => {
  const [form] = Form.useForm<{
    readonly displayName: string
    readonly email: string
    readonly enabled: boolean
    readonly password: string
    readonly role: string
  }>()
  const [invalid, setInvalid] = useState(false)
  const [rollingName, setRollingName] = useState(false)
  const isCreate = member === null
  const rollName = async (): Promise<void> => {
    setRollingName(true)
    try {
      const current = form.getFieldValue("displayName") as string | undefined
      const displayName = await api.suggestDisplayName(
        current === undefined || current.length === 0 ? [] : [current],
      )
      form.setFieldValue("displayName", displayName)
    } finally {
      setRollingName(false)
    }
  }
  useEffect(() => {
    if (!isCreate) return
    let cancelled = false
    void api.suggestDisplayName().then((displayName) => {
      if (cancelled) return
      const current = form.getFieldValue("displayName") as string | undefined
      if (current !== undefined && current.length > 0) return
      form.setFieldValue("displayName", displayName)
    })
    return () => {
      cancelled = true
    }
  }, [api, form, isCreate])
  const submit = (values: {
    readonly displayName?: string
    readonly email?: string
    readonly enabled: boolean
    readonly password?: string
    readonly role: string
  }): void => {
    if (isCreate) {
      const created = MemberCreateSchema.safeParse({
        displayName: values.displayName,
        email: values.email,
        password: values.password,
        role: values.role,
      })
      if (!created.success) {
        setInvalid(true)
        return
      }
      setInvalid(false)
      onCreate(created.data)
      return
    }
    const password = values.password?.trim() ?? ""
    const updated = MemberUpdateSchema.safeParse({
      enabled: values.enabled,
      role: values.role,
      ...(password.length === 0 ? {} : { password }),
    })
    if (!updated.success) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    onUpdate(updated.data)
  }
  const title = isCreate ? "新建成员" : `编辑 ${member.displayName}`
  return (
    <Modal aria-label={title} destroyOnHidden footer={null} onCancel={onClose} open title={title}>
      <Form
        className="management-dialog member-dialog"
        form={form}
        initialValues={{
          displayName: member?.displayName ?? "",
          email: member?.email ?? "",
          enabled: member?.enabled ?? true,
          password: "",
          role: member?.role ?? "operator",
        }}
        layout="vertical"
        onFinish={submit}
      >
        {isCreate ? (
          <>
            <Form.Item extra="点击骰子换一个动漫、影视、动物或明星名字。" label="名字" required>
              <Space.Compact style={{ width: "100%" }}>
                <Form.Item
                  name="displayName"
                  noStyle
                  rules={[{ message: "请生成名字", required: true }]}
                >
                  <Input aria-label="成员名字" readOnly />
                </Form.Item>
                <Button
                  aria-label="换一个名字"
                  htmlType="button"
                  loading={rollingName}
                  onClick={() => void rollName()}
                  title="换一个名字"
                >
                  🎲
                </Button>
              </Space.Compact>
            </Form.Item>
            <Form.Item
              label="账号"
              name="email"
              rules={[
                { message: "请输入账号", required: true },
                { message: "请输入有效邮箱账号", type: "email" },
              ]}
            >
              <Input aria-label="账号" autoComplete="off" />
            </Form.Item>
          </>
        ) : null}
        <Form.Item
          extra={
            isCreate
              ? "仅用于首次设置登录密码，保存后不会显示或保存可查看副本。"
              : "留空则不修改密码"
          }
          label={isCreate ? "初始密码" : "重置密码"}
          name="password"
          rules={isCreate ? [{ message: "请输入密码", required: true }] : []}
        >
          <Input.Password
            aria-label={isCreate ? "初始密码" : "重置密码"}
            autoComplete="new-password"
          />
        </Form.Item>
        <Form.Item label="角色" name="role" rules={[{ message: "请选择角色", required: true }]}>
          <Select
            aria-label="角色"
            options={[...(isCreate ? CONFIGURABLE_ROLE_OPTIONS : MEMBER_ROLE_OPTIONS)]}
          />
        </Form.Item>
        {isCreate ? null : (
          <Form.Item label="启用成员" name="enabled" valuePropName="checked">
            <Switch aria-label="启用成员" />
          </Form.Item>
        )}
        {invalid ? (
          <Alert className="form-error" message="请检查账号、密码和角色。" showIcon type="error" />
        ) : null}
        {errorMessage === undefined || errorMessage.length === 0 ? null : (
          <Alert className="form-error" message={errorMessage} showIcon type="error" />
        )}
        <div className="dialog-actions">
          <Button onClick={onClose}>取消</Button>
          <Button htmlType="submit" loading={submitting} type="primary">
            {isCreate ? "创建成员" : "保存成员"}
          </Button>
        </div>
      </Form>
    </Modal>
  )
}
