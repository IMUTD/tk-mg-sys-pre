import { DeleteOutlined, EditOutlined, UploadOutlined } from "@ant-design/icons"
import { App, Button, Card, Checkbox, Input, Space, Table } from "antd"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import {
  type FilterMode,
  FilterModeSwitch,
  pageSlice,
  type SelectionScope,
  SelectionScopeSwitch,
  useClientPagination,
} from "../../components/tables/operation-controls"

import { createTextPoolApi, type TextPoolApi } from "./api"
import { BatchDeleteDialog } from "./batch-delete-dialog"
import { MaterialFormDialog } from "./form-dialog"
import { MaterialImportDialog } from "./import-dialog"
import {
  createSeedMaterials,
  emptyMaterialQuery,
  filterTextPool,
  type MaterialQuery,
  type MytMaterial,
  materialLabelSet,
  materialStatistics,
  uniqueTags,
} from "./myt-material"
import "./resources.css"
import { PageKey } from "../../lib/pages"
import { labelsChanged } from "../labels/api"
import { EditableTextTag } from "../labels/editable-text-tag"
import { BusinessLabelFilter, UNASSIGNED_VALUE, usageLabel } from "../labels/filter-row"
import { MaterialStatisticsDialog } from "./statistics-dialog"
import { TextTagAssignDialog } from "./tag-assign-dialog"

type ResourcesListPageProps = {
  readonly api?: TextPoolApi
  readonly canDelete?: boolean
  readonly canWrite: boolean
  readonly groupId?: string
}

