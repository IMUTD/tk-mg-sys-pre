import { Modal, Select, Space } from "antd"
import { type ReactNode, useEffect, useState } from "react"

import { PageKey } from "../../lib/pages"
import { createLabelsApi } from "../labels/api"
import { batchClearOption } from "../labels/batch-assign-dialog"
import "../labels/labels.css"

const keepLatest = (values: readonly string[]): string[] => {
  const last = values.at(-1)
  if (last === undefined) return []
  if (last === "clear") return ["clear"]
  return values.filter((value) => value !== "clear")
}

export const TextTagAssignDialog = ({
  onCancel,
  onSubmit,
  open,
  options,
  selectedCount,
}: {
  readonly onCancel: () => void
  readonly onSubmit: (tags: readonly string[]) => void
  readonly open: boolean
  readonly options: readonly { readonly label: string; readonly value: string }[]
  readonly selectedCount: number
}): ReactNode => {
  const [tags, setTags] = useState<string[]>([])
  const [catalog, setCatalog] = useState<readonly string[]>([])
  useEffect(() => {
    if (!open) return
    setTags([])
    let active = true
    void createLabelsApi()
      .list(PageKey.StudioTextPool)
      .then((result) => {
        if (active) setCatalog(result.groups.map((item) => item.name))
      })
      .catch(() => {
        if (active) setCatalog([])
      })
    return () => {
      active = false
    }
  }, [open])
  const choices = [...new Set([...catalog, ...options.map((item) => item.value)])]
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
  const submit = (): void => {
    if (tags.length === 0) {
      onCancel()
      return
    }
    onSubmit(tags.includes("clear") ? [] : tags)
  }
  return (
    <Modal
      maskClosable={false}
      okText="分配"
      onCancel={onCancel}
      onOk={submit}
      open={open}
      title="批量分配标签"
    >
      <Space direction="vertical" style={{ width: "100%" }}>
        <span>已选 {selectedCount} 条</span>
        <Select
          aria-label="批量标签"
          mode="tags"
          onChange={(values: string[]) => setTags(keepLatest(values))}
          optionFilterProp="label"
          options={[
            batchClearOption("清除标签"),
            ...choices.map((name) => ({ label: name, value: name })),
          ]}
          placeholder="不修改；选择或输入多个标签，追加到选中行"
          style={{ width: "100%" }}
          value={tags}
        />
      </Space>
    </Modal>
  )
}
