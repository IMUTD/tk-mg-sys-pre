import { Checkbox, type TableProps } from "antd"
import { type Key, type ReactNode, useEffect } from "react"

type RowSelection<RecordType> = NonNullable<TableProps<RecordType>["rowSelection"]>

const rowKeys = <RecordType,>(
  rows: readonly RecordType[],
  rowKey: keyof RecordType | ((record: RecordType) => Key),
): Key[] =>
  rows.map((row) => (typeof rowKey === "function" ? rowKey(row) : (row[rowKey] as Key)))

export const toggleFilteredKeys = (
  selected: readonly Key[],
  filtered: readonly Key[],
): Key[] => {
  const allowed = new Set(filtered)
  const chosen = selected.filter((key) => allowed.has(key)).length
  if (filtered.length > 0 && chosen === filtered.length)
    return selected.filter((key) => !allowed.has(key))
  return [...new Set([...selected, ...filtered])]
}

const mergePageKeys = (
  selected: readonly Key[],
  filtered: readonly Key[],
  next: readonly Key[],
): Key[] => {
  const allowed = new Set(filtered)
  return [...selected.filter((key) => !allowed.has(key)), ...next.filter((key) => allowed.has(key))]
}

export const filteredRowSelection = <RecordType,>({
  getCheckboxProps,
  onChange,
  pageKeys,
  rowKey,
  rows,
  selectedKeys,
  selectionScope = "all",
}: {
  readonly getCheckboxProps?: RowSelection<RecordType>["getCheckboxProps"]
  readonly onChange: (keys: Key[]) => void
  readonly pageKeys?: readonly Key[]
  readonly rowKey: keyof RecordType | ((record: RecordType) => Key)
  readonly rows: readonly RecordType[]
  readonly selectedKeys: readonly Key[]
  readonly selectionScope?: "page" | "all"
}): RowSelection<RecordType> => {
  const filtered = rowKeys(rows, rowKey)
  const target = selectionScope === "page" ? [...(pageKeys ?? [])] : filtered
  const targetSet = new Set(target)
  const chosen = selectedKeys.filter((key) => targetSet.has(key)).length
  const allSelected = target.length > 0 && chosen === target.length
  return {
    columnTitle: (
      <Checkbox
        aria-label="全选"
        checked={allSelected}
        disabled={target.length === 0}
        indeterminate={chosen > 0 && !allSelected}
        onChange={() => onChange(toggleFilteredKeys(selectedKeys, target))}
      />
    ),
    ...(getCheckboxProps === undefined ? {} : { getCheckboxProps }),
    onChange: (next, _selectedRows, info) => {
      if (info.type === "all") {
        onChange([...new Set([...selectedKeys, ...target])])
        return
      }
      if (info.type === "none") {
        onChange(selectedKeys.filter((key) => !targetSet.has(key)))
        return
      }
      onChange(mergePageKeys(selectedKeys, filtered, next))
    },
    preserveSelectedRowKeys: true,
    selectedRowKeys: [...selectedKeys],
  }
}

export const useFilteredRowSelection = <RecordType,>(options: {
  readonly getCheckboxProps?: RowSelection<RecordType>["getCheckboxProps"]
  readonly onChange: (keys: Key[]) => void
  readonly pageKeys?: readonly Key[]
  readonly prune?: boolean
  readonly rowKey: keyof RecordType | ((record: RecordType) => Key)
  readonly rows: readonly RecordType[]
  readonly selectedKeys: readonly Key[]
  readonly selectionScope?: "page" | "all"
}): RowSelection<RecordType> => {
  const filtered = rowKeys(options.rows, options.rowKey)
  const signature = filtered.map((key) => String(key)).join("\u0000")
  useEffect(() => {
    if (options.prune === false) return
    const allowed = new Set(filtered)
    const next = options.selectedKeys.filter((key) => allowed.has(key))
    if (next.length !== options.selectedKeys.length) options.onChange(next)
    // biome-ignore lint/correctness/useExhaustiveDependencies: Only drop hidden rows when the filtered key list changes.
  }, [signature, options.prune])
  return filteredRowSelection(options)
}

export const FilteredSelectCheckbox = ({
  busy = false,
  filteredCount,
  onClear,
  onSelectAll,
  selectedCount,
}: {
  readonly busy?: boolean
  readonly filteredCount: number
  readonly onClear: () => void
  readonly onSelectAll: () => void
  readonly selectedCount: number
}): ReactNode => {
  const allSelected = filteredCount > 0 && selectedCount === filteredCount
  return (
    <Checkbox
      aria-label="全选"
      checked={allSelected}
      disabled={busy || filteredCount === 0}
      indeterminate={selectedCount > 0 && !allSelected}
      onChange={() => {
        if (allSelected) onClear()
        else onSelectAll()
      }}
    />
  )
}
