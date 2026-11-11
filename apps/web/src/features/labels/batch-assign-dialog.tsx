import { Modal, Select, Space } from "antd"
import { type ReactNode, useEffect, useState } from "react"

import "./labels.css"

export type BatchAssignField =
  | { readonly kind: "skip" }
  | { readonly kind: "clear" }
  | { readonly kind: "set"; readonly values: readonly string[] }

export type BatchAssignResult = {
  readonly group: BatchAssignField
  readonly remarks: BatchAssignField
  readonly tags: BatchAssignField
}

type Choice = { readonly label: ReactNode; readonly value: string }

const fieldOf = (values: readonly string[]): BatchAssignField => {
  if (values.length === 0) return { kind: "skip" }
  if (values.includes("clear")) return { kind: "clear" }
  return { kind: "set", values }
}

export const batchClearOption = (text: string): Choice => ({
  label: <span className="label-choice-danger">{text}</span>,
  value: "clear",
})

const keepLatest = (values: readonly string[], multiple: boolean): string[] => {
  const last = values.at(-1)
  if (last === undefined) return []
  if (last === "clear") return ["clear"]
  const named = values.filter((value) => value !== "clear")
  if (multiple) return [...named]
  const chosen = named.at(-1)
  return chosen === undefined ? [] : [chosen]
}

export const BatchAssignDialog = ({
  groupOptions,
  onCancel,
  onSubmit,
  open,
  remarkOptions,
  selectedCount,
  tagOptions,
}: {
  readonly groupOptions?: readonly Choice[]
  readonly onCancel: () => void
  readonly onSubmit: (result: BatchAssignResult) => void
  readonly open: boolean
  readonly remarkOptions: readonly Choice[]
  readonly selectedCount: number
  readonly tagOptions?: readonly Choice[]
}): ReactNode => {
  const [remarks, setRemarks] = useState<string[]>([])
  const [group, setGroup] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  useEffect(() => {
    if (!open) return
    setRemarks([])
    setGroup([])
    setTags([])
  }, [open])
  const submit = (): void => {
    const nextRemarks = fieldOf(remarks)
    const nextGroup = fieldOf(group)
    const nextTags = fieldOf(tagOptions === undefined ? [] : tags)
    if (nextRemarks.kind === "skip" && nextGroup.kind === "skip" && nextTags.kind === "skip") {
      onCancel()
      return
    }
    onSubmit({ group: nextGroup, remarks: nextRemarks, tags: nextTags })
  }
  return (
    <Modal
      maskClosable={false}
      okText="分配"
      onCancel={onCancel}
      onOk={submit}
      open={open}
      title={groupOptions === undefined ? "批量分配备注" : "批量分配备注和分组"}
    >
      <Space direction="vertical" style={{ width: "100%" }}>
        <span>已选 {selectedCount} 条</span>
        <Select
          aria-label="批量备注"
          mode="tags"
          onChange={(values: string[]) => setRemarks(keepLatest(values, true))}
          optionFilterProp="label"
          options={[...remarkOptions]}
          placeholder="不修改；选择或输入多个备注，添加到选中行"
          style={{ width: "100%" }}
          value={remarks}
        />
        {groupOptions === undefined ? null : (
          <Select
            aria-label="批量分组"
            mode="tags"
            onChange={(values: string[]) => setGroup(keepLatest(values, false))}
            optionFilterProp="label"
            options={[...groupOptions]}
            placeholder="不修改；选择一个分组，替换选中行的分组"
            style={{ width: "100%" }}
            value={group}
          />
        )}
        {tagOptions === undefined ? null : (
          <Select
            aria-label="批量标签"
            mode="tags"
            onChange={(values: string[]) => setTags(keepLatest(values, true))}
            optionFilterProp="label"
            options={[...tagOptions]}
            placeholder="不修改；选择或输入多个标签，添加到选中行"
            style={{ width: "100%" }}
            value={tags}
          />
        )}
      </Space>
    </Modal>
  )
}
