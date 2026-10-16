import { Switch } from "antd"
import { type ReactNode, useEffect, useState } from "react"

export type FilterMode = "and" | "or"
export type SelectionScope = "page" | "all"

export const combineChecks = (mode: FilterMode, checks: readonly (boolean | null)[]): boolean => {
  const active = checks.filter((check): check is boolean => check !== null)
  if (active.length === 0) return true
  return mode === "or" ? active.some(Boolean) : active.every(Boolean)
}

export const pageSlice = <RecordType,>(
  rows: readonly RecordType[],
  current: number,
  pageSize: number,
): RecordType[] => rows.slice((current - 1) * pageSize, current * pageSize)

export const useClientPagination = (resetKey: string, initialPageSize = 10) => {
  const [current, setCurrent] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
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
    <span>筛选模式(交集/并集)</span>
    <Switch
      aria-label="筛选模式(交集/并集)"
      checked={mode === "and"}
      checkedChildren="交集"
      onChange={(checked) => onChange(checked ? "and" : "or")}
      unCheckedChildren="并集"
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
