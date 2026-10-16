import { DeleteOutlined, EditOutlined, SearchOutlined, UploadOutlined } from "@ant-design/icons"
import { App, Button, Card, Space, Table } from "antd"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { useFilteredRowSelection } from "../../components/tables/filtered-selection"

import { createTextPoolApi, type TextPoolApi } from "./api"
import { BatchDeleteDialog } from "./batch-delete-dialog"
import { MaterialFormDialog } from "./form-dialog"
import { MaterialImportDialog } from "./import-dialog"
import {
  createSeedMaterials,
  emptyMaterialQuery,
  filterMaterials,
  type MaterialQuery,
  type MytMaterial,
  materialStatistics,
  uniqueTags,
} from "./myt-material"
import "./resources.css"
import { PageKey } from "../../lib/pages"
import { BusinessLabelFilter, UNASSIGNED_VALUE, usageLabel } from "../labels/filter-row"
import { MaterialStatisticsDialog } from "./statistics-dialog"

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
  const [draft, setDraft] = useState<MaterialQuery>(emptyMaterialQuery)
  const [query, setQuery] = useState<MaterialQuery>(emptyMaterialQuery)
  const [materials, setMaterials] = useState<MytMaterial[]>(() => createSeedMaterials())
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])
  const [loading, setLoading] = useState(false)
  const [editRecord, setEditRecord] = useState<MytMaterial | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [statisticsOpen, setStatisticsOpen] = useState(false)

  const filtered = useMemo(() => filterMaterials(materials, query), [materials, query])
  const selected = materials.filter((item) => selectedIds.includes(item.id))
  const tags = uniqueTags(materials)
  const tagCounts = new Map<string, number>()
  for (const item of materials) {
    const tag = item.tag.trim()
    if (tag.length > 0) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  }
  const tagOptions = tags.map((tag) => ({ label: usageLabel(tag, tagCounts.get(tag) ?? 0), value: tag }))
  const statistics = materialStatistics(materials)
  const reload = async (): Promise<void> => {
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
  }

  useEffect(() => {
    void reload()
    // Reload when the saved pool or group changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool])

  const applyQuery = (next = draft): void => {
    setDraft(next)
    setQuery(next)
  }

  const resetQuery = (): void => {
    const empty = emptyMaterialQuery()
    setDraft(empty)
    setQuery(empty)
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
  const materialSelection = useFilteredRowSelection({
    getCheckboxProps: (item: MytMaterial) => ({
      "aria-label": `选择 ${item.content}`,
    }),
    onChange: (keys) => setSelectedIds(keys.map((key) => String(key))),
    rowKey: "id",
    rows: filtered,
    selectedKeys: selectedIds,
  })

  return (
    <section className="module-page resources-page">
      <Card className="filter-bar" size="small">
        <BusinessLabelFilter
          page={PageKey.StudioTextPool}
          title="标签"
          blankLabel={usageLabel(
            "未标签",
            materials.filter((item) => item.tag.trim().length === 0).length,
          )}
          multiple
          options={tagOptions}
          value={draft.untagged ? [UNASSIGNED_VALUE] : draft.tags}
          onChange={(tags) =>
            applyQuery(
              tags.includes(UNASSIGNED_VALUE)
                ? { ...draft, tags: [], untagged: true }
                : { ...draft, tags, untagged: false },
            )
          }
          canWrite={canWrite}
          canDelete={allowDelete}
        />
        <Space className="resource-filter-row" wrap>
          <Button icon={<SearchOutlined aria-hidden />} onClick={() => applyQuery()} type="primary">
            搜索
          </Button>
          <Button onClick={resetQuery}>重置</Button>
        </Space>
      </Card>
      <div className="resource-crud-toolbar">
        <Space wrap>
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
          { dataIndex: "tag", ellipsis: true, key: "tag", title: "标签" },
          { dataIndex: "content", ellipsis: true, key: "content", title: "资源内容" },
          {
            dataIndex: "assignedCount",
            key: "assignedCount",
            title: "已分配次数",
            width: 120,
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
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
        }}
        rowKey="id"
        rowSelection={materialSelection}
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
