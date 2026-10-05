import { PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Alert, App, Button, Checkbox, Empty, Input, Modal, Progress, Select, Space, Table, Tag, Typography } from "antd"
import type { ColumnsType } from "antd/es/table"
import { type ReactNode, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

import { hideMiddle, shortDate } from "./myt-device"
import { type BoxLabel, createDevicesApi, type DevicesApi, type OwnedBox } from "./api"
import "./devices.css"

type DeviceListPageProps = {
  readonly api?: DevicesApi
  readonly canDelete?: boolean
  readonly canWrite: boolean
  readonly isAdministrator: boolean
}

type LabelFilter = "all" | "none" | string

const displayError = (error: unknown): string =>
  error instanceof Error ? error.message : "盒子数据加载失败"

const modelLabel = (model: string): string => {
  const value = model.toLowerCase()
  if (value.includes("q1")) return "Q1"
  if (value.includes("p1")) return "P1"
  return model.length === 0 ? "-" : model
}

const diskParts = (disk: string): { readonly total: string; readonly used: string } | null => {
  const [used, total] = disk.split("/").map((part) => part.trim())
  if (used === undefined || total === undefined || total.length === 0) return null
  return { total, used }
}

const matchesLabel = (filter: LabelFilter, id: string | null): boolean => {
  if (filter === "all") return true
  if (filter === "none") return id === null
  return id === filter
}

export const DeviceListPage = ({
  api = createDevicesApi(),
  canDelete,
  canWrite: _canWrite,
  isAdministrator: _isAdministrator,
}: DeviceListPageProps): ReactNode => {
  void canDelete
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [keyword, setKeyword] = useState("")
  const [version, setVersion] = useState("")
  const [enabled, setEnabled] = useState<"all" | "on" | "off">("all")
  const [remarkFilter, setRemarkFilter] = useState<LabelFilter>("all")
  const [groupFilter, setGroupFilter] = useState<LabelFilter>("all")
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [addKind, setAddKind] = useState<"remark" | "group" | null>(null)
  const [addName, setAddName] = useState("")
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchRemark, setBatchRemark] = useState("keep")
  const [batchGroup, setBatchGroup] = useState("keep")
  const boxes = useQuery({
    queryFn: () => api.owned(),
    queryKey: ["owned-boxes"],
    refetchInterval: 15_000,
    staleTime: 0,
  })
  const labels = useQuery({
    queryFn: () => api.labels(),
    queryKey: ["box-labels"],
    staleTime: 0,
  })

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["owned-boxes"] })
    await queryClient.invalidateQueries({ queryKey: ["box-labels"] })
  }

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const area = document.createElement("textarea")
      area.value = value
      document.body.append(area)
      area.select()
      document.execCommand("copy")
      area.remove()
    }
    message.success("已复制")
  }

  const remarks = labels.data?.remarks ?? []
  const groups = labels.data?.groups ?? []

  const rows = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    const versionText = version.trim().toLowerCase()
    return (boxes.data ?? []).filter((box) => {
      if (!matchesLabel(remarkFilter, box.remarkId)) return false
      if (!matchesLabel(groupFilter, box.boxGroupId)) return false
      if (enabled === "on" && !box.enabled) return false
      if (enabled === "off" && box.enabled) return false
      if (versionText.length > 0) {
        const haystack = `${box.version ?? ""} ${box.firmware}`.toLowerCase()
        if (!haystack.includes(versionText)) return false
      }
      if (text.length === 0) return true
      return [box.remarkName ?? "", box.boxGroupName ?? "", box.host, box.externalId].some((value) =>
        value.toLowerCase().includes(text),
      )
    })
  }, [boxes.data, enabled, groupFilter, keyword, remarkFilter, version])

  const filteredIds = rows.map((box) => box.id)
  const selectedFiltered = filteredIds.filter((id) => selected.has(id)).length
  const allFilteredSelected = filteredIds.length > 0 && selectedFiltered === filteredIds.length

  const toggleFiltered = () => {
    setSelected((current) => {
      const next = new Set(current)
      if (allFilteredSelected) {
        for (const id of filteredIds) next.delete(id)
      } else {
        for (const id of filteredIds) next.add(id)
      }
      return next
    })
  }

  const toggleOne = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const saveLabel = async () => {
    const name = addName.trim()
    if (addKind === null || name === "") return
    try {
      if (addKind === "remark") await api.createRemark(name)
      else await api.createBoxGroup(name)
      setAddKind(null)
      setAddName("")
      await refresh()
    } catch (error) {
      message.error(displayError(error))
    }
  }

  const removeCatalog = async (kind: "remark" | "group", item: BoxLabel) => {
    try {
      if (kind === "remark") await api.deleteRemark(item.id)
      else await api.deleteBoxGroup(item.id)
      if (kind === "remark" && remarkFilter === item.id) setRemarkFilter("all")
      if (kind === "group" && groupFilter === item.id) setGroupFilter("all")
      await refresh()
    } catch (error) {
      message.error(displayError(error))
    }
  }

  const clearOnBox = async (box: OwnedBox, kind: "remark" | "group") => {
    await api.assignLabels(
      kind === "remark" ? { deviceIds: [box.id], remarkId: null } : { deviceIds: [box.id], boxGroupId: null },
    )
    await refresh()
  }

  const applyBatch = async () => {
    const deviceIds = [...selected]
    const input: { boxGroupId?: string | null; deviceIds: string[]; remarkId?: string | null } = { deviceIds }
    if (batchRemark === "clear") input.remarkId = null
    else if (batchRemark !== "keep") input.remarkId = batchRemark
    if (batchGroup === "clear") input.boxGroupId = null
    else if (batchGroup !== "keep") input.boxGroupId = batchGroup
    if (input.remarkId === undefined && input.boxGroupId === undefined) {
      setBatchOpen(false)
      return
    }
    try {
      await api.assignLabels(input)
      setBatchOpen(false)
      setBatchRemark("keep")
      setBatchGroup("keep")
      message.success("已分配")
      await refresh()
    } catch (error) {
      message.error(displayError(error))
    }
  }

  const labelMark = (kind: "remark" | "group", name: string | null, clearLabel: string, onClear: () => void) =>
    name === null || name.length === 0 ? null : (
      <Tag
        closable
        closeIcon={<span aria-label={clearLabel}>×</span>}
        color={kind === "remark" ? "blue" : "orange"}
        onClose={(event) => {
          event.preventDefault()
          void onClear()
        }}
      >
        {name}
      </Tag>
    )

  const columns: ColumnsType<OwnedBox> = [
    {
      title: (
        <Checkbox
          aria-label="全选筛选后的盒子"
          checked={allFilteredSelected}
          disabled={filteredIds.length === 0}
          indeterminate={selectedFiltered > 0 && !allFilteredSelected}
          onChange={toggleFiltered}
        />
      ),
      width: 48,
      render: (_value, box) => (
        <Checkbox aria-label={`选择 ${box.host}`} checked={selected.has(box.id)} onChange={() => toggleOne(box.id)} />
      ),
    },
    {
      dataIndex: "externalId",
      title: "序列号/IP",
      width: 230,
      render: (_value, box) => (
        <div className="serial-ip-cell">
          <Tag className="mono-tag" onClick={() => void copyText(box.externalId)}>
            {hideMiddle(box.externalId)}
          </Tag>
          <Tag className="mono-tag" color="success" onClick={() => void copyText(box.host)}>
            {box.host}
          </Tag>
        </div>
      ),
    },
    {
      title: "备注/分组",
      width: 220,
      render: (_value, box) => {
        const remark = labelMark("remark", box.remarkName, `清除 ${box.host} 的备注`, () => clearOnBox(box, "remark"))
        const group = labelMark("group", box.boxGroupName, `清除 ${box.host} 的分组`, () => clearOnBox(box, "group"))
        return (
          <div className="meta-cell">
            <div className="box-label-pair">
              {remark}
              {group}
              {remark === null && group === null ? <span className="muted">-</span> : null}
            </div>
            <div>
              <Tag color={box.status === "online" ? "success" : box.status === "offline" ? "error" : "default"}>
                {box.status === "online" ? "在线" : box.status === "offline" ? "离线" : "未知"}
              </Tag>
            </div>
          </div>
        )
      },
    },
    {
      align: "center",
      title: "型号",
      width: 80,
      render: (_value, box) => (
        <Tag color={modelLabel(box.model) === "P1" ? "success" : "processing"}>{modelLabel(box.model)}</Tag>
      ),
    },
    {
      title: "版本号",
      width: 180,
      render: (_value, box) => (
        <div>
          <Tag>{box.version && box.version.length > 0 ? box.version : "-"}</Tag>
          <div className="firmware-version">{box.firmware.length > 0 ? box.firmware : "-"}</div>
        </div>
      ),
    },
    {
      title: "设备资源",
      width: 210,
      render: (_value, box) => {
        const disk = diskParts(box.disk)
        return (
          <div className="meta-cell">
            <div>
              <span className="muted">内存: </span>
              {box.memory.length > 0 ? box.memory : "-"}
            </div>
            <div>
              <span className="muted">硬盘: </span>
              {disk === null ? "-" : `${disk.used} / ${disk.total}`}
            </div>
            {disk === null ? null : (
              <div className="disk-row">
                <Progress
                  percent={box.diskPct}
                  showInfo={false}
                  strokeColor={box.diskPct >= 90 ? "#F56C6C" : box.diskPct >= 70 ? "#E6A23C" : "#67C23A"}
                  strokeWidth={6}
                  style={{ width: 80 }}
                />
                <span>{box.diskPct}%</span>
              </div>
            )}
          </div>
        )
      },
    },
    {
      title: "上报/更新时间",
      width: 170,
      render: (_value, box) => (
        <div className="meta-cell">
          <div>
            <span className="muted">上报: </span>
            {box.lastSeenAt === null ? "-" : shortDate(box.lastSeenAt.toISOString())}
          </div>
          <div>
            <span className="muted">更新: </span>
            {shortDate(box.updatedAt.toISOString())}
          </div>
        </div>
      ),
    },
    {
      align: "center",
      title: "操作",
      width: 90,
      render: (_value, box) => (
        <Button onClick={() => navigate(`/operations/devices/${box.id}/control`)} size="small" type="primary">
          中控
        </Button>
      ),
    },
  ]

  const catalogRow = (kind: "remark" | "group", title: string, items: readonly BoxLabel[], filter: LabelFilter, setFilter: (value: LabelFilter) => void) => (
    <div className={`label-row tone-${kind}`}>
      <span className="label-row-title">{title}</span>
      {items.map((item) => (
        <Tag
          className={filter === item.id ? "label-tag-on" : undefined}
          closable
          color={kind === "remark" ? "blue" : "orange"}
          key={item.id}
          onClick={() => setFilter(filter === item.id ? "all" : item.id)}
          onClose={(event) => {
            event.preventDefault()
            void removeCatalog(kind, item)
          }}
        >
          {item.name}
        </Tag>
      ))}
      <Button
        aria-label={`添加${title}`}
        className="label-plus"
        icon={<PlusOutlined />}
        onClick={() => {
          setAddKind(kind)
          setAddName("")
        }}
        size="small"
        type="text"
      />
    </div>
  )

  if (boxes.isError) {
    return <Alert message={displayError(boxes.error)} showIcon type="error" />
  }

  const dangerChoice = (text: string) => <span className="label-choice-danger">{text}</span>
  const remarkOptions = [
    { label: dangerChoice("不修改"), value: "keep" },
    { label: dangerChoice("清除备注"), value: "clear" },
    ...remarks.map((item) => ({ label: item.name, value: item.id })),
  ]
  const groupOptions = [
    { label: dangerChoice("不修改"), value: "keep" },
    { label: dangerChoice("清除分组"), value: "clear" },
    ...groups.map((item) => ({ label: item.name, value: item.id })),
  ]

  return (
    <section className="module-page devices-page">
      <div className="device-crud-toolbar">
        <Space wrap>
          <span className="filter-label">搜索</span>
          <Input
            allowClear
            aria-label="搜索"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="备注 / 分组 / 序列号 / IP"
            style={{ width: 240 }}
            value={keyword}
          />
          <span className="filter-label">版本号</span>
          <Input
            allowClear
            aria-label="版本号"
            onChange={(event) => setVersion(event.target.value)}
            placeholder="版本号"
            style={{ width: 140 }}
            value={version}
          />
          <span className="filter-label">启用状态</span>
          <Select
            aria-label="启用状态"
            onChange={setEnabled}
            options={[
              { label: "全部", value: "all" },
              { label: "启用", value: "on" },
              { label: "未启用", value: "off" },
            ]}
            style={{ width: 110 }}
            value={enabled}
          />
          <span className="filter-label">备注</span>
          <Select
            aria-label="筛选备注"
            onChange={setRemarkFilter}
            options={[
              { label: "全部备注", value: "all" },
              { label: "未备注", value: "none" },
              ...remarks.map((item) => ({ label: item.name, value: item.id })),
            ]}
            style={{ width: 140 }}
            value={remarkFilter}
          />
          <span className="filter-label">分组</span>
          <Select
            aria-label="筛选分组"
            onChange={setGroupFilter}
            options={[
              { label: "全部分组", value: "all" },
              { label: "未分组", value: "none" },
              ...groups.map((item) => ({ label: item.name, value: item.id })),
            ]}
            style={{ width: 140 }}
            value={groupFilter}
          />
          <Button icon={<SearchOutlined />} onClick={() => void boxes.refetch()}>
            搜索
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void boxes.refetch()}>
            刷新
          </Button>
        </Space>
        <div className="device-auth-actions">
          <Button disabled={selected.size === 0} onClick={() => setBatchOpen(true)} type="primary">
            批量分配（{selected.size}）
          </Button>
          <Button shape="round">盒子数量: {boxes.data?.length ?? 0}</Button>
        </div>
      </div>
      {catalogRow("remark", "备注", remarks, remarkFilter, setRemarkFilter)}
      {catalogRow("group", "分组", groups, groupFilter, setGroupFilter)}
      <Table<OwnedBox>
        columns={columns}
        dataSource={[...rows]}
        loading={boxes.isPending}
        locale={{
          emptyText: <Empty description="还没有分配给你的盒子" />,
        }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        rowKey="id"
        scroll={{ x: 1280 }}
        size="small"
      />
      <Typography.Text type="secondary">点击序列号或 IP 可以复制。全选只选中当前筛选结果。</Typography.Text>
      <Modal
        okText="添加"
        onCancel={() => setAddKind(null)}
        onOk={() => void saveLabel()}
        open={addKind !== null}
        title={addKind === "group" ? "添加分组" : "添加备注"}
      >
        <Input
          aria-label="名称"
          maxLength={40}
          onChange={(event) => setAddName(event.target.value)}
          onPressEnter={() => void saveLabel()}
          placeholder={addKind === "group" ? "分组名称" : "备注名称"}
          value={addName}
        />
      </Modal>
      <Modal okText="分配" onCancel={() => setBatchOpen(false)} onOk={() => void applyBatch()} open={batchOpen} title="批量分配备注和分组">
        <Space direction="vertical" style={{ width: "100%" }}>
          <span>已选 {selected.size} 台</span>
          <Select aria-label="批量备注" onChange={setBatchRemark} options={remarkOptions} style={{ width: "100%" }} value={batchRemark} />
          <Select aria-label="批量分组" onChange={setBatchGroup} options={groupOptions} style={{ width: "100%" }} value={batchGroup} />
        </Space>
      </Modal>
    </section>
  )
}