export const ResourcesListPage = ({
  api,
  canDelete,
  canWrite,
  groupId = "",
}: ResourcesListPageProps): ReactNode => {
  const allowDelete = canDelete === true
  const { message, modal } = App.useApp()
  const pool = useMemo(() => api ?? createTextPoolApi(groupId), [api, groupId])
  const [keyword, setKeyword] = useState("")
  const [filterMode, setFilterMode] = useState<FilterMode>("and")
  const [selectionScope, setSelectionScope] = useState<SelectionScope>("all")
  const [query, setQuery] = useState<MaterialQuery>(emptyMaterialQuery)
  const [materials, setMaterials] = useState<MytMaterial[]>(() => createSeedMaterials())
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])
  const [loading, setLoading] = useState(false)
  const [editRecord, setEditRecord] = useState<MytMaterial | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [statisticsOpen, setStatisticsOpen] = useState(false)

  const filtered = useMemo(
    () => filterTextPool(materials, { ...query, keyword, mode: filterMode }),
    [filterMode, keyword, materials, query],
  )
  const paging = useClientPagination(
    `${keyword}\0${filterMode}\0${query.tags.join("\u001e")}\0${query.untagged}`,
  )
  const pageRows = pageSlice(filtered, paging.current, paging.pageSize)
  const targetIds = (selectionScope === "page" ? pageRows : filtered).map((item) => item.id)
  const selectedTarget = targetIds.filter((id) => selectedIds.includes(id)).length
  const allTargetSelected = targetIds.length > 0 && selectedTarget === targetIds.length
  const selected = materials.filter((item) => selectedIds.includes(item.id))
  const tags = uniqueTags(materials)
  const tagCounts = new Map<string, number>()
  let untaggedCount = 0
  for (const item of materials) {
    const labels = materialLabelSet(item)
    if (labels.length === 0) untaggedCount += 1
    for (const tag of labels) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  }
  const tagOptions = tags.map((tag) => ({
    label: usageLabel(tag, tagCounts.get(tag) ?? 0),
    value: tag,
  }))
  const statistics = materialStatistics(materials)
  const reload = useCallback(async (): Promise<void> => {
    if (api === undefined && groupId.length === 0) {
      setMaterials([])
      return
    }
    setLoading(true)
    try {
      setMaterials([...(await pool.list())])
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败")
    } finally {
      setLoading(false)
    }
  }, [api, groupId, message, pool])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const allowed = new Set(filtered.map((item) => item.id))
    setSelectedIds((current) => {
      const next = current.filter((id) => allowed.has(id))
      return next.length === current.length ? current : next
    })
  }, [filtered])

  const resetQuery = (): void => {
    setKeyword("")
    setQuery(emptyMaterialQuery())
  }

  const saveLabel = async (item: MytMaterial, from: string, to: string): Promise<void> => {
    try {
      if (from.length === 0) {
        if (to.length === 0) return
        await pool.setLabels(item.id, { category: to })
      } else {
        const nextCategory = item.tag.trim() === from ? to : item.tag
        const seen = new Set<string>()
        const nextTags: string[] = []
        for (const raw of item.tags ?? []) {
          const name = raw.trim() === from ? to : raw.trim()
          if (name.length === 0 || seen.has(name)) continue
          seen.add(name)
          nextTags.push(name)
        }
        await pool.setLabels(item.id, { category: nextCategory, tags: nextTags })
      }
      await reload()
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败")
    }
  }

  const remove = async (ids: readonly string[], success: string): Promise<void> => {
    try {
      await pool.deleteIds(ids)
      setSelectedIds([])
      await reload()
      message.success(success)
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败")
    }
  }

  const deleteSelected = (): void => {
    if (selected.length === 0) return
    void modal.confirm({
      cancelText: "取消",
      content: `确认删除选中的 ${selected.length} 条素材吗？`,
      okText: "确定",
      onOk: () => remove(selectedIds, "删除成功"),
      title: "提示",
    })
  }

  const deleteOne = (item: MytMaterial): void => {
    void modal.confirm({
      cancelText: "取消",
      content: "确定删除吗？",
      okText: "确定",
      onOk: () => remove([item.id], "删除成功"),
      title: "提示",
    })
  }

  const openEditSelected = (): void => {
    if (selected.length !== 1) return
    const record = selected[0]
    if (record === undefined) return
    setEditRecord(record)
  }
  const toggleFiltered = (): void => {
    setSelectedIds((current) => {
      if (allTargetSelected) return current.filter((id) => !targetIds.includes(id))
      return [...new Set([...current, ...targetIds])]
    })
  }

  const toggleOne = (id: string): void => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  return (
    <section className="module-page resources-page">
      <Card className="condition-panel filter-bar" size="small">
        <BusinessLabelFilter
          page={PageKey.StudioTextPool}
          system
          title="标签"
          blankLabel={usageLabel("未标签", untaggedCount)}
          independentUnassigned
          multiple
          options={tagOptions}
          value={[...query.tags, ...(query.untagged ? [UNASSIGNED_VALUE] : [])]}
          onChange={(tags) =>
            setQuery({
              tags: tags.filter((tag) => tag !== UNASSIGNED_VALUE),
              untagged: tags.includes(UNASSIGNED_VALUE),
            })
          }
          canWrite={canWrite}
          canDelete={allowDelete}
        />
        <div className="condition-search">
          <span className="filter-label">搜索</span>
          <Input
            allowClear
            aria-label="搜索"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="标签 / 内容 / 说明"
            style={{ width: 240 }}
            value={keyword}
          />
          <Button onClick={resetQuery}>重置</Button>
          <FilterModeSwitch mode={filterMode} onChange={setFilterMode} />
        </div>
      </Card>
      <div className="resource-crud-toolbar">
        <Space wrap>
          <SelectionScopeSwitch onChange={setSelectionScope} scope={selectionScope} />
          {canWrite ? (
            <Button
              disabled={selected.length === 0}
              onClick={() => setAssignOpen(true)}
              type="primary"
            >
              批量分配（{selected.length}）
            </Button>
          ) : null}
          {canWrite ? (
            <>
              <Button disabled={selected.length !== 1} onClick={openEditSelected}>
                修改
              </Button>
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
            </>
          ) : null}
        </Space>
        <Space wrap>
          <Button onClick={() => setStatisticsOpen(true)} type="primary">
            统计
          </Button>
          {allowDelete ? (
            <Button danger onClick={() => setBatchDeleteOpen(true)}>
              批量删除
            </Button>
          ) : null}
          <Button
            icon={<UploadOutlined aria-hidden />}
            onClick={() => setImportOpen(true)}
            type="primary"
          >
            批量导入
          </Button>
        </Space>
      </div>
      <Table
        columns={[
          {
            title: (
              <Checkbox
                aria-label="全选"
                checked={allTargetSelected}
                disabled={targetIds.length === 0}
                indeterminate={selectedTarget > 0 && !allTargetSelected}
                onChange={toggleFiltered}
              />
            ),
            width: 48,
            render: (_value: unknown, item: MytMaterial) => (
              <Checkbox
                aria-label={`选择 ${item.content}`}
                checked={selectedIds.includes(item.id)}
                onChange={() => toggleOne(item.id)}
              />
            ),
          },
          {
            dataIndex: "tag",
            ellipsis: true,
            key: "tag",
            render: (_value: string, item: MytMaterial) => {
              const labels = materialLabelSet(item)
              if (!canWrite) return labels.length === 0 ? "未标签" : labels.join("、")
              if (labels.length === 0) {
                return (
                  <EditableTextTag
                    color="orange"
                    emptyLabel="未标签"
                    maxLength={80}
                    name={null}
                    onCommit={(name) => void saveLabel(item, "", name)}
                  />
                )
              }
              return (
                <Space size={4} wrap>
                  {labels.map((name) => (
                    <EditableTextTag
                      color="orange"
                      emptyLabel="未标签"
                      key={name}
                      maxLength={80}
                      name={name}
                      onCommit={(next) => void saveLabel(item, name, next)}
                      onRemove={() => void saveLabel(item, name, "")}
                      removeLabel="清除标签"
                    />
                  ))}
                </Space>
              )
            },
            title: "标签",
          },
          { dataIndex: "content", ellipsis: true, key: "content", title: "资源内容" },
          {
            dataIndex: "assignedCount",
            key: "assignedCount",
            title: "已分配次数",
            width: 120,
          },
          {
            dataIndex: "lastAccount",
            ellipsis: true,
            key: "lastAccount",
            render: (value: string | undefined) => value ?? "",
            title: "上次账号",
            width: 160,
          },
          {
            dataIndex: "remark",
            ellipsis: true,
            key: "remark",
            render: (remark: string) => (remark.length === 0 ? "-" : remark),
            title: "说明",
          },
          ...(canWrite
            ? [
                {
                  align: "center" as const,
                  fixed: "right" as const,
                  key: "actions",
                  render: (_value: unknown, item: MytMaterial) => (
                    <Space>
                      <Button
                        icon={<EditOutlined aria-hidden />}
                        onClick={() => setEditRecord(item)}
                        size="small"
                        type="link"
                      >
                        编辑
                      </Button>
                      {allowDelete ? (
                        <Button danger onClick={() => deleteOne(item)} size="small" type="link">
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
        loading={loading}
        pagination={{ ...paging.pagination, total: filtered.length }}
        rowKey="id"
        scroll={{ x: "max-content" }}
        size="small"
      />
      {importOpen ? (
        <MaterialImportDialog
          nextId={1}
          onCancel={() => setImportOpen(false)}
          onImported={(imported) => {
            const tag = imported[0]?.tag
            if (tag === undefined) return
            void pool
              .importLines(
                tag,
                imported.map((item) => item.content),
              )
              .then(async (count) => {
                await reload()
                message.success(`导入成功！共导入 ${count} 条素材`)
                setImportOpen(false)
              })
              .catch((error: unknown) => {
                message.error(error instanceof Error ? error.message : "保存失败")
              })
          }}
        />
      ) : null}
      {batchDeleteOpen ? (
        <BatchDeleteDialog
          onCancel={() => setBatchDeleteOpen(false)}
          onDeleteAll={() => {
            void pool
              .deleteScope()
              .then(async (count) => {
                setSelectedIds([])
                await reload()
                message.success(`删除成功！共删除 ${count} 条素材`)
                setBatchDeleteOpen(false)
              })
              .catch((error: unknown) => {
                message.error(error instanceof Error ? error.message : "保存失败")
              })
          }}
          onDeleteByTag={(tag) => {
            void pool
              .deleteScope(tag)
              .then(async (count) => {
                setSelectedIds([])
                await reload()
                message.success(`删除成功！共删除 ${count} 条素材`)
                setBatchDeleteOpen(false)
              })
              .catch((error: unknown) => {
                message.error(error instanceof Error ? error.message : "保存失败")
              })
          }}
          tags={tags}
        />
      ) : null}
      {statisticsOpen ? (
        <MaterialStatisticsDialog onCancel={() => setStatisticsOpen(false)} rows={statistics} />
      ) : null}
      {assignOpen ? (
        <TextTagAssignDialog
          onCancel={() => setAssignOpen(false)}
          onSubmit={(names) => {
            void pool
              .assignTags(selectedIds, names)
              .then(async (count) => {
                labelsChanged()
                setSelectedIds([])
                await reload()
                message.success(`已分配 ${count} 条`)
                setAssignOpen(false)
              })
              .catch((error: unknown) => {
                message.error(error instanceof Error ? error.message : "保存失败")
              })
          }}
          open
          options={tags.map((tag) => ({ label: tag, value: tag }))}
          selectedCount={selected.length}
        />
      ) : null}
      {editRecord === null ? null : (
        <MaterialFormDialog
          onCancel={() => setEditRecord(null)}
          onSubmit={(item) => {
            void pool
              .update(item)
              .then(async () => {
                await reload()
                message.success("修改成功")
                setEditRecord(null)
              })
              .catch((error: unknown) => {
                message.error(error instanceof Error ? error.message : "保存失败")
              })
          }}
          record={editRecord}
        />
      )}
    </section>
  )
}
