import { PlusOutlined } from "@ant-design/icons"
import { Alert, App, Button, Input, Tag, Tooltip } from "antd"
import { type ReactNode, useEffect, useRef, useState } from "react"

import {
  type BusinessLabel,
  createLabelsApi,
  type LabelKind,
  type LabelScope,
  labelError,
  labelScopeForPage,
  labelsChanged,
} from "./api"
import "./labels.css"

export const UNASSIGNED_VALUE = "\u0000unassigned"

export const usageLabel = (name: string, count: number): string =>
  count > 0 ? `${name}(${count})` : name

export const unionLabelNames = (...groups: readonly (readonly string[])[]): string[] =>
  [...new Set(groups.flat().map((name) => name.trim()).filter((name) => name.length > 0))].sort(
    (left, right) => left.localeCompare(right, "zh-CN"),
  )

export type LabelOption = {
  readonly value: string
  readonly label: string
  readonly removable?: boolean
}

type LabelRowProps = {
  readonly title: string
  readonly kind?: LabelKind
  readonly tone?: "remark" | "group" | "status"
  readonly options: readonly LabelOption[]
  readonly selected: readonly string[]
  readonly onChange: (values: string[]) => void
  readonly multiple?: boolean
  readonly allowClear?: boolean
  readonly system?: boolean
  readonly onAdd?: (name: string) => void | Promise<void>
  readonly onRemove?: (value: string) => void
  readonly unassigned?: { readonly value: string; readonly label: string }
}

export const LabelFilterRow = ({
  title,
  kind = "group",
  tone,
  options,
  selected,
  onChange,
  multiple = false,
  allowClear = true,
  system = false,
  onAdd,
  onRemove,
  unassigned,
}: LabelRowProps): ReactNode => {
  const rowTone = tone ?? kind
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState("")
  const closed = useRef(false)
  const finish = (next: string) => {
    if (closed.current || onAdd === undefined) return
    const trimmed = next.trim()
    if (trimmed.length === 0) {
      closed.current = true
      setAdding(false)
      setDraft("")
      return
    }
    closed.current = true
    void Promise.resolve(onAdd(trimmed))
      .then(() => {
        setAdding(false)
        setDraft("")
      })
      .catch(() => {
        closed.current = false
      })
  }
  const choose = (value: string): void => {
    if (unassigned !== undefined && value === unassigned.value) {
      onChange(selected.includes(value) ? [] : [value])
      return
    }
    const rest =
      unassigned === undefined ? selected : selected.filter((item) => item !== unassigned.value)
    if (rest.includes(value)) {
      if (allowClear) onChange(rest.filter((item) => item !== value))
    } else onChange(multiple ? [...rest, value] : [value])
  }
  return (
    <fieldset
      aria-label={title}
      className={`classification-row tone-${rowTone}${system ? " tone-system" : ""}`}
    >
      <span className="classification-title">{title}</span>
      {allowClear ? (
        <Tag
          role="button"
          tabIndex={0}
          aria-pressed={selected.length === 0}
          className={selected.length === 0 ? "classification-selected" : ""}
          onClick={() => onChange([])}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              onChange([])
            }
          }}
        >
          全部
        </Tag>
      ) : null}
      {unassigned === undefined ? null : (
        <Tag
          role="button"
          tabIndex={0}
          aria-label={unassigned.label}
          aria-pressed={selected.includes(unassigned.value)}
          className={selected.includes(unassigned.value) ? "classification-selected" : ""}
          onClick={() => choose(unassigned.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              choose(unassigned.value)
            }
          }}
        >
          {unassigned.label}
        </Tag>
      )}
      {options.map((item) => (
        <Tag
          {...(system || rowTone === "status"
            ? {}
            : { color: rowTone === "remark" ? ("blue" as const) : ("orange" as const) })}
          key={item.value}
          role="button"
          aria-label={item.label}
          tabIndex={0}
          aria-pressed={selected.includes(item.value)}
          className={selected.includes(item.value) ? "classification-selected" : ""}
          closable={item.removable === true && onRemove !== undefined}
          onClick={() => choose(item.value)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              choose(item.value)
            }
          }}
          onClose={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onRemove?.(item.value)
          }}
        >
          {item.label}
        </Tag>
      ))}
      {onAdd === undefined ? null : adding ? (
        <Input
          aria-label={`添加${title}`}
          autoFocus
          className="classification-add-input"
          maxLength={40}
          onBlur={() => finish(draft)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              closed.current = true
              setDraft("")
              setAdding(false)
            }
          }}
          onPressEnter={() => finish(draft)}
          size="small"
          value={draft}
        />
      ) : (
        <Tooltip title={`添加${title}`}>
          <Button
            aria-label={`添加${title}`}
            className="classification-plus"
            icon={<PlusOutlined />}
            size="small"
            type="text"
            onClick={() => {
              closed.current = false
              setDraft("")
              setAdding(true)
            }}
          />
        </Tooltip>
      )}
    </fieldset>
  )
}

