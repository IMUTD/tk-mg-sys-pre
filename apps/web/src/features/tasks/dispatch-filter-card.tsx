import { Button, Input, Switch, Table } from "antd"
import { type ReactNode, useEffect, useRef, useState } from "react"

import { type FilterMode, FilterModeSwitch } from "../../components/tables/operation-controls"
import { LabelFilterRow, type LabelOption, usageLabel } from "../labels/filter-row"

export type FilterLine = {
  readonly key: string
  readonly options: readonly LabelOption[]
  readonly title: string
  readonly tone: "group" | "remark"
}

export type FilterRow = {
  readonly cells: readonly string[]
  readonly id: string
}

export type FilterCardValue = {
  readonly ids: readonly string[]
  readonly keyword: string
  readonly mode: FilterMode
  readonly selected: Readonly<Record<string, readonly string[]>>
}

type DispatchFilterCardProps = {
  readonly columns: readonly string[]
  readonly extra?: ReactNode
  readonly idle: string
  readonly lines: readonly FilterLine[]
  readonly onChange: (value: FilterCardValue) => void
  readonly placeholder: string
  readonly prepare: (value: FilterCardValue) => readonly FilterRow[]
  readonly required?: boolean
  readonly title: string
  readonly unit: string
}

export const chipOptions = (
  names: readonly string[],
  count: (name: string) => number,
): LabelOption[] => names.map((name) => ({ label: usageLabel(name, count(name)), value: name }))

export const DispatchFilterCard = ({
  columns,
  extra,
  idle,
  lines,
  onChange,
  placeholder,
  prepare,
  required = false,
  title,
  unit,
}: DispatchFilterCardProps): ReactNode => {
  const seen = useRef(new Set<string>())
  const [mode, setMode] = useState<FilterMode>("and")
  const [keyword, setKeyword] = useState("")
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [picked, setPicked] = useState<string[]>([])
  const active =
    lines.some((line) => (selected[line.key] ?? []).length > 0) || keyword.trim().length > 0
  const prepared = prepare({ ids: [], keyword, mode, selected })
  const visible = active ? prepared : []
  const visibleKey = visible.map((row) => row.id).join("\n")
  const chosen = visible.filter((row) => picked.includes(row.id))
  const notify = useRef(onChange)
  notify.current = onChange
  const snapshot = JSON.stringify({
    ids: chosen.map((row) => row.id),
    keyword,
    mode,
    selected,
  })

  useEffect(() => {
    const ids = visibleKey.length === 0 ? [] : visibleKey.split("\n")
    const known = new Set(ids)
    setPicked((current) => {
      const next = current.filter((id) => known.has(id))
      for (const id of ids) {
        if (seen.current.has(id)) continue
        seen.current.add(id)
        next.push(id)
      }
      if (next.length === current.length && next.every((id, index) => id === current[index]))
        return current
      return next
    })
  }, [visibleKey])

  useEffect(() => {
    notify.current(JSON.parse(snapshot) as FilterCardValue)
  }, [snapshot])

  return (
    <div className="dispatch-filter">
      <div className="dispatch-filter-label">
        {required ? <span className="dispatch-filter-req">*</span> : null}
        {title}：
      </div>
      <div className="dispatch-result-label">
        <span>筛选结果</span>
        <span>{active ? `已选 ${chosen.length} / ${visible.length} ${unit}` : ""}</span>
      </div>
      <div className="condition-panel filter-bar dispatch-filter-panel">
        {lines.map((line) => (
          <LabelFilterRow
            key={line.key}
            multiple
            onChange={(values) => setSelected((current) => ({ ...current, [line.key]: values }))}
            options={line.options}
            selected={selected[line.key] ?? []}
            system
            title={line.title}
            tone={line.tone}
          />
        ))}
        <div className="condition-search">
          <span className="filter-label">搜索</span>
          <Input
            allowClear
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={placeholder}
            style={{ width: 220 }}
            value={keyword}
          />
          <Button
            onClick={() => {
              seen.current = new Set()
              setKeyword("")
              setMode("and")
              setSelected({})
              setPicked([])
            }}
          >
            重置
          </Button>
        </div>
        <div className="dispatch-filter-mode">
          <FilterModeSwitch mode={mode} onChange={setMode} />
        </div>
        {extra}
      </div>
      <div className="dispatch-result">
        <Table
          columns={[
            ...columns.map((column, index) => ({
              dataIndex: String(index),
              ellipsis: true,
              title: column,
            })),
          ]}
          dataSource={visible.map((row) => ({
            key: row.id,
            ...Object.fromEntries(row.cells.map((cell, index) => [String(index), cell])),
          }))}
          locale={{ emptyText: active ? "暂无数据" : idle }}
          pagination={false}
          rowSelection={{
            columnWidth: 40,
            onChange: (keys) => setPicked(keys.map(String)),
            selectedRowKeys: chosen.map((row) => row.id),
          }}
          size="small"
        />
      </div>
    </div>
  )
}

export const DrawSwitch = ({
  onChange,
  value,
}: {
  readonly onChange: (value: "random" | "sequence") => void
  readonly value: "random" | "sequence"
}): ReactNode => (
  <span className="dispatch-draw">
    <span className={value === "sequence" ? "on" : ""}>顺序</span>
    <Switch
      aria-label="随机"
      checked={value === "random"}
      onChange={(checked) => onChange(checked ? "random" : "sequence")}
    />
    <span className={value === "random" ? "on" : ""}>随机</span>
  </span>
)
