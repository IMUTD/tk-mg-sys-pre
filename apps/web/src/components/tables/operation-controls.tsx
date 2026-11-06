import { combineChecks, type FilterMode } from "@tk-mg/task-execution/combine-checks"
import { Segmented, Switch } from "antd"
import { type ReactNode, useEffect, useState } from "react"

export type { FilterMode }
export { combineChecks }
export type SelectionScope = "page" | "all"

const filterModeOptions = [
  { label: "交集", value: "and" },
  { label: "并集", value: "or" },
  { label: "非交集", value: "nand" },
] as const

const isFilterMode = (value: string | number): value is FilterMode =>
  filterModeOptions.some((item) => item.value === value)

export const pageSlice = <RecordType,>(
  rows: readonly RecordType[],
  current: number,
  pageSize: number,
): RecordType[] => rows.slice((current - 1) * pageSize, current * pageSize)

export const useClientPagination = (resetKey: string, initialPageSize = 10) => {
  const [current, setCurrent] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
  // biome-ignore lint/correctness/useExhaustiveDependencies: Filter changes reset pagination through resetKey.
  useEffect(() => {
    setCurrent(1)
  }, [resetKey])
  return {
    current,
    pageSize,
    pagination: {
      current,
      onChange: (page: number, size: number) => {
        if (size !== pageSize) {
          setPageSize(size)
          setCurrent(1)
          return
        }
        setCurrent(page)
      },
      pageSize,
      pageSizeOptions: [10, 20, 50, 100],
      showSizeChanger: true,
      showTotal: (total: number) => `共 ${total} 条`,
    },
  }
}

export const FilterModeSwitch = ({
  mode,
  onChange,
}: {
  readonly mode: FilterMode
  readonly onChange: (mode: FilterMode) => void
}): ReactNode => (
  <span className="list-mode-switch">
    <span>筛选模式</span>
    <Segmented
      aria-label="筛选模式(交集/并集/非交集)"
      onChange={(value) => {
        if (isFilterMode(value)) onChange(value)
      }}
      options={[...filterModeOptions]}
      value={mode}
    />
  </span>
)

export const SelectionScopeSwitch = ({
  onChange,
  scope,
}: {
  readonly onChange: (scope: SelectionScope) => void
  readonly scope: SelectionScope
}): ReactNode => (
  <span className="list-mode-switch">
    <span>全选范围</span>
    <Switch
      aria-label="全选范围"
      checked={scope === "all"}
      checkedChildren="所有结果"
      onChange={(checked) => onChange(checked ? "all" : "page")}
      unCheckedChildren="该页"
    />
  </span>
)
