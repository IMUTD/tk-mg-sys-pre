import { Input, Tag } from "antd"
import { type ReactNode, useEffect, useRef, useState } from "react"

import "./labels.css"

export const EditableTextTag = ({
  color,
  emptyLabel,
  maxLength = 40,
  name,
  onCommit,
  onRemove,
  removeLabel,
}: {
  readonly color: string
  readonly emptyLabel: string
  readonly maxLength?: number
  readonly name: string | null
  readonly onCommit: (name: string) => void
  readonly onRemove?: () => void
  readonly removeLabel?: string
}): ReactNode => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name ?? "")
  const closed = useRef(false)
  useEffect(() => setDraft(name ?? ""), [name])
  const finish = (next: string) => {
    if (closed.current) return
    closed.current = true
    setEditing(false)
    const trimmed = next.trim()
    if (trimmed === (name ?? "")) return
    onCommit(trimmed)
  }
  if (editing) {
    return (
      <Input
        aria-label={emptyLabel}
        autoFocus
        className="editable-text-input"
        maxLength={maxLength}
        onBlur={() => finish(draft)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            closed.current = true
            setDraft(name ?? "")
            setEditing(false)
          }
        }}
        onPressEnter={() => finish(draft)}
        size="small"
        value={draft}
      />
    )
  }
  return (
    <Tag
      className={name === null ? "editable-text-tag is-empty" : "editable-text-tag"}
      closable={name !== null && onRemove !== undefined}
      {...(name !== null && onRemove !== undefined && removeLabel !== undefined
        ? {
            closeIcon: (
              <span role="img" aria-label={removeLabel}>
                ×
              </span>
            ),
          }
        : {})}
      {...(name === null ? {} : { color })}
      onClick={(event) => {
        const target = event.target
        if (target instanceof Element && target.closest(".ant-tag-close-icon") !== null) return
        closed.current = false
        setDraft(name ?? "")
        setEditing(true)
      }}
      onClose={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onRemove?.()
      }}
    >
      {name ?? emptyLabel}
    </Tag>
  )
}
