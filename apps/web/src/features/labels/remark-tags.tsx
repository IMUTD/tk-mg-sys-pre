import { Select, Tag } from "antd"
import type { ReactNode } from "react"

import { EditableTextTag } from "./editable-text-tag"
import { addRemarks, joinRemarks, splitRemarks } from "./remark-list"

export const RemarkSelect = ({
  ariaLabel,
  onChange,
  options,
  placeholder = "选择或输入多个备注",
  value,
}: {
  readonly ariaLabel: string
  readonly onChange: (value: string) => void
  readonly options?: readonly string[]
  readonly placeholder?: string
  readonly value: string
}): ReactNode => (
  <Select
    aria-label={ariaLabel}
    mode="tags"
    onChange={(values: string[]) => onChange(joinRemarks(values))}
    options={[...new Set([...(options ?? []), ...splitRemarks(value)])].map((name) => ({
      label: name,
      value: name,
    }))}
    placeholder={placeholder}
    style={{ width: "100%" }}
    value={splitRemarks(value)}
    virtual={false}
  />
)

export const RemarkTags = ({
  canWrite,
  emptyLabel = "备注",
  onChange,
  removeLabel,
  value,
}: {
  readonly canWrite: boolean
  readonly emptyLabel?: string
  readonly onChange: (value: string) => void
  readonly removeLabel: (name: string) => string
  readonly value: string
}): ReactNode => {
  const parts = splitRemarks(value)
  if (!canWrite) {
    if (parts.length === 0) return "-"
    return (
      <span className="remark-tag-list">
        {parts.map((name) => (
          <Tag color="blue" key={name}>
            {name}
          </Tag>
        ))}
      </span>
    )
  }
  const replace = (previous: string, next: string): void => {
    onChange(
      joinRemarks(
        parts.flatMap((item) => (item === previous ? (next.length === 0 ? [] : [next]) : [item])),
      ),
    )
  }
  const shown = parts.length === 0 ? [null] : parts
  return (
    <span className="remark-tag-list">
      {shown.map((name) => (
        <EditableTextTag
          color="blue"
          emptyLabel={emptyLabel}
          key={name ?? "empty"}
          name={name}
          onCommit={(next) =>
            name === null ? onChange(addRemarks(value, [next])) : replace(name, next)
          }
          {...(name === null
            ? {}
            : { onRemove: () => replace(name, ""), removeLabel: removeLabel(name) })}
        />
      ))}
    </span>
  )
}
