import { Button, Table, type TableColumnsType, Tag } from "antd"
import { FilteredSelectCheckbox } from "../../components/tables/filtered-selection"
import type { ReactNode } from "react"

import type { ManagedPage, ManagedRecord } from "./api"

type StatusOption = { readonly label: string; readonly value: string }

type Props = {
  readonly canWrite: boolean
  readonly identityTitle: string
  readonly nameTitle: string
  readonly onEdit: (record: ManagedRecord) => void
  readonly onPageChange: (page: number) => void
  readonly onSelectAll: () => void
  readonly onSelectedChange: (ids: ReadonlySet<string>) => void
  readonly selectingAll?: boolean
  readonly page: ManagedPage
  readonly selectedIds: ReadonlySet<string>
  readonly statusOptions: readonly StatusOption[]
  readonly statusTitle: string
  readonly title: string
}

const identity = (record: ManagedRecord): string =>
  record.identifier ?? record.endpoint ?? record.category ?? "—"

const credentialState = (record: ManagedRecord): string =>
  record.credentialState === undefined
    ? "—"
    : record.credentialState === "configured"
      ? "已配置"
      : "未配置"

const statusLabel = (status: string, options: readonly StatusOption[]): string =>
  options.find((option) => option.value === status)?.label ?? status

export const ManagementTable = ({
  canWrite,
  identityTitle,
  nameTitle,
  onEdit,
  onPageChange,
  onSelectAll,
  onSelectedChange,
  selectingAll = false,
  page,
  selectedIds,
  statusOptions,
  statusTitle,
  title,
}: Props): ReactNode => {
  const columns: TableColumnsType<ManagedRecord> = [
    { dataIndex: "name", ellipsis: true, key: "name", title: nameTitle },
    {
      ellipsis: true,
      key: "identity",
      render: (_value: unknown, item: ManagedRecord) => identity(item),
      title: identityTitle,
    },
    {
      dataIndex: "status",
      key: "status",
      render: (status: string) => (
        <Tag className={`status-tag status-${status}`}>{statusLabel(status, statusOptions)}</Tag>
      ),
      title: statusTitle,
    },
    {
      key: "tags",
      render: (_value: unknown, item: ManagedRecord) =>
        item.tags.length === 0 ? "—" : item.tags.map((tag) => <Tag key={tag}>{tag}</Tag>),
      title: "分组",
    },
    {
      key: "credential",
      render: (_value: unknown, item: ManagedRecord) => credentialState(item),
      title: "凭证",
    },
    {
      ellipsis: true,
      key: "note",
      render: (_value: unknown, item: ManagedRecord) => (item.note.length === 0 ? "—" : item.note),
      title: "备注",
    },
    {
      key: "updatedAt",
      render: (_value: unknown, item: ManagedRecord) => item.updatedAt.toLocaleString("zh-CN"),
      title: "更新时间",
      width: 180,
    },
  ]
  if (canWrite) {
    columns.push({
      align: "center",
      fixed: "right",
      key: "actions",
      render: (_value: unknown, item: ManagedRecord) => (
        <Button onClick={() => onEdit(item)} type="link">
          编辑
        </Button>
      ),
      title: "操作",
      width: 80,
    })
  }
  return (
    <Table
      columns={columns}
      dataSource={[...page.items]}
      locale={{ emptyText: `暂无${title}数据` }}
      pagination={{
        current: page.page,
        onChange: onPageChange,
        pageSize: page.pageSize,
        showSizeChanger: false,
        showTotal: (total) => `共 ${total} 条`,
        total: page.total,
      }}
      rowKey="id"
      {...(canWrite
        ? {
            rowSelection: {
              columnTitle: (
                <FilteredSelectCheckbox
                  busy={selectingAll}
                  filteredCount={page.total}
                  onClear={() => onSelectedChange(new Set())}
                  onSelectAll={onSelectAll}
                  selectedCount={selectedIds.size}
                />
              ),
              getCheckboxProps: (item: ManagedRecord) => ({
                "aria-label": `选择 ${item.name}`,
              }),
              onChange: (keys, _rows, info) => {
                if (info.type === "all" || info.type === "none") return
                onSelectedChange(new Set(keys.map((key) => String(key))))
              },
              preserveSelectedRowKeys: true,
              selectedRowKeys: [...selectedIds],
            },
          }
        : {})}
      scroll={{ x: "max-content" }}
      size="middle"
    />
  )
}