type BusinessFilterProps = {
  readonly page: string
  readonly scope?: LabelScope
  readonly title?: string
  readonly kind?: LabelKind
  readonly options?: readonly LabelOption[]
  readonly canWrite?: boolean
  readonly canDelete?: boolean
  readonly blankLabel?: string
  readonly closable?: boolean
  readonly system?: boolean
  readonly validateName?: (name: string) => string | null
} & (
  | {
      readonly multiple?: false
      readonly value: string
      readonly onChange: (value: string) => void
    }
  | {
      readonly multiple: true
      readonly value: readonly string[]
      readonly onChange: (value: string[]) => void
    }
)

export const BusinessLabelFilter = (props: BusinessFilterProps): ReactNode => {
  const {
    page,
    kind = "group",
    title = "分组",
    options = [],
    canWrite = false,
    canDelete = false,
    blankLabel,
    closable = false,
    system = false,
  } = props
  const scope = props.scope ?? labelScopeForPage(page)
  const { message, modal } = App.useApp()
  const [api] = useState(createLabelsApi)
  const [catalog, setCatalog] = useState<readonly BusinessLabel[]>([])
  const [allowDelete, setAllowDelete] = useState(false)
  const [error, setError] = useState(false)
  const selected = props.multiple === true ? props.value : props.value === "" ? [] : [props.value]
  const change = (values: string[]): void => {
    if (props.multiple === true) props.onChange(values)
    else props.onChange(values[0] ?? "")
  }

  useEffect(() => {
    let active = true
    const load = () => {
      void api
        .list(page, scope)
        .then((result) => {
          if (!active) return
          setCatalog(kind === "group" ? result.groups : result.remarks)
          setAllowDelete(result.canDelete)
          setError(false)
        })
        .catch(() => {
          if (active) setError(true)
        })
    }
    setCatalog([])
    setAllowDelete(false)
    load()
    window.addEventListener("business-labels-changed", load)
    window.addEventListener("focus", load)
    return () => {
      active = false
      window.removeEventListener("business-labels-changed", load)
      window.removeEventListener("focus", load)
    }
  }, [page, scope, kind, api])

  const items = new Map(options.map((item) => [item.value, item]))
  for (const item of catalog) {
    const existing = items.get(item.name)
    items.set(item.name, {
      value: item.name,
      label: existing?.label ?? item.name,
      removable: canDelete && allowDelete && (closable || existing === undefined),
    })
  }
  for (const value of selected) {
    if (value === UNASSIGNED_VALUE || items.has(value)) continue
    items.set(value, { value, label: value })
  }

  const save = async (value: string): Promise<void> => {
    const invalid = props.validateName?.(value)
    if (invalid) {
      message.error(invalid)
      throw new Error(invalid)
    }
    try {
      await api.create(page, kind, value, scope)
      labelsChanged()
    } catch (failure) {
      message.error(await labelError(failure))
      throw failure
    }
  }

  return (
    <>
      <LabelFilterRow
        title={title}
        kind={kind}
        options={[...items.values()]}
        selected={selected}
        onChange={change}
        multiple={props.multiple === true}
        system={system}
        {...(blankLabel === undefined
          ? {}
          : { unassigned: { value: UNASSIGNED_VALUE, label: blankLabel } })}
        {...(canWrite ? { onAdd: save } : {})}
        onRemove={(value) => {
          const item = catalog.find((label) => label.name === value)
          if (item === undefined) return
          modal.confirm({
            title: `删除${title}`,
            content: `确认删除“${value}”？仍被业务数据使用的分类不能删除。`,
            okText: "删除",
            cancelText: "取消",
            onOk: async () => {
              try {
                await api.remove(page, item.id, scope)
                change(selected.filter((current) => current !== value))
                labelsChanged()
              } catch (failure) {
                message.error(await labelError(failure))
                throw failure
              }
            },
          })
        }}
      />
      {error ? <Alert type="error" showIcon message="分类加载失败" /> : null}
    </>
  )
}
