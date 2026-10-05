import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from "@ant-design/icons"
import { App, AutoComplete, Button, Card, Input, Modal, Select, Space, Table, Tag } from "antd"
import type { Key } from "react"
import { type ReactNode, useMemo, useState } from "react"

import { ResourceFormDialog } from "./resource-form-dialog"
import "./registration-resources.css"
import { SmartImportDialog } from "./smart-import-dialog"
import { StatisticsDialog } from "./statistics-dialog"
import {
  availableTagCounts,
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

export const RegistrationResourceListPage = ({
  canDelete,
  canWrite,
}: RegistrationResourceListPageProps): ReactNode => {
  const allowDelete = canDelete === true
  const { message, modal } = App.useApp()
  const [draft, setDraft] = useState<ResourceQuery>(emptyResourceQuery)
  const [query, setQuery] = useState<ResourceQuery>(emptyResourceQuery)
  const [resources, setResources] = useState<TkRegResource[]>(() => createSeedResources())
  const [selectedIds, setSelectedIds] = useState<readonly number[]>([])
  const [editRecord, setEditRecord] = useState<TkRegResource | null>(null)
  const [smartImportOpen, setSmartImportOpen] = useState(false)
  const [statisticsOpen, setStatisticsOpen] = useState(false)
  const [detailItems, setDetailItems] = useState<readonly ParsedDataSummaryItem[] | null>(null)

  const filtered = useMemo(() => filterResources(resources, query), [query, resources])
  const selected = resources.filter((resource) => selectedIds.includes(resource.id))
  const tagOptions = availableTagCounts(resources).map((item) => ({
    label: `${item.tag}(${item.count})`,
    value: item.tag,
  }))
  const statistics = resourceStatistics(resources)
  const nextId = Math.max(0, ...resources.map((resource) => resource.id)) + 1

  const applyQuery = (next = draft): void => {
    setDraft(next)
    setQuery(next)
    setSelectedIds([])
  }

  const resetQuery = (): void => {
    const empty = emptyResourceQuery()
    setDraft(empty)
    setQuery(empty)
    setSelectedIds([])
  }

  const changeSelectQuery = (patch: Partial<ResourceQuery>): void => {
    const next = { ...draft, ...patch }
    setDraft(next)
    setQuery(next)
    setSelectedIds([])
  }

  const deleteIds = (ids: readonly number[]): void => {
    const idSet = new Set(ids)
    setResources((current) => current.filter((resource) => !idSet.has(resource.id)))
    setSelectedIds((current) => current.filter((id) => !idSet.has(id)))
  }

  const deleteSelected = (): void => {
    if (selected.length === 0) return
    void modal.confirm({
      cancelText: "取消",
      content: `确认删除选中的 ${selected.length} 条注册池数据吗？`,
      okText: "确定",
      onOk: () => {
        deleteIds(selectedIds)
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
      onOk: () => {
        deleteIds([resource.id])
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
      onOk: () => {
        const ids = new Set(selectedIds)
        setResources((current) =>
          current.map((resource) =>
            ids.has(resource.id) ? { ...resource, status: "0" } : resource,
          ),
        )
        message.success(`重置成功,共重置${selected.length}个账号`)
        setSelectedIds([])
      },
      title: "提示",
    })
  }

  const submitEdit = (resource: TkRegResource): void => {
    setResources((current) => current.map((item) => (item.id === resource.id ? resource : item)))
    message.success("修改成功")
    setEditRecord(null)
  }

  const importResources = (imported: readonly TkRegResource[]): void => {
    if (imported[0]?.tag.includes("+")) {
      message.error("分组名称不能包含 + 符号")
      return
    }
    setResources((current) => [...imported, ...current])
    message.success(`智能导入成功，共导入${imported.length}条数据`)
    setSmartImportOpen(false)
  }

  const deleteUsedByTags = (tags: readonly string[]): void => {
    const tagSet = new Set(tags)
    const removed = resources.filter(
      (resource) => tagSet.has(resourceTagKey(resource)) && resource.status === "1",
    ).length
    setResources((current) =>
      current.filter(
        (resource) => !(tagSet.has(resourceTagKey(resource)) && resource.status === "1"),
      ),
    )
    message.success(`已删除${removed}条已使用数据`)
  }

  const deleteAllByTags = (tags: readonly string[]): void => {
    const tagSet = new Set(tags)
    const removed = resources.filter((resource) => tagSet.has(resourceTagKey(resource))).length
    setResources((current) => current.filter((resource) => !tagSet.has(resourceTagKey(resource))))
    message.success(`已删除${removed}条数据`)
  }

  return (
    <section className="module-page registration-resources-page">
      <Card className="filter-bar" size="small">
        <Space className="resource-filter-row" wrap>
          <span className="filter-label">搜索</span>
          <Input
            allowClear
            aria-label="搜索"
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="搜索"
            style={{ width: 185 }}
            value={draft.email}
          />
          <span className="filter-label">备注</span>
          <Input
            allowClear
            aria-label="备注筛选"
            onChange={(event) => setDraft({ ...draft, remark: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="备注"
            style={{ width: 185 }}
            value={draft.remark}
          />
          <span className="filter-label">标签</span>
          <AutoComplete
            allowClear
            aria-label="标签"
            onChange={(value: string) => changeSelectQuery({ tag: value ?? "" })}
            options={tagOptions}
            placeholder="请选择"
            style={{ width: 185 }}
            value={draft.tag}
          />
          <span className="filter-label">状态</span>
          <Select
            allowClear
            aria-label="状态"
            onChange={(value: ResourceQuery["status"] | null) =>
              changeSelectQuery({ status: value ?? "" })
            }
            options={[
              { label: "未使用", value: "0" },
              { label: "已使用", value: "1" },
            ]}
            placeholder="状态"
            style={{ width: 90 }}
            value={draft.status.length === 0 ? null : draft.status}
            virtual={false}
          />
          <span className="filter-label">结果</span>
          <Select
            allowClear
            aria-label="结果"
            onChange={(value: ResourceQuery["result"] | null) =>
              changeSelectQuery({ result: value ?? "" })
            }
            options={[
              { label: "未知", value: "0" },
              { label: "成功", value: "1" },
            ]}
            placeholder="状态"
            style={{ width: 90 }}
            value={draft.result.length === 0 ? null : draft.result}
            virtual={false}
          />
          <Button icon={<SearchOutlined aria-hidden />} onClick={() => applyQuery()} type="primary">
            搜索
          </Button>
          <Button onClick={resetQuery}>重置</Button>
        </Space>
      </Card>
      <div className="resource-crud-toolbar">
        <Space wrap>
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
          {canWrite ? (
            <Button
              icon={<UploadOutlined aria-hidden />}
              onClick={() => message.warning("此功能已停用，请使用智能导入")}
              type="primary"
            >
              导入资源
            </Button>
          ) : null}
          <Button
            icon={<ThunderboltOutlined aria-hidden />}
            onClick={() => setSmartImportOpen(true)}
            type="primary"
          >
            智能导入
          </Button>
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
          {
            key: "index",
            render: (_value: unknown, _resource: TkRegResource, index: number) => index + 1,
            title: "#",
            width: 55,
          },
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
              resource.tag.length === 0 ? (
                "-"
              ) : (
                <Tag
                  className="resource-tag"
                  onClick={() => void copyText(resource.tag, () => message.success("复制成功"))}
                  title={resource.tag}
                >
                  {resource.tag}
                </Tag>
              ),
            title: "分组",
            width: 120,
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
            dataIndex: "remark",
            ellipsis: true,
            key: "remark",
            render: (remark: string) => (remark.length === 0 ? "-" : remark),
            title: "备注",
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
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
        }}
        rowKey="id"
        rowSelection={{
          getCheckboxProps: (resource: TkRegResource) => ({
            "aria-label": `选择 ${resource.email}`,
          }),
          onChange: (keys: readonly Key[]) => setSelectedIds(keys.map((key) => Number(key))),
          selectedRowKeys: [...selectedIds],
        }}
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
    </section>
  )
}
