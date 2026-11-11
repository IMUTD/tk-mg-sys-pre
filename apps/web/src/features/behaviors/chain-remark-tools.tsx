import { App, Button, Checkbox } from "antd"
import { HTTPError } from "ky"
import { type ReactNode, useEffect, useMemo, useState } from "react"

import { PageKey } from "../../lib/pages"
import {
  type BusinessLabel,
  createLabelsApi,
  type LabelScope,
  labelError,
  labelsChanged,
} from "../labels/api"
import {
  BatchAssignDialog,
  type BatchAssignResult,
  batchClearOption,
} from "../labels/batch-assign-dialog"
import { usageLabel } from "../labels/filter-row"
import type { ConditionRow } from "./chain-condition"

type RemarkItem = {
  readonly id: string
  readonly remarks: readonly { readonly id: string; readonly name: string }[]
}

type ChainRemarkTools = {
  readonly dialog: ReactNode
  readonly row: ConditionRow
  readonly selected: ReadonlySet<string>
  readonly toggle: (id: string) => void
  readonly toolbar: ReactNode
}

const assignPath = (scope: "behavior" | "task-chain"): string =>
  scope === "behavior" ? "/api/behavior-chains/remarks" : "/api/task-chains/remarks"

export const useChainRemarkTools = ({
  canWrite,
  filteredIds,
  filters,
  items,
  onFilters,
  onReload,
  scope,
}: {
  readonly canWrite: boolean
  readonly filteredIds: readonly string[]
  readonly filters: readonly string[]
  readonly items: readonly RemarkItem[]
  readonly onFilters: (values: readonly string[]) => void
  readonly onReload: () => void
  readonly scope: Extract<LabelScope, "behavior" | "task-chain">
}): ChainRemarkTools => {
  const { message, modal } = App.useApp()
  const [api] = useState(createLabelsApi)
  const [catalog, setCatalog] = useState<readonly BusinessLabel[]>([])
  const [canRemove, setCanRemove] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [open, setOpen] = useState(false)
  const ids = items.map((item) => item.id).join("\n")

  useEffect(() => {
    const live = new Set(ids.length === 0 ? [] : ids.split("\n"))
    setSelected((current) => {
      const next = new Set([...current].filter((id) => live.has(id)))
      return next.size === current.size ? current : next
    })
  }, [ids])

  useEffect(() => {
    let active = true
    const load = () => {
      void api
        .list(PageKey.Behaviors, scope)
        .then((result) => {
          if (!active) return
          setCatalog(result.remarks)
          setCanRemove(result.canDelete)
        })
        .catch(() => {
          if (active) setCatalog([])
        })
    }
    load()
    window.addEventListener("business-labels-changed", load)
    return () => {
      active = false
      window.removeEventListener("business-labels-changed", load)
    }
  }, [api, scope])

  const counts = useMemo(() => {
    const next = new Map<string, number>()
    for (const item of items) {
      for (const id of new Set(item.remarks.map((remark) => remark.id))) {
        next.set(id, (next.get(id) ?? 0) + 1)
      }
    }
    return next
  }, [items])
  const blank = items.filter((item) => item.remarks.length === 0).length
  const options = useMemo(() => {
    const names = new Map(catalog.map((item) => [item.id, item.name]))
    for (const item of items) {
      for (const remark of item.remarks) names.set(remark.id, remark.name)
    }
    return [...names.entries()]
      .map(([value, name]) => ({
        label: usageLabel(name, counts.get(value) ?? 0),
        removable: canRemove,
        value,
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"))
  }, [canRemove, catalog, counts, items])

  const createRemark = async (name: string) => {
    try {
      await api.create(PageKey.Behaviors, "remark", name, scope)
      labelsChanged()
    } catch (error) {
      message.error(await labelError(error))
      throw error
    }
  }

  const ensureRemark = async (nameOrId: string): Promise<string> => {
    const known = catalog.find((item) => item.id === nameOrId || item.name === nameOrId.trim())
    if (known !== undefined) return known.id
    const name = nameOrId.trim()
    try {
      const created = await api.create(PageKey.Behaviors, "remark", name, scope)
      return created.id
    } catch (error) {
      if (error instanceof HTTPError && error.response.status === 409) {
        const fresh = await api.list(PageKey.Behaviors, scope)
        const found = fresh.remarks.find((item) => item.name === name)
        if (found !== undefined) return found.id
      }
      throw error
    }
  }

  const applyBatch = async (choice: BatchAssignResult) => {
    const body: { ids: string[]; mode: "add" | "replace"; remarkIds: string[] } = {
      ids: [...selected],
      mode: "add",
      remarkIds: [],
    }
    if (choice.remarks.kind === "clear") body.mode = "replace"
    else if (choice.remarks.kind === "set") {
      body.remarkIds = await Promise.all(choice.remarks.values.map((value) => ensureRemark(value)))
    } else return
    const response = await fetch(assignPath(scope), {
      body: JSON.stringify(body),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    if (!response.ok) throw new Error("分配失败")
  }

  const selectedTarget = filteredIds.filter((id) => selected.has(id)).length
  const allSelected = filteredIds.length > 0 && selectedTarget === filteredIds.length
  const toggleFiltered = () => {
    setSelected((current) => {
      const next = new Set(current)
      if (allSelected) {
        for (const id of filteredIds) next.delete(id)
      } else {
        for (const id of filteredIds) next.add(id)
      }
      return next
    })
  }

  return {
    dialog: canWrite ? (
      <BatchAssignDialog
        onCancel={() => setOpen(false)}
        onSubmit={(choice) => {
          void applyBatch(choice)
            .then(() => {
              setOpen(false)
              message.success("已分配")
              labelsChanged()
              onReload()
            })
            .catch((error: unknown) => {
              message.error(error instanceof Error ? error.message : "分配失败")
            })
        }}
        open={open}
        remarkOptions={[
          batchClearOption("清除备注"),
          ...catalog.map((item) => ({ label: item.name, value: item.id })),
        ]}
        selectedCount={selected.size}
      />
    ) : null,
    row: {
      multiple: true,
      onChange: onFilters,
      ...(canWrite ? { onAdd: createRemark } : {}),
      onRemove: (id) => {
        const name =
          catalog.find((label) => label.id === id)?.name ??
          items.flatMap((item) => item.remarks).find((label) => label.id === id)?.name
        if (name === undefined) return
        modal.confirm({
          cancelText: "取消",
          content: `确认删除“${name}”？仍被使用的备注不能删除。`,
          okText: "删除",
          onOk: async () => {
            try {
              await api.remove(PageKey.Behaviors, id, scope)
              onFilters(filters.filter((value) => value !== id))
              labelsChanged()
              onReload()
            } catch (error) {
              message.error(await labelError(error))
              throw error
            }
          },
          title: "删除备注",
        })
      },
      options,
      selected: filters,
      title: "备注",
      tone: "remark",
      unassigned: { label: usageLabel("未备注", blank), value: "none" },
    },
    selected,
    toggle: (id) => {
      setSelected((current) => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },
    toolbar: canWrite ? (
      <>
        <Checkbox
          aria-label="全选筛选结果"
          checked={allSelected}
          disabled={filteredIds.length === 0}
          indeterminate={selectedTarget > 0 && !allSelected}
          onChange={toggleFiltered}
        />
        <Button disabled={selected.size === 0} onClick={() => setOpen(true)} type="primary">
          批量分配（{selected.size}）
        </Button>
      </>
    ) : null,
  }
}
