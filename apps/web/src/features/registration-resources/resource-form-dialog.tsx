import { App, Button, Form, Input, Modal, Radio, Select } from "antd"
import { type ReactNode, useState } from "react"

import {
  buildParsedData,
  FIELD_TYPE_OPTIONS,
  getFieldLabel,
  type ParsedDataField,
  parseDataFieldList,
  type ResourceStatus,
  type TkRegResource,
} from "./tk-reg-resource"

type ResourceFormDialogProps = {
  readonly onCancel: () => void
  readonly onSubmit: (resource: TkRegResource) => void
  readonly record: TkRegResource
}

const editableFieldOptions = FIELD_TYPE_OPTIONS.filter((option) => option.value !== "ignore")

type EditableParsedDataField = ParsedDataField & {
  readonly editorId: string
}

const toEditableField = (field: ParsedDataField): EditableParsedDataField => ({
  ...field,
  editorId: crypto.randomUUID(),
})

const toParsedField = ({ editorId: _editorId, ...field }: EditableParsedDataField) => field

export const ResourceFormDialog = ({
  onCancel,
  onSubmit,
  record,
}: ResourceFormDialogProps): ReactNode => {
  const { message } = App.useApp()
  const [email, setEmail] = useState(record.email)
  const [fields, setFields] = useState<EditableParsedDataField[]>(() =>
    parseDataFieldList(record.data).map(toEditableField),
  )
  const [remark, setRemark] = useState(record.remark)
  const [status, setStatus] = useState<ResourceStatus>(record.status)
  const [tag, setTag] = useState(record.tag)

  const updateField = (index: number, patch: Partial<ParsedDataField>): void => {
    setFields((current) =>
      current.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field)),
    )
  }

  const submit = (): void => {
    const data = buildParsedData(fields.map(toParsedField))
    if (typeof data === "string") {
      message.error(`智能解析字段重复：${getFieldLabel(data)}`)
      return
    }
    const nextTag = tag.trim()
    if (nextTag.includes("+")) {
      message.error("分组名称不能包含 + 符号")
      return
    }
    onSubmit({
      ...record,
      data,
      email,
      remark,
      status,
      tag: nextTag,
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
      title="编辑注册池"
      width={640}
    >
      <Form labelCol={{ style: { width: 80 } }} layout="horizontal" size="small">
        <Form.Item label="原始资源">
          <Input
            aria-label="原始资源"
            onChange={(event) => setEmail(event.target.value)}
            value={email}
          />
        </Form.Item>
        <Form.Item label="分组">
          <Input aria-label="分组" onChange={(event) => setTag(event.target.value)} value={tag} />
        </Form.Item>
        <Form.Item label="备注">
          <Input
            aria-label="备注"
            onChange={(event) => setRemark(event.target.value)}
            value={remark}
          />
        </Form.Item>
        <Form.Item label="分配状态">
          <Radio.Group
            aria-label="分配状态"
            onChange={(event) => setStatus(event.target.value)}
            optionType="button"
            options={[
              { label: "未使用", value: "0" },
              { label: "已使用", value: "1" },
            ]}
            value={status}
          />
        </Form.Item>
        <Form.Item label="智能解析">
          <div className="parsed-data-editor">
            {fields.length === 0 ? <div className="parsed-data-empty">暂无解析字段</div> : null}
            {fields.map((field, index) => (
              <div className="parsed-data-row" key={field.editorId}>
                <Select
                  aria-label={`解析字段${index + 1}`}
                  className="parsed-data-key"
                  onChange={(value: string) => updateField(index, { key: value })}
                  optionFilterProp="label"
                  options={[...editableFieldOptions]}
                  placeholder="字段"
                  showSearch
                  value={field.key.length === 0 ? null : field.key}
                  virtual={false}
                />
                <Input
                  aria-label={`${field.key || "字段"}值`}
                  className="parsed-data-value"
                  onChange={(event) => updateField(index, { value: event.target.value })}
                  placeholder="字段值"
                  value={field.value}
                />
                <Button
                  aria-label={`删除解析字段${index + 1}`}
                  className="parsed-data-delete"
                  onClick={() =>
                    setFields((current) =>
                      current.filter((_item, fieldIndex) => fieldIndex !== index),
                    )
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
            >
              添加字段
            </Button>
          </div>
        </Form.Item>
      </Form>
    </Modal>
  )
}
