import { App, Button, Form, Input, Modal } from "antd"
import { type ReactNode, useState } from "react"

import type { MytMaterial } from "./myt-material"

type MaterialFormDialogProps = {
  readonly onCancel: () => void
  readonly onSubmit: (material: MytMaterial) => void
  readonly record: MytMaterial
}

export const MaterialFormDialog = ({
  onCancel,
  onSubmit,
  record,
}: MaterialFormDialogProps): ReactNode => {
  const { message } = App.useApp()
  const [content, setContent] = useState(record.content)
  const [remark, setRemark] = useState(record.remark)
  const [tag, setTag] = useState(record.tag)

  const submit = (): void => {
    if (tag.trim().length === 0) {
      message.error("标签不能为空")
      return
    }
    if (content.trim().length === 0) {
      message.error("资源内容不能为空")
      return
    }
    onSubmit({ ...record, content: content.trim(), remark, tag: tag.trim() })
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
      title="编辑素材"
      width={500}
    >
      <Form labelCol={{ style: { width: 80 } }} layout="horizontal" size="small">
        <Form.Item label="标签" required>
          <Input aria-label="标签" onChange={(event) => setTag(event.target.value)} value={tag} />
        </Form.Item>
        <Form.Item label="资源内容" required>
          <Input.TextArea
            aria-label="资源内容"
            onChange={(event) => setContent(event.target.value)}
            rows={3}
            value={content}
          />
        </Form.Item>
        <Form.Item label="说明">
          <Input.TextArea
            aria-label="说明"
            onChange={(event) => setRemark(event.target.value)}
            rows={3}
            value={remark}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
