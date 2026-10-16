import { MinusOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons"
import { HTTPError } from "ky"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  InputNumber,
  Progress,
  Space,
  Table,
  Tag,
  Typography,
} from "antd"
import type { ColumnsType } from "antd/es/table"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { type BoxLabel, createDevicesApi, type DevicesApi, type OwnedBox } from "./api"
import { hideMiddle, shortDate } from "./myt-device"
import "./devices.css"
import {
  type FilterMode,
  type SelectionScope,
  FilterModeSwitch,
  SelectionScopeSwitch,
  combineChecks,
  pageSlice,
  useClientPagination,
} from "../../components/tables/operation-controls"
import { labelsChanged } from "../labels/api"
import { BatchAssignDialog, batchClearOption, type BatchAssignResult } from "../labels/batch-assign-dialog"
import { LabelFilterRow, usageLabel } from "../labels/filter-row"

type DeviceListPageProps = {
  readonly api?: DevicesApi
  readonly canDelete?: boolean
  readonly canWrite: boolean
  readonly isAdministrator: boolean
}

type LabelFilter = "all" | "none" | string

const displayError = (error: unknown): string =>
  error instanceof Error ? error.message : "盒子数据加载失败"

const sequenceError = async (error: unknown): Promise<string> => {
  if (error instanceof HTTPError) {
    const body = await error.response
      .json<{ error?: string }>()
      .catch(() => ({}) as { error?: string })
    if (body.error === "duplicate_sequence") return "这个序号已经有盒子在用"
  }
  return displayError(error)
}

const catalogError = async (error: unknown): Promise<string> => {
  if (error instanceof HTTPError) {
    const body = await error.response
      .json<{ error?: string }>()
      .catch(() => ({}) as { error?: string })
    if (body.error === "label_in_use") return "仍被盒子使用的备注或分组不能删除"
  }
  return displayError(error)
}

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

const SequenceEditor = ({
  host,
  onCommit,
  value,
}: {
  readonly host: string
  readonly onCommit: (value: number | null) => Promise<void> | void
  readonly value: number | null
}): ReactNode => {
  const [draft, setDraft] = useState<number | null>(value)
  useEffect(() => setDraft(value), [value])
  const commit = (next: number | null) => {
    const normalized = next === null ? null : Math.min(999, Math.max(1, Math.trunc(next)))
    if (normalized === value) {
      setDraft(normalized)
      return
    }
    setDraft(normalized)
    void Promise.resolve(onCommit(normalized)).catch(() => setDraft(value))
  }
  return (
    <Space.Compact className="sequence-stepper" size="small">
      <Button
        aria-label={`减少 ${host} 的序号`}
        disabled={draft === null || draft <= 1}
        icon={<MinusOutlined />}
        onClick={() => commit((draft ?? 1) - 1)}
        size="small"
      />
      <InputNumber
        aria-label={`${host} 的序号`}
        controls={false}
        max={999}
        min={1}
        onBlur={() => commit(draft)}
        onChange={(next) => setDraft(typeof next === "number" ? next : null)}
        onPressEnter={() => commit(draft)}
        placeholder="无"
        precision={0}
        size="small"
        value={draft}
      />
      <Button
        aria-label={`增加 ${host} 的序号`}
        disabled={draft !== null && draft >= 999}
        icon={<PlusOutlined />}
        onClick={() => commit(draft === null ? 1 : draft + 1)}
        size="small"
      />
    </Space.Compact>
  )
}

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
        className="box-edit-input"
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
      className={name === null ? "box-editable-tag is-empty" : "box-editable-tag"}
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
      color={name === null ? undefined : color}
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

