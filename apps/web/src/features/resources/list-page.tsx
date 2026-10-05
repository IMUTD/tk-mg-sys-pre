import { DeleteOutlined, EditOutlined, SearchOutlined, UploadOutlined } from "@ant-design/icons"
import { App, AutoComplete, Button, Card, Space, Table } from "antd"
import type { Key } from "react"
import { type ReactNode, useMemo, useState } from "react"

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
import { MaterialStatisticsDialog } from "./statistics-dialog"

type ResourcesListPageProps = {
  readonly canDelete?: boolean
  readonly canWrite: boolean
}

export const ResourcesListPage = ({ canDelete, canWrite }: ResourcesListPageProps): ReactNode => {
  const allowDelete = canDelete === true
  const { message, modal } = App.useApp()
  const [draft, setDraft] = useState<MaterialQuery>(emptyMaterialQuery)
  const [query, setQuery] = useState<MaterialQuery>(emptyMaterialQuery)
  const [materials, setMaterials] = useState<MytMaterial[]>(() => createSeedMaterials())
  const [selectedIds, setSelectedIds] = useState<readonly number[]>([])
  const [editRecord, setEditRecord] = useState<MytMaterial | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [statisticsOpen, setStatisticsOpen] = useState(false)

  const filtered = useMemo(() => filterMaterials(materials, query), [materials, query])
  const selected = materials.filter((item) => selectedIds.includes(item.id))
  const tags = uniqueTags(materials)
  const tagOptions = tags.map((tag) => ({ label: tag, value: tag }))
  const statistics = materialStatistics(materials)
  const nextId = Math.max(0, ...materials.map((item) => item.id)) + 1

  const applyQuery = (next = draft): void => {
    setDraft(next)
    setQuery(next)
    setSelectedIds([])
  }

  const resetQuery = (): void => {
    const empty = emptyMaterialQuery()
    setDraft(empty)
    setQuery(empty)
    setSelectedIds([])
  }

  const deleteIds = (ids: readonly number[]): void => {
    const idSet = new Set(ids)
    setMaterials((current) => current.filter((item) => !idSet.has(item.id)))
    setSelectedIds((current) => current.filter((id) => !idSet.has(id)))
  }

  const deleteSelected = (): void => {
    if (selected.length === 0) return
    void modal.confirm({
      cancelText: "取消",
      content: `确认删除选中的 ${selected.length} 条素材吗？`,
      okText: "确定",
      onOk: () => {
        deleteIds(selectedIds)
        message.success("删除成功")
      },
      title: "提示",
    })
  }

  const deleteOne = (item: MytMaterial): void => {
    void modal.confirm({
      cancelText: "取消",
      content: "确定删除吗？",
      okText: "确定",
      onOk: () => {
        deleteIds([item.id])
        message.success("删除成功")
      },
      title: "提示",
    })
  }

  const openEditSelected = (): void => {
    if (selected.length !== 1) return
    const record = selected[0]
    if (record === undefined) return
    setEditRecord(record)
  }

  return (
    <section className="module-page resources-page">
      <Card className="filter-bar" size="small">
        <Space className="resource-filter-row" wrap>
          <span className="filter-label">标签</span>
          <AutoComplete
            allowClear
            aria-label="标签"
            onChange={(value: string) => applyQuery({ tag: value ?? "" })}
            options={tagOptions}
            placeholder="请选择或输入标签"
            style={{ width: 185 }}
            value={draft.tag}
          />
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
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
        }}
        rowKey="id"
        rowSelection={{
          getCheckboxProps: (item: MytMaterial) => ({
            "aria-label": `选择 ${item.content}`,
          }),
          onChange: (keys: readonly Key[]) => setSelectedIds(keys.map((key) => Number(key))),
          selectedRowKeys: [...selectedIds],
        }}
        scroll={{ x: "max-content" }}
        size="small"
      />
      {importOpen ? (
        <MaterialImportDialog
          nextId={nextId}
          onCancel={() => setImportOpen(false)}
          onImported={(imported) => {
            setMaterials((current) => [...imported, ...current])
            message.success(`导入成功！共导入 ${imported.length} 条素材`)
            setImportOpen(false)
          }}
        />
      ) : null}
      {batchDeleteOpen ? (
        <BatchDeleteDialog
          onCancel={() => setBatchDeleteOpen(false)}
          onDeleteAll={() => {
            const count = materials.length
            setMaterials([])
            setSelectedIds([])
            message.success(`删除成功！共删除 ${count} 条素材`)
            setBatchDeleteOpen(false)
          }}
          onDeleteByTag={(tag) => {
            const removed = materials.filter((item) => item.tag === tag).length
            setMaterials((current) => current.filter((item) => item.tag !== tag))
            setSelectedIds([])
            message.success(`删除成功！共删除 ${removed} 条素材`)
            setBatchDeleteOpen(false)
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
            setMaterials((current) => current.map((row) => (row.id === item.id ? item : row)))
            message.success("修改成功")
            setEditRecord(null)
          }}
          record={editRecord}
        />
      )}
    </section>
  )
}
