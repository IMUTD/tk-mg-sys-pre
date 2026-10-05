import { Alert, Form, Input, Modal } from "antd"
import { type ReactNode, useState } from "react"

import type { ManagedCreateInput, ManagedRecord } from "./api"

export type CreateField = {
  readonly label: string
  readonly name: string
  readonly required?: true
  readonly secret?: true
  readonly type?: "password" | "text"
}

type StatusOption = { readonly label: string; readonly value: string }
type Props = {
  readonly defaultStatus: string
  readonly fields: readonly CreateField[]
  readonly onClose: () => void
  readonly onSave: (input: ManagedCreateInput) => Promise<void>
  readonly record: ManagedRecord | null
  readonly statusOptions: readonly StatusOption[]
  readonly tagsLabel: string
  readonly title: string
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "操作失败，请稍后重试"

type DialogValues = {
  category?: string
  credentials?: string
  endpoint?: string
  identifier?: string
  name?: string
  note: string
  secret?: string
  status: string
  tags: string
}

const dialogFieldValue = (values: DialogValues, name: string): string => {
  switch (name) {
    case "category":
      return values.category ?? ""
    case "credentials":
      return values.credentials ?? ""
    case "endpoint":
      return values.endpoint ?? ""
    case "identifier":
      return values.identifier ?? ""
    case "name":
      return values.name ?? ""
    case "secret":
      return values.secret ?? ""
    default:
      return ""
  }
}

const fieldValue = (record: ManagedRecord | null, field: CreateField): string => {
  if (record === null || field.secret === true) return ""
  switch (field.name) {
    case "category":
      return record.category ?? ""
    case "endpoint":
      return record.endpoint ?? ""
    case "identifier":
      return record.identifier ?? ""
    case "name":
      return record.name
    default:
      return ""
  }
}

export const ManagementDialog = ({
  defaultStatus,
  fields,
  onClose,
  onSave,
  record,
  statusOptions,
  tagsLabel,
  title,
}: Props): ReactNode => {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const isEditing = record !== null
  const dialogTitle = `${isEditing ? "编辑" : "新建"}${title}`
  const [form] = Form.useForm<DialogValues>()

  const submit = async (values: DialogValues): Promise<void> => {
    const input: Record<string, string | readonly string[]> = {
      note: values.note ?? "",
      status: values.status ?? defaultStatus,
      tags: (values.tags ?? "")
        .split("，")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    }
    for (const field of fields) {
      const value = dialogFieldValue(values, field.name)
      if (!isEditing || field.secret !== true || value.length > 0) input[field.name] = value
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(input)
      onClose()
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  const initialValues: Record<string, string> = {
    note: record?.note ?? "",
    status: record?.status ?? defaultStatus,
    tags: record?.tags.join("，") ?? "",
  }
  for (const field of fields) {
    initialValues[field.name] = fieldValue(record, field)
  }

  return (
    <Modal
      confirmLoading={saving}
      destroyOnHidden
      getContainer={false}
      okText={saving ? "正在保存…" : "保存"}
      onCancel={onClose}
      onOk={() => void form.submit()}
      open
      title={dialogTitle}
    >
      <Form
        className="management-dialog"
        form={form}
        initialValues={initialValues}
        labelCol={{ span: 6 }}
        onFinish={(values) => void submit(values)}
        wrapperCol={{ span: 18 }}
      >
        {fields.map((field) => (
          <Form.Item
            key={field.name}
            label={field.label}
            name={field.name}
            {...(!isEditing && field.required === true
              ? { rules: [{ message: `请输入${field.label}`, required: true }] }
              : {})}
          >
            {field.type === "password" ? (
              <Input.Password aria-label={field.label} autoComplete="off" />
            ) : (
              <Input aria-label={field.label} />
            )}
          </Form.Item>
        ))}
        <Form.Item label="状态" name="status">
          <select aria-label="状态">
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Form.Item>
        <Form.Item label={tagsLabel} name="tags">
          <Input aria-label="标签" placeholder="多个分组用中文逗号分隔" />
        </Form.Item>
        <Form.Item label="备注" name="note">
          <Input.TextArea aria-label="备注" rows={3} />
        </Form.Item>
        {error === null ? null : <Alert message={error} showIcon type="error" />}
      </Form>
    </Modal>
  )
}
