import { Button, Form, Input, Modal } from "antd"
import { type ReactNode, useState } from "react"

import { importMaterials, type MytMaterial, nowText } from "./myt-material"

type ImportDialogProps = {
  readonly nextId: number
  readonly onCancel: () => void
  readonly onImported: (materials: readonly MytMaterial[]) => void
}

export const MaterialImportDialog = ({
  nextId,
  onCancel,
  onImported,
}: ImportDialogProps): ReactNode => {
  const [importing, setImporting] = useState(false)
  const [resource, setResource] = useState("")
  const [tag, setTag] = useState("")
  const canSubmit = tag.trim().length > 0 && resource.trim().length > 0

  const submit = (): void => {
    if (!canSubmit) return
    setImporting(true)
    onImported(importMaterials(resource, tag.trim(), nextId, nowText()))
    setImporting(false)
  }

  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel}>取消</Button>
          <Button disabled={!canSubmit} loading={importing} onClick={submit} type="primary">
            确认导入
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title="导入素材"
      width={800}
    >
      <Form labelCol={{ style: { width: 120 } }} layout="horizontal" size="small">
        <Form.Item label="标签" required>
          <Input
            aria-label="导入标签"
            onChange={(event) => setTag(event.target.value)}
            placeholder="请输入标签（用于分组）"
            value={tag}
          />
        </Form.Item>
        <Form.Item label="素材内容" required>
          <Input.TextArea
            aria-label="素材内容"
            onChange={(event) => setResource(event.target.value)}
            placeholder="每行一条素材内容"
            rows={10}
            value={resource}
          />
          <div className="muted material-import-hint">每行一条素材内容，将批量导入</div>
        </Form.Item>
      </Form>
    </Modal>
  )
}
