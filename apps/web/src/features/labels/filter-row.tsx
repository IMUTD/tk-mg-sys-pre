import { PlusOutlined } from "@ant-design/icons"
import { Alert, App, Button, Input, Modal, Tag, Tooltip } from "antd"
import { type ReactNode, useEffect, useState } from "react"

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

export type LabelOption = {
  readonly value: string
  readonly label: string
  readonly removable?: boolean
}

type LabelRowProps = {
  readonly title: string
  readonly kind?: LabelKind
  readonly options: readonly LabelOption[]
  readonly selected: readonly string[]
  readonly onChange: (values: string[]) => void
  readonly multiple?: boolean
  readonly allowClear?: boolean
  readonly onAdd?: () => void
  readonly onRemove?: (value: string) => void
}

export const LabelFilterRow = ({
  title,
  kind = "group",
  options,
  selected,
  onChange,
  multiple = false,
  allowClear = true,
  onAdd,
  onRemove,
}: LabelRowProps): ReactNode => {
  const choose = (value: string): void => {
    if (selected.includes(value)) {
      if (allowClear) onChange(selected.filter((item) => item !== value))
    } else onChange(multiple ? [...selected, value] : [value])
  }
  return (
    <fieldset aria-label={title} className={`classification-row tone-${kind}`}>
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
      {options.map((item) => (
        <Tag
          color={kind === "remark" ? "blue" : "orange"}
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
      {onAdd === undefined ? null : (
        <Tooltip title={`添加${title}`}>
          <Button
            aria-label={`添加${title}`}
            className="classification-plus"
            icon={<PlusOutlined />}
            size="small"
            type="text"
            onClick={onAdd}
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
  } = props
  const scope = props.scope ?? labelScopeForPage(page)
  const { message, modal } = App.useApp()
  const [api] = useState(createLabelsApi)
  const [catalog, setCatalog] = useState<readonly BusinessLabel[]>([])
  const [allowDelete, setAllowDelete] = useState(false)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
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
      removable: canDelete && allowDelete && existing === undefined,
    })
  }
  for (const value of selected) if (!items.has(value)) items.set(value, { value, label: value })

  const save = async (): Promise<void> => {
    const value = name.trim()
    if (saving || value.length === 0) return
    const invalid = props.validateName?.(value)
    if (invalid) {
      message.error(invalid)
      return
    }
    setSaving(true)
    try {
      await api.create(page, kind, value, scope)
      setOpen(false)
      setName("")
      labelsChanged()
    } catch (failure) {
      message.error(await labelError(failure))
    } finally {
      setSaving(false)
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
        {...(canWrite
          ? {
              onAdd: () => {
                setName("")
                setOpen(true)
              },
            }
          : {})}
        onRemove={(value) => {
          const item = catalog.find((label) => label.name === value)
          if (item === undefined) return
          modal.confirm({
            title: `删除${title}`,
            content:
              scope === "device"
                ? `确认删除“${value}”？盒子上的对应分类也会清除。`
                : `确认删除“${value}”？仍被业务数据使用的分类不能删除。`,
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
      <Modal
        title={`添加${title}`}
        open={open}
        okText="添加"
        cancelText="取消"
        confirmLoading={saving}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
      >
        <Input
          aria-label="分类名称"
          maxLength={40}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onPressEnter={() => void save()}
        />
      </Modal>
    </>
  )
}
