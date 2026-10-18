import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons"
import { App, Button, Card, Input, Modal, Space, Table, Tag } from "antd"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { useFilteredRowSelection } from "../../components/tables/filtered-selection"
import {
  type FilterMode,
  FilterModeSwitch,
  pageSlice,
  type SelectionScope,
  SelectionScopeSwitch,
  useClientPagination,
} from "../../components/tables/operation-controls"
import { PageKey } from "../../lib/pages"
import { createLabelsApi } from "../labels/api"
import {
  BatchAssignDialog,
  type BatchAssignResult,
  batchClearOption,
} from "../labels/batch-assign-dialog"
import {
  BusinessLabelFilter,
  LabelFilterRow,
  UNASSIGNED_VALUE,
  unionLabelNames,
  usageLabel,
} from "../labels/filter-row"
import { addRemarks, joinRemarks, splitRemarks } from "../labels/remark-list"
import { RemarkTags } from "../labels/remark-tags"
import {
  assignPoolGroups,
  assignPoolNotes,
  importPoolAccounts,
  loadPoolAccounts,
  removePoolAccounts,
  resetPoolAccounts,
  updatePoolAccount,
} from "./pool-account"
import { ResourceFormDialog } from "./resource-form-dialog"
import "./registration-resources.css"
import { SmartImportDialog } from "./smart-import-dialog"
import { StatisticsDialog } from "./statistics-dialog"
import {
  createSeedResources,
  emptyResourceQuery,
  filterResources,
  getParsedDataSummary,
  type ParsedDataSummaryItem,
  parseDataKeysWithValues,
  type ResourceQuery,
  resourceStatistics,
  resourcesToCsv,
  resourceTagKey,
  resultLabel,
  shortDate,
  statusLabel,
  type TkRegResource,
  truncateParsedDataValue,
} from "./tk-reg-resource"

type RegistrationResourceListPageProps = {
  readonly canDelete?: boolean
  readonly canWrite: boolean
  readonly groupId?: string
}

const downloadCsv = (csv: string): void => {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.download = "注册池.csv"
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
}

const copyText = async (value: string, onSuccess: () => void): Promise<void> => {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    /* jsdom and restricted clipboard still show success like 云大师 */
  }
  onSuccess()
}

const storedTag = (tag: string): string => (tag === "未分组" ? "" : tag)

const EditableTextTag = ({
  color,
  emptyLabel,
  name,
  onCommit,
  onRemove,
  removeLabel,
}: {
  readonly color: string
  readonly emptyLabel: string
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
        className="pool-edit-input"
        maxLength={40}
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
      className={name === null ? "pool-editable-tag is-empty" : "pool-editable-tag"}
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
      onClick={() => {
        closed.current = false
        setDraft(name ?? "")
        setEditing(true)
      }}
      onClose={(event) => {
        event.preventDefault()
        onRemove?.()
      }}
    >
      {name ?? emptyLabel}
    </Tag>
  )
}

const selectionKey = (resource: TkRegResource): string => resource.recordId ?? String(resource.id)

