import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons"
import type { TableColumnsType } from "antd"
import { App, Button, Card, Input, Space, Switch, Table, Tag } from "antd"
import type { Key } from "react"
import { type ReactNode, useMemo, useState } from "react"

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
  const [query, setQuery] = useState<ConfigQuery>(emptyConfigQuery)
  const [configs, setConfigs] = useState<MytConfig[]>(() => createSeedConfigs())
  const [selectedIds, setSelectedIds] = useState<readonly number[]>([])
  const [editRecord, setEditRecord] = useState<MytConfig | null>(null)
  const filtered = useMemo(() => filterConfigs(configs, query), [configs, query])
  const selected = configs.filter((item) => selectedIds.includes(item.id))
  const nextId = Math.max(0, ...configs.map((item) => item.id)) + 1

  const applyQuery = (next = draft): void => {
    setDraft(next)
    setQuery(next)
    setSelectedIds([])
  }

  const resetQuery = (): void => {
    const empty = emptyConfigQuery()
    setDraft(empty)
    setQuery(empty)
    setSelectedIds([])
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
    { dataIndex: "remark", ellipsis: true, key: "remark", title: "备注", width: 140 },
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

  return (
    <section className="module-page config-page">
      <Card className="filter-bar" size="small">
        <Space className="resource-filter-row" wrap>
          <span className="filter-label">名称</span>
          <Input
            allowClear
            aria-label="名称"
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="名称"
            style={{ width: 185 }}
            value={draft.name}
          />
          <span className="filter-label">key</span>
          <Input
            allowClear
            aria-label="key"
            onChange={(event) => setDraft({ ...draft, key: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="key"
            style={{ width: 185 }}
            value={draft.key}
          />
          <span className="filter-label">用户名</span>
          <Input
            allowClear
            aria-label="用户名"
            onChange={(event) => setDraft({ ...draft, username: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="用户名"
            style={{ width: 185 }}
            value={draft.username}
          />
          <span className="filter-label">密码</span>
          <Input
            allowClear
            aria-label="密码筛选"
            onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="密码"
            style={{ width: 185 }}
            type="password"
            value={draft.password}
          />
          <span className="filter-label">备注</span>
          <Input
            allowClear
            aria-label="备注"
            onChange={(event) => setDraft({ ...draft, remark: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="备注"
            style={{ width: 185 }}
            value={draft.remark}
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
        pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
        rowKey="id"
        rowSelection={{
          getCheckboxProps: (item: MytConfig) => ({
            "aria-label": `选择 ${item.name}`,
          }),
          onChange: (keys: readonly Key[]) => setSelectedIds(keys.map((key) => Number(key))),
          selectedRowKeys: [...selectedIds],
        }}
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
