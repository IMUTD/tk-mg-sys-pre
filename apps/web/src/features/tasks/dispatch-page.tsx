import { PlayCircleOutlined, PlusOutlined } from "@ant-design/icons"
import { App, Button, Space, Table, type TableColumnsType, Tag } from "antd"
import type { Key, ReactNode } from "react"
import { useEffect, useState } from "react"

import { createDispatchApi, type DispatchAccount, type DispatchRow } from "./dispatch-api"
import { DispatchForm } from "./dispatch-form"

type DispatchPageProps = {
  readonly canWrite: boolean
  readonly groupId: string
}

const statusLabel = (status: string, missing: readonly string[]): string => {
  if (status === "incomplete") return missing.length === 0 ? "参数未齐" : `参数未齐：${missing.join("、")}`
  if (status === "ready") return "待开始"
  if (status === "started") return "已下发"
  return status
}

const statusColor = (status: string): string => {
  if (status === "incomplete") return "error"
  if (status === "ready") return "gold"
  if (status === "started") return "success"
  return "default"
}

export const DispatchListPage = ({ canWrite, groupId }: DispatchPageProps): ReactNode => {
  const { message } = App.useApp()
  const [rows, setRows] = useState<readonly DispatchRow[]>([])
  const [selected, setSelected] = useState<readonly string[]>([])
  const [creating, setCreating] = useState(false)
  const [starting, setStarting] = useState(false)
  const selectedRows = rows.filter((item) => selected.includes(item.id))
  const blocked = selectedRows.some((item) => item.status === "incomplete")

  const reload = async (): Promise<void> => {
    if (groupId.length === 0) return
    try {
      setRows(await createDispatchApi(groupId).list())
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败")
    }
  }

  useEffect(() => {
    void reload()
    // Reload when the group changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  const start = (): void => {
    if (selected.length === 0 || blocked) return
    setStarting(true)
    void createDispatchApi(groupId)
      .start(selected)
      .then(async () => {
        message.success("已开始")
        setSelected([])
        await reload()
      })
      .catch((error: unknown) => {
        message.error(error instanceof Error ? error.message : "保存失败")
      })
      .finally(() => setStarting(false))
  }

  const columns: TableColumnsType<DispatchRow> = [
    { dataIndex: "name", title: "任务", width: 180 },
    {
      render: (_value: unknown, item: DispatchRow) => `${item.accountCount} 个账号`,
      title: "账号",
      width: 120,
    },
    {
      render: (_value: unknown, item: DispatchRow) => (
        <Tag color={statusColor(item.status)}>{statusLabel(item.status, item.missing)}</Tag>
      ),
      title: "状态",
      width: 220,
    },
    { dataIndex: "chainName", title: "行为链", width: 160 },
  ]
  const accountColumns: TableColumnsType<DispatchAccount> = [
    { dataIndex: "identifier", title: "账号" },
    { dataIndex: "note", title: "备注", width: 140 },
    {
      render: (_value: unknown, item: DispatchAccount) => item.deviceName || item.deviceHost || "-",
      title: "盒子",
      width: 180,
    },
    {
      render: (_value: unknown, item: DispatchAccount) => item.instanceIndex ?? "-",
      title: "坑位",
      width: 80,
    },
    {
      render: (_value: unknown, item: DispatchAccount) => item.proxyName || "-",
      title: "代理",
      width: 140,
    },
    {
      render: (_value: unknown, item: DispatchAccount) => (
        <Tag color={statusColor(item.status)}>{statusLabel(item.status, item.missing)}</Tag>
      ),
      title: "状态",
      width: 220,
    },
  ]

  return (
    <section className="module-page tasks-page">
      <div className="resource-crud-toolbar">
        <Space wrap>
          {canWrite ? (
            <Button icon={<PlusOutlined aria-hidden />} onClick={() => setCreating(true)} type="primary">
              新增
            </Button>
          ) : null}
          {canWrite ? (
            <Button
              disabled={selected.length === 0 || blocked}
              icon={<PlayCircleOutlined aria-hidden />}
              loading={starting}
              onClick={start}
              type="primary"
            >
              开始
            </Button>
          ) : null}
        </Space>
      </div>
      <Table
        columns={columns}
        dataSource={[...rows]}
        expandable={{
          expandedRowRender: (item: DispatchRow) => (
            <Table
              columns={accountColumns}
              dataSource={[...item.accounts]}
              pagination={false}
              rowKey="id"
              size="small"
            />
          ),
        }}
        pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }}
        rowKey="id"
        rowSelection={{
          onChange: (keys: readonly Key[]) => setSelected(keys.map((key) => String(key))),
          selectedRowKeys: [...selected],
        }}
        size="small"
      />
      {creating ? (
        <DispatchForm
          groupId={groupId}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            void reload()
          }}
        />
      ) : null}
    </section>
  )
}