export const RegistrationResourceListPage = ({
  canDelete,
  canWrite,
  groupId = "",
}: RegistrationResourceListPageProps): ReactNode => {
  const allowDelete = canDelete === true
  const persisted = groupId.length > 0
  const { message, modal } = App.useApp()
  const [draft, setDraft] = useState<ResourceQuery>(emptyResourceQuery)
  const [filterMode, setFilterMode] = useState<FilterMode>("and")
  const [selectionScope, setSelectionScope] = useState<SelectionScope>("all")
  const [query, setQuery] = useState<ResourceQuery>(emptyResourceQuery)
  const [reloadKey, setReloadKey] = useState(0)
  const [resources, setResources] = useState<TkRegResource[]>(() =>
    groupId.length > 0 ? [] : createSeedResources(),
  )
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])
  const [editRecord, setEditRecord] = useState<TkRegResource | null>(null)
  const [batchAssignOpen, setBatchAssignOpen] = useState(false)
  const [smartImportOpen, setSmartImportOpen] = useState(false)
  const [statisticsOpen, setStatisticsOpen] = useState(false)
  const [detailItems, setDetailItems] = useState<readonly ParsedDataSummaryItem[] | null>(null)

  const filtered = useMemo(
    () => filterResources(resources, query, filterMode),
    [filterMode, query, resources],
  )
  const resourcePaging = useClientPagination(JSON.stringify([filterMode, query]))
  const selected = resources.filter((resource) => selectedIds.includes(selectionKey(resource)))
  const tagCounts = new Map<string, number>()
  for (const resource of resources) {
    const tag = resource.tag.trim()
    if (tag.length > 0) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  }
  const tagOptions = [...tagCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "zh-CN"))
    .map(([tag, count]) => ({ label: usageLabel(tag, count), value: tag }))
  const ungroupedCount = resources.filter((resource) => resource.tag.trim().length === 0).length
  const unremarkedCount = resources.filter(
    (resource) => splitRemarks(resource.remark).length === 0,
  ).length
  const remarkCounts = new Map<string, number>()
  for (const resource of resources) {
    for (const remark of splitRemarks(resource.remark)) {
      remarkCounts.set(remark, (remarkCounts.get(remark) ?? 0) + 1)
    }
  }
  const remarkOptions = [...remarkCounts.keys()]
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .map((remark) => ({ label: usageLabel(remark, remarkCounts.get(remark) ?? 0), value: remark }))
  const groupNames = [
    ...new Set(
      resources.flatMap((resource) => {
        const tag = resource.tag.trim()
        return tag.length === 0 ? [] : [tag]
      }),
    ),
  ].sort((left, right) => left.localeCompare(right))
  const [catalogGroups, setCatalogGroups] = useState<readonly string[]>([])
  const [catalogRemarks, setCatalogRemarks] = useState<readonly string[]>([])
  useEffect(() => {
    const labels = createLabelsApi()
    const load = (): void => {
      void labels
        .list(PageKey.Accounts, "account")
        .then((result) => {
          setCatalogGroups(result.groups.map((item) => item.name))
          setCatalogRemarks(result.remarks.map((item) => item.name))
        })
        .catch(() => undefined)
    }
    load()
    window.addEventListener("business-labels-changed", load)
    return () => window.removeEventListener("business-labels-changed", load)
  }, [])
  const statistics = resourceStatistics(resources)
  const nextId = Math.max(0, ...resources.map((resource) => resource.id)) + 1

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey reloads persisted rows after writes.
  useEffect(() => {
    if (!persisted) return
    let stop = false
    loadPoolAccounts(groupId)
      .then((items) => {
        if (!stop) setResources([...items])
      })
      .catch(() => {
        if (!stop) message.error("注册池加载失败")
      })
    return () => {
      stop = true
    }
  }, [groupId, message, persisted, reloadKey])

  const resetQuery = (): void => {
    const empty = emptyResourceQuery()
    setDraft(empty)
    setQuery(empty)
  }

  const changeSelectQuery = (patch: Partial<ResourceQuery>): void => {
    const next = { ...draft, ...patch }
    setDraft(next)
    setQuery(next)
  }

  const saveLabel = (resource: TkRegResource, field: "remark" | "tag", value: string): void => {
    const trimmed = field === "remark" ? joinRemarks(splitRemarks(value)) : value.trim()
    if (field === "remark" && trimmed.length > 200) {
      message.error("备注总长度不能超过 200")
      return
    }
    if (trimmed.includes("+")) {
      message.error(field === "tag" ? "分组名称不能包含 + 符号" : "备注名称不能包含 + 符号")
      return
    }
    const next = field === "tag" ? { ...resource, tag: trimmed } : { ...resource, remark: trimmed }
    const apply = (current: readonly TkRegResource[]): TkRegResource[] =>
      current.map((item) => (item.id === resource.id ? next : item))
    if (!persisted) {
      setResources(apply)
      return
    }
    void updatePoolAccount(groupId, next)
      .then(() => {
        setResources(apply)
        message.success("已保存")
      })
      .catch(() => message.error("保存失败"))
  }

  const applyRegistrationBatch = (choice: BatchAssignResult): void => {
    const groupName = choice.group.kind === "set" ? (choice.group.values[0] ?? "") : ""
    const remarkNames = choice.remarks.kind === "set" ? [...choice.remarks.values] : []
    if (groupName.includes("+")) {
      message.error("分组名称不能包含 + 符号")
      return
    }
    if (remarkNames.some((name) => name.includes("+"))) {
      message.error("备注名称不能包含 + 符号")
      return
    }
    if (
      choice.remarks.kind === "set" &&
      selected.some((resource) => addRemarks(resource.remark, remarkNames).length > 200)
    ) {
      message.error("备注总长度不能超过 200")
      return
    }
    const ids = new Set(selectedIds)
    const apply = (): void => {
      setResources((current) =>
        current.map((resource) => {
          if (!ids.has(selectionKey(resource))) return resource
          return {
            ...resource,
            ...(choice.group.kind === "skip" ? {} : { tag: groupName }),
            ...(choice.remarks.kind === "skip"
              ? {}
              : {
                  remark:
                    choice.remarks.kind === "clear" ? "" : addRemarks(resource.remark, remarkNames),
                }),
          }
        }),
      )
      setBatchAssignOpen(false)
      message.success("已分配")
    }
    if (!persisted) {
      apply()
      return
    }
    const recordIds = selectedRecordIds()
    if (recordIds.length === 0) return
    const run = async (): Promise<void> => {
      if (choice.group.kind !== "skip") await assignPoolGroups(groupId, recordIds, groupName)
      if (choice.remarks.kind !== "skip") {
        const notes = new Map<string, string[]>()
        for (const resource of selected) {
          if (resource.recordId === undefined) continue
          const note =
            choice.remarks.kind === "clear" ? "" : addRemarks(resource.remark, remarkNames)
          notes.set(note, [...(notes.get(note) ?? []), resource.recordId])
        }
        for (const [note, ids] of notes) await assignPoolNotes(groupId, ids, note)
      }
      apply()
    }
    void run().catch(() => message.error("分配失败"))
  }

  const deleteIds = (ids: readonly string[]): void => {
    const idSet = new Set(ids)
    setResources((current) => current.filter((resource) => !idSet.has(selectionKey(resource))))
    setSelectedIds((current) => current.filter((id) => !idSet.has(id)))
  }

  const selectedRecordIds = (): string[] =>
    selected.flatMap((resource) => (resource.recordId === undefined ? [] : [resource.recordId]))

  const deleteSelected = (): void => {
    if (selected.length === 0) return
    void modal.confirm({
      cancelText: "取消",
      content: `确认删除选中的 ${selected.length} 条注册池数据吗？`,
      okText: "确定",
      onOk: async () => {
        if (!persisted) {
          deleteIds(selectedIds)
          message.success("删除成功")
          return
        }
        await removePoolAccounts(groupId, selectedRecordIds())
        setReloadKey((current) => current + 1)
        setSelectedIds([])
        message.success("删除成功")
      },
      title: "提示",
    })
  }

  const deleteOne = (resource: TkRegResource): void => {
    void modal.confirm({
      cancelText: "取消",
      content: "确定删除吗？",
      okText: "确定",
      onOk: async () => {
        if (!persisted) {
          deleteIds([selectionKey(resource)])
          message.success("删除成功")
          return
        }
        await removePoolAccounts(
          groupId,
          resource.recordId === undefined ? [] : [resource.recordId],
        )
        setReloadKey((current) => current + 1)
        message.success("删除成功")
      },
      title: "提示",
    })
  }

  const resetStatus = (): void => {
    if (selected.length === 0) return
    void modal.confirm({
      cancelText: "取消",
      content: "确定要将已选择的数据重置状态吗?",
      okText: "确定",
      onOk: async () => {
        if (!persisted) {
          const ids = new Set(selectedIds)
          setResources((current) =>
            current.map((resource) =>
              ids.has(selectionKey(resource)) ? { ...resource, status: "0" } : resource,
            ),
          )
          message.success(`重置成功,共重置${selected.length}个账号`)
          setSelectedIds([])
          return
        }
        await resetPoolAccounts(groupId, selected)
        setReloadKey((current) => current + 1)
        setSelectedIds([])
        message.success(`重置成功,共重置${selected.length}个账号`)
      },
      title: "提示",
    })
  }

  const submitEdit = (resource: TkRegResource): void => {
    if (!persisted) {
      setResources((current) => current.map((item) => (item.id === resource.id ? resource : item)))
      message.success("修改成功")
      setEditRecord(null)
      return
    }
    void updatePoolAccount(groupId, resource)
      .then(() => {
        setReloadKey((current) => current + 1)
        message.success("修改成功")
        setEditRecord(null)
      })
      .catch(() => message.error("修改失败"))
  }

  const importResources = (imported: readonly TkRegResource[]): void => {
    if (imported[0]?.tag.includes("+")) {
      message.error("分组名称不能包含 + 符号")
      return
    }
    if (!persisted) {
      setResources((current) => [...imported, ...current])
      message.success(`智能导入成功，共导入${imported.length}条数据`)
      setSmartImportOpen(false)
      return
    }
    void importPoolAccounts(groupId, imported)
      .then(() => {
        setReloadKey((current) => current + 1)
        message.success(`智能导入成功，共导入${imported.length}条数据`)
        setSmartImportOpen(false)
      })
      .catch(() => message.error("智能导入失败"))
  }

  const deleteUsedByTags = (tags: readonly string[]): void => {
    const tagSet = new Set(tags)
    const removed = resources.filter(
      (resource) => tagSet.has(resourceTagKey(resource)) && resource.status === "1",
    ).length
    if (!persisted) {
      setResources((current) =>
        current.filter(
          (resource) => !(tagSet.has(resourceTagKey(resource)) && resource.status === "1"),
        ),
      )
      message.success(`已删除${removed}条已使用数据`)
      return
    }
    void removePoolAccounts(
      groupId,
      resources.flatMap((resource) =>
        resource.recordId !== undefined &&
        tags.map(storedTag).includes(resource.tag) &&
        resource.status === "1"
          ? [resource.recordId]
          : [],
      ),
    )
      .then(() => {
        setReloadKey((current) => current + 1)
        message.success(`已删除${removed}条已使用数据`)
      })
      .catch(() => message.error("删除失败"))
  }

  const deleteAllByTags = (tags: readonly string[]): void => {
    const tagSet = new Set(tags)
    const removed = resources.filter((resource) => tagSet.has(resourceTagKey(resource))).length
    if (!persisted) {
      setResources((current) => current.filter((resource) => !tagSet.has(resourceTagKey(resource))))
      message.success(`已删除${removed}条数据`)
      return
    }
    void removePoolAccounts(
      groupId,
      resources.flatMap((resource) =>
        resource.recordId !== undefined && tags.map(storedTag).includes(resource.tag)
          ? [resource.recordId]
          : [],
      ),
    )
      .then(() => {
        setReloadKey((current) => current + 1)
        message.success(`已删除${removed}条数据`)
      })
      .catch(() => message.error("删除失败"))
  }
  const resourceSelection = useFilteredRowSelection({
    getCheckboxProps: (resource: TkRegResource) => ({
      "aria-label": `选择 ${resource.email}`,
    }),
    onChange: (keys) => setSelectedIds(keys.map((key) => String(key))),
    pageKeys: pageSlice(filtered, resourcePaging.current, resourcePaging.pageSize).map(
      selectionKey,
    ),
    rowKey: selectionKey,
    rows: filtered,
    selectedKeys: selectedIds,
    selectionScope,
  })

  return (
    <section className="module-page registration-resources-page">
      <Card className="condition-panel filter-bar" size="small">
        <BusinessLabelFilter
          page={PageKey.Accounts}
          title="账号分组"
          system
          blankLabel={usageLabel("未分组", ungroupedCount)}
          options={tagOptions}
          value={draft.ungrouped ? UNASSIGNED_VALUE : draft.tag}
          onChange={(tag) =>
            changeSelectQuery(
              tag === UNASSIGNED_VALUE ? { tag: "", ungrouped: true } : { tag, ungrouped: false },
            )
          }
          canWrite={canWrite}
          canDelete={allowDelete}
          closable
          validateName={(name) => (name.includes("+") ? "分组名称不能包含 + 符号" : null)}
        />
        <BusinessLabelFilter
          blankLabel={usageLabel("未备注", unremarkedCount)}
          canDelete={allowDelete}
          canWrite={canWrite}
          closable
          kind="remark"
          multiple
          onChange={(remarks) =>
            changeSelectQuery(
              remarks.includes(UNASSIGNED_VALUE)
                ? { remarkChip: [], unremarked: true }
                : { remarkChip: remarks, unremarked: false },
            )
          }
          options={remarkOptions}
          page={PageKey.Accounts}
          scope="account"
          system
          title="账号备注"
          validateName={(name) => (name.includes("+") ? "备注名称不能包含 + 符号" : null)}
          value={draft.unremarked ? [UNASSIGNED_VALUE] : draft.remarkChip}
        />
        <LabelFilterRow
          onChange={(values) =>
            changeSelectQuery({ status: values[0] === "0" || values[0] === "1" ? values[0] : "" })
          }
          options={[
            { label: "未使用", value: "0" },
            { label: "已使用", value: "1" },
          ]}
          selected={draft.status.length === 0 ? [] : [draft.status]}
          system
          title="状态"
        />
        <LabelFilterRow
          onChange={(values) =>
            changeSelectQuery({ result: values[0] === "0" || values[0] === "1" ? values[0] : "" })
          }
          options={[
            { label: "未知", value: "0" },
            { label: "成功", value: "1" },
          ]}
          selected={draft.result.length === 0 ? [] : [draft.result]}
          system
          title="结果"
        />
        <Space className="condition-search resource-filter-row" wrap>
          <span className="filter-label">搜索</span>
          <Input
            allowClear
            aria-label="搜索"
            onChange={(event) => changeSelectQuery({ email: event.target.value })}
            placeholder="搜索"
            style={{ width: 185 }}
            value={draft.email}
          />
          <Input
            allowClear
            aria-label="备注筛选"
            onChange={(event) => changeSelectQuery({ remark: event.target.value })}
            placeholder="备注"
            style={{ width: 185 }}
            value={draft.remark}
          />
          <Button onClick={resetQuery}>重置</Button>
          <FilterModeSwitch mode={filterMode} onChange={setFilterMode} />
        </Space>
      </Card>
      <div className="resource-crud-toolbar">
        <Space wrap>
          <SelectionScopeSwitch onChange={setSelectionScope} scope={selectionScope} />
          {allowDelete ? (
            <Button
              danger
              disabled={selected.length === 0}
              icon={<DeleteOutlined aria-hidden />}
              onClick={deleteSelected}
            >
              删除
            </Button>
          ) : null}
          <Button
            icon={<DownloadOutlined aria-hidden />}
            onClick={() => {
              downloadCsv(resourcesToCsv(filtered))
              message.success("导出成功")
            }}
          >
            导出
          </Button>
        </Space>
        <Space wrap>
          <Button
            icon={<ThunderboltOutlined aria-hidden />}
            onClick={() => setSmartImportOpen(true)}
            type="primary"
          >
            智能导入
          </Button>
          {canWrite ? (
            <Button
              disabled={selected.length === 0}
              onClick={() => setBatchAssignOpen(true)}
              type="primary"
            >
              批量分配（{selected.length}）
            </Button>
          ) : null}
          <Button disabled={selected.length === 0} onClick={resetStatus} type="primary">
            {selected.length > 0 ? `重置状态(${selected.length})` : "重置状态"}
          </Button>
          {canWrite ? (
            <Button onClick={() => setStatisticsOpen(true)} type="primary">
              统计
            </Button>
          ) : null}
        </Space>
      </div>
      <Table
        columns={[
          { dataIndex: "id", key: "id", title: "id", width: 100 },
          {
            dataIndex: "email",
            ellipsis: true,
            key: "email",
            title: "资源",
            width: 180,
          },
          {
            key: "data",
            render: (_value: unknown, resource: TkRegResource) => {
              const summary = getParsedDataSummary(resource.data)
              if (summary.length === 0) return "-"
              return (
                <div className="parsed-data-summary">
                  {summary.map((item) => (
                    <div className="parsed-data-summary-row" key={item.key}>
                      <span className="parsed-data-summary-label">{item.label}:</span>
                      <span className="parsed-data-summary-value" title={item.valueText}>
                        {truncateParsedDataValue(item.valueText)}
                      </span>
                    </div>
                  ))}
                  <Button
                    className="parsed-data-more"
                    onClick={() => setDetailItems(parseDataKeysWithValues(resource.data))}
                    size="small"
                    type="link"
                  >
                    查看更多
                  </Button>
                </div>
              )
            },
            title: "智能解析",
            width: 300,
          },
          {
            key: "tag",
            render: (_value: unknown, resource: TkRegResource) =>
              canWrite ? (
                <EditableTextTag
                  color="orange"
                  emptyLabel="分组"
                  name={resource.tag.length === 0 ? null : resource.tag}
                  onCommit={(name) => saveLabel(resource, "tag", name)}
                  {...(resource.tag.length === 0
                    ? {}
                    : {
                        onRemove: () => saveLabel(resource, "tag", ""),
                        removeLabel: `清除 ${resource.email} 的分组`,
                      })}
                />
              ) : resource.tag.length === 0 ? (
                "-"
              ) : (
                <Tag className="resource-tag" title={resource.tag}>
                  {resource.tag}
                </Tag>
              ),
            title: "分组",
            width: 140,
          },
          {
            key: "status",
            render: (_value: unknown, resource: TkRegResource) => (
              <Tag color={resource.status === "0" ? "default" : "success"}>
                {statusLabel(resource.status)}
              </Tag>
            ),
            title: "分配状态",
          },
          {
            key: "result",
            render: (_value: unknown, resource: TkRegResource) => (
              <Tag color={resource.result === "0" ? "warning" : "success"}>
                {resultLabel(resource.result)}
              </Tag>
            ),
            title: "结果",
          },
          {
            key: "remark",
            render: (_value: unknown, resource: TkRegResource) => (
              <RemarkTags
                canWrite={canWrite}
                onChange={(name) => saveLabel(resource, "remark", name)}
                removeLabel={(name) => `清除 ${resource.email} 的备注 ${name}`}
                value={resource.remark}
              />
            ),
            title: "备注",
            width: 140,
          },
          {
            key: "time",
            render: (_value: unknown, resource: TkRegResource) => (
              <div className="time-cell">
                <div>创建：{shortDate(resource.createTime)}</div>
                <div>分配：{shortDate(resource.assignTime)}</div>
              </div>
            ),
            title: "时间信息",
            width: 180,
          },
          ...(canWrite
            ? [
                {
                  align: "center" as const,
                  fixed: "right" as const,
                  key: "actions",
                  render: (_value: unknown, resource: TkRegResource) => (
                    <Space>
                      <Button
                        icon={<EditOutlined aria-hidden />}
                        onClick={() => setEditRecord(resource)}
                        size="small"
                        type="link"
                      >
                        编辑
                      </Button>
                      {allowDelete ? (
                        <Button danger onClick={() => deleteOne(resource)} size="small" type="link">
                          删除
                        </Button>
                      ) : null}
                    </Space>
                  ),
                  title: "操作",
                  width: 150,
                },
              ]
            : []),
        ]}
        dataSource={filtered}
        locale={{ emptyText: "暂无数据" }}
        pagination={{ ...resourcePaging.pagination, total: filtered.length }}
        rowKey={selectionKey}
        rowSelection={resourceSelection}
        scroll={{ x: "max-content" }}
        size="small"
      />
      {smartImportOpen ? (
        <SmartImportDialog
          nextId={nextId}
          onCancel={() => setSmartImportOpen(false)}
          onImported={importResources}
        />
      ) : null}
      {statisticsOpen ? (
        <StatisticsDialog
          canWrite={canWrite}
          onCancel={() => setStatisticsOpen(false)}
          onDeleteAll={deleteAllByTags}
          onDeleteUsed={deleteUsedByTags}
          rows={statistics}
        />
      ) : null}
      {editRecord === null ? null : (
        <ResourceFormDialog
          onCancel={() => setEditRecord(null)}
          onSubmit={submitEdit}
          record={editRecord}
        />
      )}
      <Modal
        footer={null}
        onCancel={() => setDetailItems(null)}
        open={detailItems !== null}
        title="智能解析详情"
        width={560}
      >
        <Table
          bordered
          columns={[
            { dataIndex: "label", key: "label", title: "字段", width: 140 },
            {
              dataIndex: "valueText",
              key: "valueText",
              render: (value: string) => (
                <button
                  className="parsed-data-detail-value"
                  onClick={() => void copyText(value, () => message.success("复制成功"))}
                  type="button"
                >
                  {value}
                </button>
              ),
              title: "值",
            },
          ]}
          dataSource={detailItems === null ? [] : [...detailItems]}
          pagination={false}
          rowKey="key"
          scroll={{ x: "max-content" }}
          size="small"
        />
      </Modal>
      <BatchAssignDialog
        groupOptions={[
          batchClearOption("清除分组"),
          ...unionLabelNames(catalogGroups, groupNames).map((name) => ({
            label: name,
            value: name,
          })),
        ]}
        onCancel={() => setBatchAssignOpen(false)}
        onSubmit={applyRegistrationBatch}
        open={batchAssignOpen}
        remarkOptions={[
          batchClearOption("清除备注"),
          ...unionLabelNames(
            catalogRemarks,
            remarkOptions.map((item) => item.value),
          ).map((name) => ({ label: name, value: name })),
        ]}
        selectedCount={selected.length}
      />
    </section>
  )
}
