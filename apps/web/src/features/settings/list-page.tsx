import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons"
import type { TableColumnsType } from "antd"
import { App, Button, Card, Input, Space, Switch, Table, Tag } from "antd"
import { type ReactNode, useMemo, useState } from "react"
import { useFilteredRowSelection } from "../../components/tables/filtered-selection"
import {
  type FilterMode,
  type SelectionScope,
  FilterModeSwitch,
  SelectionScopeSwitch,
  pageSlice,
  useClientPagination,
} from "../../components/tables/operation-controls"
import { EditableTextTag } from "../labels/editable-text-tag"

import { ConfigFormDialog } from "./form-dialog"
import {
  type ConfigQuery,
  createSeedConfigs,
  emptyConfig,
  emptyConfigQuery,
  filterConfigs,
  type MytConfig,
  nowText,
} from "./myt-config"
import "./config.css"

type ConfigListPageProps = {
  readonly canDelete?: boolean
  readonly canWrite: boolean
}

const copyText = async (value: string, onSuccess: () => void): Promise<void> => {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    /* jsdom and restricted clipboard still show success like 云大师 */
  }
  onSuccess()
}

export const ConfigListPage = ({ canDelete, canWrite }: ConfigListPageProps): ReactNode => {
  const allowDelete = canDelete === true
  const { message, modal } = App.useApp()
  const [draft, setDraft] = useState<ConfigQuery>(emptyConfigQuery)
  const [filterMode, setFilterMode] = useState<FilterMode>("and")
  const [selectionScope, setSelectionScope] = useState<SelectionScope>("all")
  const [query, setQuery] = useState<ConfigQuery>(emptyConfigQuery)
  const [configs, setConfigs] = useState<MytConfig[]>(() => createSeedConfigs())
  const [selectedIds, setSelectedIds] = useState<readonly number[]>([])
  const [editRecord, setEditRecord] = useState<MytConfig | null>(null)
  const filtered = useMemo(
    () => filterConfigs(configs, query, filterMode),
    [configs, filterMode, query],
  )
  const configPaging = useClientPagination(JSON.stringify([filterMode, query]))
  const selected = configs.filter((item) => selectedIds.includes(item.id))
  const nextId = Math.max(0, ...configs.map((item) => item.id)) + 1

  const changeQuery = (patch: Partial<ConfigQuery>): void => {
    const next = { ...draft, ...patch }
    setDraft(next)
    setQuery(next)
  }

  const resetQuery = (): void => {
    const empty = emptyConfigQuery()
    setDraft(empty)
    setQuery(empty)
  }

  const deleteIds = (ids: readonly number[]): void => {
    const idSet = new Set(ids)
    setConfigs((current) => current.filter((item) => !idSet.has(item.id)))
    setSelectedIds((current) => current.filter((id) => !ids.includes(id)))
  }

  const confirmDelete = (ids: readonly number[]): void => {
    if (ids.length === 0) return
    void modal.confirm({
      cancelText: "取消",
      content: ids.length === 1 ? "确定删除吗？" : `确认删除选中的 ${ids.length} 条配置吗？`,
      okText: "确定",
      onOk: () => {
        deleteIds(ids)
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

  const copyPassword = (password: string): void => {
    if (password.length === 0) return
    void copyText(password, () => message.success("复制成功"))
  }

  const columns: TableColumnsType<MytConfig> = [
    { dataIndex: "id", key: "id", title: "id", width: 70 },
    { dataIndex: "userId", key: "userId", title: "用户", width: 70 },
    { dataIndex: "name", ellipsis: true, key: "name", title: "名称", width: 160 },
    { dataIndex: "url", ellipsis: true, key: "url", title: "URL" },
    { dataIndex: "username", ellipsis: true, key: "username", title: "用户名", width: 140 },
    {
      key: "password",
      render: (_value: unknown, item: MytConfig) => (
        <Tag
          onClick={() => copyPassword(item.password)}
          style={{ cursor: item.password.length > 0 ? "pointer" : "default" }}
        >
          {item.password.length > 0 ? "复制密码" : "无密码"}
        </Tag>
      ),
      title: "密码",
      width: 100,
    },
    { dataIndex: "extra", ellipsis: true, key: "extra", title: "额外参数", width: 160 },
    {
      align: "center",
      key: "enable",
      render: (_value: unknown, item: MytConfig) => (
        <Switch aria-label={`${item.name}启用`} checked={item.enable} disabled size="small" />
      ),
      title: "启用",
      width: 80,
    },
    {
      key: "remark",
      render: (_value: unknown, item: MytConfig) =>
        canWrite ? (
          <EditableTextTag
            color="blue"
            emptyLabel="备注"
            name={item.remark.length === 0 ? null : item.remark}
            onCommit={(name) =>
              setConfigs((current) =>
                current.map((entry) => (entry.id === item.id ? { ...entry, remark: name } : entry)),
              )
            }
            onRemove={() =>
              setConfigs((current) =>
                current.map((entry) => (entry.id === item.id ? { ...entry, remark: "" } : entry)),
              )
            }
            removeLabel={`移除备注 ${item.remark}`}
          />
        ) : (
          item.remark
        ),
      title: "备注",
      width: 140,
    },
    ...(canWrite
      ? [
          {
            align: "center" as const,
            fixed: "right" as const,
            key: "actions",
            render: (_value: unknown, item: MytConfig) => (
              <Space size={0}>
                <Button
                  icon={<EditOutlined aria-hidden />}
                  onClick={() => setEditRecord(item)}
                  size="small"
                  type="link"
                >
                  编辑
                </Button>
                {allowDelete ? (
                  <Button danger onClick={() => confirmDelete([item.id])} size="small" type="link">
                    删除
                  </Button>
                ) : null}
              </Space>
            ),
            title: "操作",
            width: 140,
          },
        ]
      : []),
  ]
  const configSelection = useFilteredRowSelection({
    getCheckboxProps: (item: MytConfig) => ({
      "aria-label": `选择 ${item.name}`,
    }),
    onChange: (keys) => setSelectedIds(keys.map((key) => Number(key))),
    pageKeys: pageSlice(filtered, configPaging.current, configPaging.pageSize).map((item) => item.id),
    rowKey: "id",
    rows: filtered,
    selectedKeys: selectedIds,
    selectionScope,
  })

  return (
    <section className="module-page config-page">
      <Card className="condition-panel filter-bar" size="small">
        <div className="condition-search">
          <span className="filter-label">搜索</span>
          <Input
            allowClear
            aria-label="名称"
            onChange={(event) => changeQuery({ name: event.target.value })}
            placeholder="名称"
            style={{ width: 185 }}
            value={draft.name}
          />
          <Input
            allowClear
            aria-label="key"
            onChange={(event) => changeQuery({ key: event.target.value })}
            placeholder="key"
            style={{ width: 185 }}
            value={draft.key}
          />
          <Input
            allowClear
            aria-label="用户名"
            onChange={(event) => changeQuery({ username: event.target.value })}
            placeholder="用户名"
            style={{ width: 185 }}
            value={draft.username}
          />
          <Input
            allowClear
            aria-label="密码筛选"
            onChange={(event) => changeQuery({ password: event.target.value })}
            placeholder="密码"
            style={{ width: 185 }}
            type="password"
            value={draft.password}
          />
          <Input
            allowClear
            aria-label="备注"
            onChange={(event) => changeQuery({ remark: event.target.value })}
            placeholder="备注"
            style={{ width: 185 }}
            value={draft.remark}
          />
          <Button onClick={resetQuery}>重置</Button>
          <FilterModeSwitch mode={filterMode} onChange={setFilterMode} />
        </div>
      </Card>
      <div className="resource-crud-toolbar">
        <Space wrap>
          <SelectionScopeSwitch onChange={setSelectionScope} scope={selectionScope} />
          {canWrite ? (
            <>
              <Button
                icon={<PlusOutlined aria-hidden />}
                onClick={() => setEditRecord(emptyConfig(0, nowText()))}
                type="primary"
              >
                新增
              </Button>
              <Button
                disabled={selected.length !== 1}
                icon={<EditOutlined aria-hidden />}
                onClick={openEditSelected}
              >
                修改
              </Button>
              {allowDelete ? (
                <Button
                  danger
                  disabled={selected.length === 0}
                  icon={<DeleteOutlined aria-hidden />}
                  onClick={() => confirmDelete(selectedIds)}
                >
                  删除
                </Button>
              ) : null}
            </>
          ) : null}
        </Space>
      </div>
      <Table
        columns={columns}
        dataSource={filtered}
        pagination={{ ...configPaging.pagination, total: filtered.length }}
        rowKey="id"
        rowSelection={configSelection}
        scroll={{ x: "max-content" }}
        size="small"
      />
      {editRecord === null ? null : (
        <ConfigFormDialog
          onCancel={() => setEditRecord(null)}
          onSubmit={(item) => {
            const stamp = nowText()
            if (item.id === 0) {
              setConfigs((current) => [{ ...item, id: nextId, updateTime: stamp }, ...current])
              message.success("新增成功")
            } else {
              setConfigs((current) =>
                current.map((entry) =>
                  entry.id === item.id ? { ...item, updateTime: stamp } : entry,
                ),
              )
              message.success("修改成功")
            }
            setEditRecord(null)
          }}
          record={editRecord}
        />
      )}
    </section>
  )
}
