import { Button, Card, Input } from "antd"
import type { ReactNode } from "react"

import { type FilterMode, FilterModeSwitch } from "../../components/tables/operation-controls"
import { LabelFilterRow, type LabelOption } from "../labels/filter-row"

export type ConditionRow = {
  readonly multiple?: boolean
  readonly onAdd?: (name: string) => void | Promise<void>
  readonly onChange: (values: string[]) => void
  readonly onRemove?: (value: string) => void
  readonly options: readonly LabelOption[]
  readonly selected: readonly string[]
  readonly system?: boolean
  readonly title: string
  readonly tone?: "remark" | "group" | "status"
  readonly unassigned?: { readonly label: string; readonly value: string }
}

type ChainConditionCardProps = {
  readonly keyword: string
  readonly mode: FilterMode
  readonly onKeyword: (value: string) => void
  readonly onMode: (mode: FilterMode) => void
  readonly onReset: () => void
  readonly placeholder: string
  readonly rows: readonly ConditionRow[]
  readonly searchLabel: string
}

export const ChainConditionCard = ({
  keyword,
  mode,
  onKeyword,
  onMode,
  onReset,
  placeholder,
  rows,
  searchLabel,
}: ChainConditionCardProps): ReactNode => (
  <Card className="condition-panel filter-bar" size="small">
    {rows.map((row) => (
      <LabelFilterRow
        key={row.title}
        multiple={row.multiple === true}
        onChange={row.onChange}
        options={row.options}
        selected={row.selected}
        system={row.system === true}
        title={row.title}
        {...(row.onAdd === undefined ? {} : { onAdd: row.onAdd })}
        {...(row.onRemove === undefined ? {} : { onRemove: row.onRemove })}
        {...(row.tone === undefined ? {} : { tone: row.tone })}
        {...(row.unassigned === undefined ? {} : { unassigned: row.unassigned })}
      />
    ))}
    <div className="condition-search">
      <span className="filter-label">搜索</span>
      <Input
        allowClear
        aria-label={searchLabel}
        onChange={(event) => onKeyword(event.target.value)}
        placeholder={placeholder}
        style={{ width: 240 }}
        value={keyword}
      />
      <Button onClick={onReset}>重置</Button>
      <FilterModeSwitch mode={mode} onChange={onMode} />
    </div>
  </Card>
)