export const DeviceListPage = ({
  api = createDevicesApi(),
  canDelete,
  canWrite,
  isAdministrator,
}: DeviceListPageProps): ReactNode => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const [keyword, setKeyword] = useState("")
  const [version, setVersion] = useState("")
  const [presence, setPresence] = useState<"all" | "online" | "offline">("all")
  const [remarkFilters, setRemarkFilters] = useState<readonly string[]>([])
  const [groupFilter, setGroupFilter] = useState<LabelFilter>("all")
  const [filterMode, setFilterMode] = useState<FilterMode>("and")
  const [selectionScope, setSelectionScope] = useState<SelectionScope>("all")
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [batchOpen, setBatchOpen] = useState(false)
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
  useEffect(() => {
    const reload = () => {
      void queryClient.invalidateQueries({ queryKey: ["box-labels"] })
      void queryClient.invalidateQueries({ queryKey: ["owned-boxes"] })
    }
    window.addEventListener("business-labels-changed", reload)
    return () => window.removeEventListener("business-labels-changed", reload)
  }, [queryClient])

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
  const loadedBoxes = boxes.data ?? []
  const remarkCounts = new Map<string, number>()
  const groupCounts = new Map<string, number>()
  let unremarkedBoxes = 0
  let ungroupedBoxes = 0
  for (const box of loadedBoxes) {
    if (box.remarks.length === 0) unremarkedBoxes += 1
    else for (const item of box.remarks) remarkCounts.set(item.id, (remarkCounts.get(item.id) ?? 0) + 1)
    if (box.boxGroupId === null) ungroupedBoxes += 1
    else groupCounts.set(box.boxGroupId, (groupCounts.get(box.boxGroupId) ?? 0) + 1)
  }

  const rows = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    const versionText = version.trim().toLowerCase()
    return (boxes.data ?? []).filter((box) => {
      const remarkIds = box.remarks.map((item) => item.id)
      return combineChecks(filterMode, [
        remarkFilters.includes("none") ? remarkIds.length === 0 : null,
        ...(remarkFilters.length > 0 && !remarkFilters.includes("none")
          ? remarkFilters.map((id) => remarkIds.includes(id))
          : []),
        groupFilter === "all" ? null : matchesLabel(groupFilter, box.boxGroupId),
        presence === "all" ? null : box.status === presence,
        versionText.length > 0
          ? `${box.version ?? ""} ${box.firmware}`.toLowerCase().includes(versionText)
          : null,
        text.length === 0
          ? null
          : [
              ...box.remarks.map((item) => item.name),
              box.boxGroupName ?? "",
              box.host,
              box.externalId,
            ].some((value) => value.toLowerCase().includes(text)),
      ])
    })
  }, [boxes.data, filterMode, groupFilter, keyword, presence, remarkFilters, version])
  const paging = useClientPagination(
    JSON.stringify([filterMode, groupFilter, keyword, presence, remarkFilters, version]),
    20,
  )
  const pageRows = pageSlice(rows, paging.current, paging.pageSize)
  const targetIds = (selectionScope === "page" ? pageRows : rows).map((box) => box.id)
  const selectedTarget = targetIds.filter((id) => selected.has(id)).length
  const allTargetSelected = targetIds.length > 0 && selectedTarget === targetIds.length

  const toggleFiltered = () => {
    setSelected((current) => {
      const next = new Set(current)
      if (allTargetSelected) {
        for (const id of targetIds) next.delete(id)
      } else {
        for (const id of targetIds) next.add(id)
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

  const createCatalog = async (kind: "remark" | "group", name: string) => {
    try {
      if (kind === "remark") await api.createRemark(name)
      else await api.createBoxGroup(name)
      await refresh()
      labelsChanged()
    } catch (error) {
      message.error(displayError(error))
      throw error
    }
  }

  const removeCatalog = async (kind: "remark" | "group", item: BoxLabel) => {
    if (kind === "remark") await api.deleteRemark(item.id)
    else await api.deleteBoxGroup(item.id)
    if (kind === "remark") setRemarkFilters((current) => current.filter((id) => id !== item.id))
    if (kind === "group" && groupFilter === item.id) setGroupFilter("all")
    await refresh()
    labelsChanged()
  }

  const ensureLabel = async (kind: "remark" | "group", nameOrId: string): Promise<string> => {
    const catalog = kind === "remark" ? remarks : groups
    const known = catalog.find((item) => item.id === nameOrId || item.name === nameOrId.trim())
    if (known !== undefined) return known.id
    const name = nameOrId.trim()
    if (name.length === 0 || name.length > 40) throw new Error("名称需为 1 到 40 个字")
    try {
      const created = kind === "remark" ? await api.createRemark(name) : await api.createBoxGroup(name)
      return created.id
    } catch (error) {
      if (error instanceof HTTPError && error.response.status === 409) {
        const fresh = await api.labels()
        const found = (kind === "remark" ? fresh.remarks : fresh.groups).find((item) => item.name === name)
        if (found !== undefined) return found.id
      }
      throw error
    }
  }

  const saveSequence = async (box: OwnedBox, value: number | null) => {
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 999)) {
      message.error("序号需为 1 到 999")
      return
    }
    try {
      await api.assignLabels({ deviceIds: [box.id], sequenceNo: value })
      await refresh()
    } catch (error) {
      message.error(await sequenceError(error))
      throw error
    }
  }

  const renameRemark = async (box: OwnedBox, remarkId: string | null, name: string) => {
    const rest = box.remarks.filter((item) => item.id !== remarkId).map((item) => item.id)
    try {
      const nextId = name === "" ? null : await ensureLabel("remark", name)
      const remarkIds = nextId === null ? rest : [...rest.filter((id) => id !== nextId), nextId]
      await api.assignLabels({ deviceIds: [box.id], remarkIds, remarkMode: "replace" })
      labelsChanged()
      await refresh()
    } catch (error) {
      message.error(await catalogError(error))
    }
  }

  const saveGroup = async (box: OwnedBox, value: string | null) => {
    try {
      const boxGroupId = value === null ? null : await ensureLabel("group", value)
      await api.assignLabels({ deviceIds: [box.id], boxGroupId })
      labelsChanged()
      await refresh()
    } catch (error) {
      message.error(await catalogError(error))
    }
  }

  const applyBatch = async (choice: BatchAssignResult) => {
    const deviceIds = [...selected]
    const input: {
      boxGroupId?: string | null
      deviceIds: string[]
      remarkIds?: string[]
      remarkMode?: "add" | "replace"
    } = { deviceIds }
    if (choice.remarks.kind === "clear") {
      input.remarkIds = []
      input.remarkMode = "replace"
    } else if (choice.remarks.kind === "set") {
      input.remarkIds = await Promise.all(
        choice.remarks.values.map((value) => ensureLabel("remark", value)),
      )
      input.remarkMode = "add"
    }
    if (choice.group.kind === "clear") input.boxGroupId = null
    else if (choice.group.kind === "set") {
      const name = choice.group.values[0] ?? ""
      if (name.includes("+")) {
        message.error("分组名称不能包含 + 符号")
        return
      }
      input.boxGroupId = await ensureLabel("group", name)
    }
    if (input.remarkIds === undefined && input.boxGroupId === undefined) {
      setBatchOpen(false)
      return
    }
    try {
      await api.assignLabels(input)
      setBatchOpen(false)
      message.success("已分配")
      labelsChanged()
      await refresh()
    } catch (error) {
      message.error(await catalogError(error))
    }
  }

  const columns: ColumnsType<OwnedBox> = [
    {
      title: (
        <Checkbox
          aria-label="全选筛选后的盒子"
          checked={allTargetSelected}
          disabled={targetIds.length === 0}
          indeterminate={selectedTarget > 0 && !allTargetSelected}
          onChange={toggleFiltered}
        />
      ),
      width: 48,
      render: (_value, box) => (
        <Checkbox
          aria-label={`选择 ${box.host}`}
          checked={selected.has(box.id)}
          onChange={() => toggleOne(box.id)}
        />
      ),
    },
    {
      title: "序号",
      width: 96,
      sortDirections: ["ascend", "descend"],
      sorter: (left: OwnedBox, right: OwnedBox) =>
        (left.sequenceNo ?? Number.MAX_SAFE_INTEGER) - (right.sequenceNo ?? Number.MAX_SAFE_INTEGER),
      render: (_value, box) =>
        canWrite ? (
          <SequenceEditor host={box.host} onCommit={(value) => saveSequence(box, value)} value={box.sequenceNo} />
        ) : (
          <span>{box.sequenceNo ?? "-"}</span>
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
      width: 260,
      render: (_value, box) => {
        return (
          <div className="meta-cell">
            <div className="box-label-pair">
              {canWrite ? (
                <>
                  {box.remarks.length === 0 ? (
                    <EditableTextTag
                      color="blue"
                      emptyLabel="备注"
                      name={null}
                      onCommit={(name) => void renameRemark(box, null, name)}
                    />
                  ) : (
                    box.remarks.map((item) => (
                      <EditableTextTag
                        key={item.id}
                        color="blue"
                        emptyLabel={`${box.host} 的备注`}
                        name={item.name}
                        onCommit={(name) => void renameRemark(box, item.id, name)}
                        onRemove={() => void renameRemark(box, item.id, "")}
                        removeLabel={`清除 ${box.host} 的备注 ${item.name}`}
                      />
                    ))
                  )}
                  <EditableTextTag
                    color="orange"
                    emptyLabel="分组"
                    name={box.boxGroupName}
                    onCommit={(name) => void saveGroup(box, name === "" ? null : name)}
                    {...(box.boxGroupName === null
                      ? {}
                      : {
                          onRemove: () => void saveGroup(box, null),
                          removeLabel: `清除 ${box.host} 的分组`,
                        })}
                  />
                </>
              ) : (
                <>
                  {box.remarks.map((item) => (
                    <Tag key={item.id} color="blue">
                      {item.name}
                    </Tag>
                  ))}
                  {box.boxGroupName === null ? null : <Tag color="orange">{box.boxGroupName}</Tag>}
                  {box.remarks.length === 0 && box.boxGroupName === null ? (
                    <span className="muted">-</span>
                  ) : null}
                </>
              )}
            </div>
            <div>
              <Tag
                color={
                  box.status === "online"
                    ? "success"
                    : box.status === "offline"
                      ? "error"
                      : "default"
                }
              >
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
        <Tag color={modelLabel(box.model) === "P1" ? "success" : "processing"}>
          {modelLabel(box.model)}
        </Tag>
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
                  strokeColor={
                    box.diskPct >= 90 ? "#F56C6C" : box.diskPct >= 70 ? "#E6A23C" : "#67C23A"
                  }
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
        <Button
          onClick={() => navigate(`/operations/devices/${box.id}/control`)}
          size="small"
          type="primary"
        >
          中控
        </Button>
      ),
    },
  ]

  const catalogRow = (
    kind: "remark" | "group",
    title: string,
    items: readonly BoxLabel[],
    selectedLabels: readonly string[],
    onChange: (values: string[]) => void,
  ) => (
    <LabelFilterRow
      system
      title={title}
      kind={kind}
      multiple={kind === "remark"}
      selected={selectedLabels}
      onChange={onChange}
      unassigned={{
        value: "none",
        label: usageLabel(
          kind === "group" ? "未分组" : "未备注",
          kind === "group" ? ungroupedBoxes : unremarkedBoxes,
        ),
      }}
      options={items.map((item) => ({
        value: item.id,
        label: usageLabel(
          item.name,
          (kind === "group" ? groupCounts : remarkCounts).get(item.id) ?? 0,
        ),
        removable: canDelete === true && isAdministrator,
      }))}
      {...(canWrite ? { onAdd: (name: string) => createCatalog(kind, name) } : {})}
      onRemove={(id) => {
        const item = items.find((label) => label.id === id)
        if (item === undefined) return
        modal.confirm({
          title: `删除${title}`,
          content: `确认删除“${item.name}”？仍被盒子使用的备注或分组不能删除。`,
          okText: "删除",
          cancelText: "取消",
          onOk: async () => {
            try {
              await removeCatalog(kind, item)
            } catch (error) {
              message.error(await catalogError(error))
              throw error
            }
          },
        })
      }}
    />
  )

  if (boxes.isError) {
    return <Alert message={displayError(boxes.error)} showIcon type="error" />
  }

  return (
    <section className="module-page devices-page">
      <Card className="condition-panel filter-bar" size="small">
        <LabelFilterRow
          onChange={(values) => {
            const next = values[0]
            setPresence(next === "online" || next === "offline" ? next : "all")
          }}
          options={[
            { label: "在线", value: "online" },
            { label: "离线", value: "offline" },
          ]}
          selected={presence === "all" ? [] : [presence]}
          system
          title="在线状态"
          tone="status"
        />
        {catalogRow("remark", "备注", remarks, remarkFilters, (values) => setRemarkFilters(values))}
        {catalogRow("group", "分组", groups, groupFilter === "all" ? [] : [groupFilter], (values) =>
          setGroupFilter(values[0] ?? "all"),
        )}
        <div className="condition-search">
          <span className="filter-label">搜索</span>
          <Input
            allowClear
            aria-label="搜索"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="备注 / 分组 / 序列号 / IP"
            style={{ width: 240 }}
            value={keyword}
          />
          <Input
            allowClear
            aria-label="版本号"
            onChange={(event) => setVersion(event.target.value)}
            placeholder="版本号"
            style={{ width: 140 }}
            value={version}
          />
          <Button
            onClick={() => {
              setKeyword("")
              setVersion("")
              setPresence("all")
              setRemarkFilters([])
              setGroupFilter("all")
            }}
          >
            重置
          </Button>
          <FilterModeSwitch mode={filterMode} onChange={setFilterMode} />
        </div>
      </Card>
      <div className="device-crud-toolbar">
        <Space wrap>
          <SelectionScopeSwitch onChange={setSelectionScope} scope={selectionScope} />
          <Button icon={<ReloadOutlined />} onClick={() => void boxes.refetch()}>
            刷新
          </Button>
          <Button disabled={selected.size === 0} onClick={() => setBatchOpen(true)} type="primary">
            批量分配（{selected.size}）
          </Button>
          <Button shape="round">盒子数量: {boxes.data?.length ?? 0}</Button>
        </Space>
      </div>
      <Table<OwnedBox>
        columns={columns}
        dataSource={[...rows]}
        loading={boxes.isPending}
        locale={{
          emptyText: <Empty description="还没有分配给你的盒子" />,
        }}
        pagination={{ ...paging.pagination, total: rows.length }}
        rowKey="id"
        scroll={{ x: 1400 }}
        size="small"
      />
      <Typography.Text type="secondary">
        点击序列号或 IP 可以复制。全选范围决定勾选当前页，还是全部筛选结果。
      </Typography.Text>
      <BatchAssignDialog
        groupOptions={[batchClearOption("清除分组"), ...groups.map((item) => ({ label: item.name, value: item.id }))]}
        onCancel={() => setBatchOpen(false)}
        onSubmit={(choice) => void applyBatch(choice)}
        open={batchOpen}
        remarkOptions={[
          batchClearOption("清除备注"),
          ...remarks.map((item) => ({ label: item.name, value: item.id })),
        ]}
        selectedCount={selected.size}
      />
    </section>
  )
}
