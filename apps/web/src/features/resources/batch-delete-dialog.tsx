import { App, Button, Form, Modal, Radio } from "antd"
import { type ReactNode, useState } from "react"
import { PageKey } from "../../lib/pages"
import { BusinessLabelFilter } from "../labels/filter-row"

type BatchDeleteDialogProps = {
  readonly onCancel: () => void
  readonly onDeleteAll: () => void
  readonly onDeleteByTag: (tag: string) => void
  readonly tags: readonly string[]
}

export const BatchDeleteDialog = ({
  onCancel,
  onDeleteAll,
  onDeleteByTag,
  tags,
}: BatchDeleteDialogProps): ReactNode => {
  const { modal } = App.useApp()
  const [deleteType, setDeleteType] = useState<"all" | "byTag">("byTag")
  const [deleting, setDeleting] = useState(false)
  const [tag, setTag] = useState<string | null>(null)

  const submit = (): void => {
    if (deleteType === "byTag" && (tag === null || tag.length === 0)) return
    const warning =
      deleteType === "byTag"
        ? `确定要删除标签"${tag}"下的所有素材吗？`
        : "确定要删除所有素材吗？此操作不可恢复！"
    void modal.confirm({
      cancelText: "取消",
      content: warning,
      okText: "确定删除",
      okType: "danger",
      onOk: () => {
        setDeleting(true)
        if (deleteType === "byTag" && tag !== null) onDeleteByTag(tag)
        else onDeleteAll()
        setDeleting(false)
      },
      title: "警告",
    })
  }

  return (
    <Modal
      footer={
        <div className="dialog-footer">
          <Button onClick={onCancel}>取消</Button>
          <Button
            danger
            disabled={deleteType === "byTag" && (tag === null || tag.length === 0)}
            loading={deleting}
            onClick={submit}
            type="primary"
          >
            确认删除
          </Button>
        </div>
      }
      onCancel={onCancel}
      open
      title="批量删除素材"
      width={520}
    >
      <Form layout="vertical" size="small">
        <Radio.Group
          className="batch-delete-options"
          onChange={(event) => setDeleteType(event.target.value)}
          value={deleteType}
        >
          <Radio className="batch-delete-card" value="byTag">
            按标签删除素材
            <div className="muted">删除指定标签下的所有素材资源</div>
          </Radio>
          <Radio className="batch-delete-card" value="all">
            <span className="danger-text">删除全部素材</span>
            <div className="danger-text">危险操作！将删除您的所有素材资源，此操作不可恢复</div>
          </Radio>
        </Radio.Group>
        {deleteType === "byTag" ? (
          <Form.Item label="选择标签" required>
            <BusinessLabelFilter
              page={PageKey.StudioTextPool}
              title="选择标签"
              onChange={(value) => setTag(value || null)}
              options={tags.map((item) => ({ label: item, value: item }))}
              value={tag ?? ""}
            />
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  )
}
