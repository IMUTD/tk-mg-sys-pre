import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  StarFilled,
  StarOutlined,
  UploadOutlined,
} from "@ant-design/icons"
import { Alert, App, Button, Card, Input, Select, Space, Table, Tag } from "antd"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { useFilteredRowSelection } from "../../components/tables/filtered-selection"
import {
  type FilterMode,
  FilterModeSwitch,
  pageSlice,
  type SelectionScope,
  SelectionScopeSwitch,
  useClientPagination,
} from "../../components/tables/operation-controls"
import { createProxiesApi, type ProxiesApi, proxyRequestError } from "./api"

import {
  ProxyBatchUpdateDialog,
  ProxyBuyDialog,
  ProxyCheckResultDialog,
  ProxyFaqDialog,
  ProxyRunDialog,
} from "./batch-dialogs"
import { defaultIpLookupOptions, detectProxyBatch } from "./detection"
import { ProxyFormDialog } from "./form-dialog"
import { ProxyImportDialog } from "./import-dialog"
import {
  batchUpdateByTags,
  checkMessage,
  createSeedProxyDevices,
  ENABLE_OPTIONS,
  emptyProxy,
  emptyProxyQuery,
  endpointText,
  expireDate,
  expirePresetOptions,
  extraModeLabel,
  filterProxies,
  getPrimaryCheckResult,
  getResultCountry,
  getResultIp,
  getResultStatusLabel,
  type MytProxy,
  nowText,
  PROXY_TYPE_OPTIONS,
  type ProxyQuery,
  parseCheckResult,
  proxiesToCsv,
  proxyDetectedRegion,
  proxyTypeLabel,
  SEED_DYNAMIC_TRAFFIC,
  shortDate,
  staticProxyCount,
  turboNodeLabel,
  turboNodeProxies,
  uniqueRegionOptions,
  uniqueTagOptions,
} from "./myt-proxy"
import "./proxies.css"
import { PageKey } from "../../lib/pages"
import { createLabelsApi, labelsChanged } from "../labels/api"
import {
  BatchAssignDialog,
  type BatchAssignResult,
  batchClearOption,
} from "../labels/batch-assign-dialog"
import { EditableTextTag } from "../labels/editable-text-tag"
import {
  BusinessLabelFilter,
  LabelFilterRow,
  UNASSIGNED_VALUE,
  unionLabelNames,
  usageLabel,
} from "../labels/filter-row"
import { addRemarks, formatRemarks, splitRemarks } from "../labels/remark-list"
import { RemarkTags } from "../labels/remark-tags"

type ProxiesListPageProps = {
  readonly groupIds?: readonly string[]
  readonly api?: ProxiesApi
  readonly canDelete?: boolean
  readonly canWrite: boolean
}

// PostgreSQL label names cannot contain NUL, so this filter cannot collide with a catalog name.
const choice = (value: string): string[] => (value.length === 0 ? [] : [value])
const noGroups: readonly string[] = []

const downloadCsv = (csv: string, filename: string): void => {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.download = filename
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
}

const rowLabel = (proxy: MytProxy): string => {
  const remark = formatRemarks(proxy.remark)
  return remark.length > 0 ? remark : endpointText(proxy)
}

export const ProxiesListPage = ({
  canDelete,
  canWrite,
  groupIds = noGroups,
  api: providedApi,
}: ProxiesListPageProps): ReactNode => {
  const allowDelete = canDelete === true
  const { message, modal } = App.useApp()
  const [draft, setDraft] = useState<ProxyQuery>(emptyProxyQuery)
  const [filterMode, setFilterMode] = useState<FilterMode>("and")
  const [selectionScope, setSelectionScope] = useState<SelectionScope>("all")
  const [query, setQuery] = useState<ProxyQuery>(emptyProxyQuery)
  const api = useMemo(() => providedApi ?? createProxiesApi(), [providedApi])
  const [proxies, setProxies] = useState<MytProxy[]>([])
  const [creationGroup, setCreationGroup] = useState(groupIds[0] ?? "")
  const [busy, setBusy] = useState(false)
  const operationActive = useRef(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const scopeKey = groupIds.join(",")
  useEffect(() => {
    let cancelled = false
    setProxies([])
    setSelectedIds([])
    setEditRecord(null)
    setCreationGroup(scopeKey.split(",")[0] ?? "")
    void api.list(scopeKey.length === 0 ? [] : scopeKey.split(",")).then(
      (items) => {
        if (!cancelled) {
          setProxies(items)
          setLoadError(null)
        }
      },
      (error: unknown) => {
        void proxyRequestError(error).then((text) => {
          if (!cancelled) setLoadError(text)
        })
      },
    )
    return () => {
      cancelled = true
    }
  }, [api, scopeKey])
  const reload = async (): Promise<void> => {
    setProxies(await api.list(groupIds))
    setLoadError(null)
  }
  const perform = async (action: () => Promise<void>): Promise<void> => {
    if (operationActive.current) return
    operationActive.current = true
    setBusy(true)
    try {
      await action()
    } catch (error) {
      message.error(await proxyRequestError(error))
    } finally {
      try {
        await reload()
      } catch (error) {
        setLoadError(await proxyRequestError(error))
      }
      operationActive.current = false
      setBusy(false)
    }
  }
  const persistBatch = async (items: readonly MytProxy[]): Promise<void> => {
    let saved = 0
    const errors: string[] = []
    for (const item of items) {
      try {
        await api.save(item, proxies, false)
        saved++
      } catch (error) {
        errors.push(await proxyRequestError(error))
      }
    }
    if (errors.length > 0)
      throw new Error(`已保存 ${saved} 条，失败 ${errors.length} 条：${errors[0]}`)
    message.success(`已保存 ${saved} 条`)
  }
  const applyProxyBatch = (choice: BatchAssignResult): void => {
    const groupName = choice.group.kind === "set" ? (choice.group.values[0] ?? "") : ""
    if (groupName.includes("+")) {
      message.error("分组名称不能包含 + 符号")
      return
    }
    const remarkNames = choice.remarks.kind === "set" ? [...choice.remarks.values] : []
    const remarkOf = (current: string): string =>
      choice.remarks.kind === "clear" ? "" : addRemarks(current, remarkNames)
    if (
      choice.remarks.kind !== "skip" &&
      selected.some((item) => remarkOf(item.remark).length > 2000)
    ) {
      message.error("备注总长度不能超过 2000")
      return
    }
    const next = selected.map((item) => ({
      ...item,
      ...(choice.group.kind === "skip" ? {} : { tag: groupName }),
      ...(choice.remarks.kind === "skip" ? {} : { remark: remarkOf(item.remark) }),
    }))
    void perform(async () => {
      const persisted = next.filter((item) => item.uuid !== undefined && item.groupId !== undefined)
      const local = next.filter((item) => item.uuid === undefined || item.groupId === undefined)
      if (local.length > 0) {
        setProxies((current) =>
          current.map((row) => local.find((item) => item.id === row.id) ?? row),
        )
      }
      if (persisted.length > 0) await persistBatch(persisted)
      else if (local.length > 0) message.success("已分配")
      if (groupName.length > 0) {
        void createLabelsApi()
          .create(PageKey.Proxies, "group", groupName)
          .then(() => labelsChanged())
          .catch(() => undefined)
      }
      for (const name of remarkNames) {
        void createLabelsApi()
          .create(PageKey.Proxies, "remark", name)
          .then(() => labelsChanged())
          .catch(() => undefined)
      }
      setBatchAssignOpen(false)
    })
  }
  const [devices] = useState(() => createSeedProxyDevices())
  const [selectedIds, setSelectedIds] = useState<readonly number[]>([])
  const [editRecord, setEditRecord] = useState<MytProxy | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [batchAssignOpen, setBatchAssignOpen] = useState(false)
  const [batchUpdateOpen, setBatchUpdateOpen] = useState(false)
  const [runProxy, setRunProxy] = useState<MytProxy | null>(null)
  const [faqOpen, setFaqOpen] = useState(false)
  const [buyOpen, setBuyOpen] = useState(false)
  const [resultView, setResultView] = useState<{
    id: number
    result: NonNullable<ReturnType<typeof parseCheckResult>>
  } | null>(null)
  const expireOptions = useMemo(() => expirePresetOptions(), [])
  const filtered = useMemo(
    () => filterProxies(proxies, query, filterMode),
    [filterMode, proxies, query],
  )
  const proxyPaging = useClientPagination(JSON.stringify([filterMode, query]))
  const selected = proxies.filter((item) => selectedIds.includes(item.id))
  const tagOptions = uniqueTagOptions(proxies)
  const regionOptions = uniqueRegionOptions(proxies)
  const [catalogGroups, setCatalogGroups] = useState<readonly string[]>([])
  const [catalogRemarks, setCatalogRemarks] = useState<readonly string[]>([])
  useEffect(() => {
    const labels = createLabelsApi()
    const load = (): void => {
      void labels
        .list(PageKey.Proxies, "proxy")
        .then((result) => {
          setCatalogGroups(result.groups.map((item) => item.name))
          setCatalogRemarks(result.remarks.map((item) => item.name))
        })
        .catch(() => undefined)
    }
    load()
    window.addEventListener("business-labels-changed", load)
    return () => window.removeEventListener("business-labels-changed", load)
  }, [])
  const remarkCounts = new Map<string, number>()
  for (const item of proxies) {
    for (const remark of splitRemarks(item.remark)) {
      remarkCounts.set(remark, (remarkCounts.get(remark) ?? 0) + 1)
    }
  }
  const remarkOptions = [...remarkCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "zh-CN"))
    .map(([remark, count]) => ({ label: usageLabel(remark, count), value: remark }))
  const remarkNames = [
    ...new Set(
      [...catalogRemarks, ...remarkCounts.keys()]
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
    ),
  ].sort((left, right) => left.localeCompare(right, "zh-CN"))
  const turboOptions = turboNodeProxies(proxies).map((item) => ({
    label: turboNodeLabel(item),
    value: String(item.id),
  }))
  const nextId = Math.max(0, ...proxies.map((item) => item.id)) + 1
  const staticCount = staticProxyCount(proxies)
  const updateDetection = (
    item: MytProxy,
    result: NonNullable<ReturnType<typeof parseCheckResult>>,
  ) => {
    const updated = { ...item, result: JSON.stringify(result) }
    setProxies((current) =>
      current.some((row) => row.uuid === item.uuid && row.groupId === item.groupId)
        ? current.map((row) =>
            row.uuid === item.uuid && row.groupId === item.groupId ? updated : row,
          )
        : [...current, updated],
    )
  }
  const runDetect = (ids: readonly number[], stride = 2): void => {
    void perform(async () => {
      let opened = false
      const { failed, requestFailures, succeeded } = await detectProxyBatch(
        api,
        proxies.filter((row) => ids.includes(row.id)),
        defaultIpLookupOptions,
        (row, result) => {
          updateDetection(row, result)
          if (ids.length === 1) {
            opened = true
            setResultView({ id: row.id, result })
          }
        },
        stride,
      )
      if (ids.length !== 1) message.info(`检测完成，成功 ${succeeded} 个，失败 ${failed} 个`)
      else if (!opened || requestFailures > 0) message.error("检测失败")
    })
  }
  const detectCreated = async (items: readonly MytProxy[]): Promise<void> => {
    if (items.length === 0) return
    const result = await detectProxyBatch(api, items, defaultIpLookupOptions, updateDetection)
    message.info(`检测完成，成功 ${result.succeeded} 个，失败 ${result.failed} 个`)
  }

  const applyQuery = (next = draft): void => {
    setDraft(next)
    setQuery(next)
  }

  const changeSelectQuery = (patch: Partial<ProxyQuery>): void => {
    applyQuery({ ...draft, ...patch })
  }

  const resetQuery = (): void => {
    const empty = emptyProxyQuery()
    setDraft(empty)
    setQuery(empty)
  }

  const requireSelection = (action: () => void): void => {
    if (selected.length === 0) {
      message.warning("请先选择代理")
      return
    }
    action()
  }

  const deleteIds = async (ids: readonly number[]): Promise<void> => {
    await api.delete(proxies.filter((item) => ids.includes(item.id)))
    setSelectedIds((current) => current.filter((id) => !ids.includes(id)))
    message.success("删除成功")
  }

  const deleteSelected = (): void => {
    if (selected.length === 0) return
    void modal.confirm({
      cancelText: "取消",
      content: `确认删除选中的 ${selected.length} 条代理吗？`,
      okText: "确定",
      onOk: () => perform(() => deleteIds(selectedIds)),
      title: "提示",
    })
  }

  const deleteOne = (item: MytProxy): void => {
    void modal.confirm({
      cancelText: "取消",
      content: "确定删除吗？",
      okText: "确定",
      onOk: () => perform(() => deleteIds([item.id])),
      title: "提示",
    })
  }

  const openEditSelected = (): void => {
    if (selected.length !== 1) return
    const record = selected[0]
    if (record === undefined) return
    void perform(async () => setEditRecord(await api.credentials(record)))
  }

  const exportSelected = (): void => {
    requireSelection(() => {
      downloadCsv(proxiesToCsv(selected), "选中数据.csv")
      message.success("导出成功")
    })
  }
  const proxySelection = useFilteredRowSelection({
    getCheckboxProps: (item: MytProxy) => ({
      "aria-label": `选择 ${rowLabel(item)}`,
    }),
    onChange: (keys) => setSelectedIds(keys.map((key) => Number(key))),
    pageKeys: pageSlice(filtered, proxyPaging.current, proxyPaging.pageSize).map((item) => item.id),
    rowKey: "id",
    rows: filtered,
    selectedKeys: selectedIds,
    selectionScope,
  })

  const saveProxyText = (
    item: MytProxy,
    patch: { readonly tag?: string; readonly remark?: string },
  ): void => {
    if (patch.tag?.includes("+")) {
      message.error("分组名称不能包含 + 符号")
      return
    }
    if ((patch.remark?.length ?? 0) > 2000) {
      message.error("备注总长度不能超过 2000")
      return
    }
    const next = { ...item, ...patch }
    if (item.uuid === undefined || item.groupId === undefined) {
      setProxies((current) => current.map((row) => (row.id === item.id ? next : row)))
      return
    }
    void api
      .save(next, proxies, false)
      .then((saved) => {
        setProxies((current) => current.map((row) => (row.id === item.id ? saved : row)))
        const tag = patch.tag?.trim() ?? ""
        const remark = patch.remark?.trim() ?? ""
        if (tag.length > 0) {
          void createLabelsApi()
            .create(PageKey.Proxies, "group", tag)
            .then(() => labelsChanged())
            .catch(() => undefined)
        }
        for (const name of splitRemarks(remark)) {
          void createLabelsApi()
            .create(PageKey.Proxies, "remark", name)
            .then(() => labelsChanged())
            .catch(() => undefined)
        }
      })
      .catch(async (error: unknown) => message.error(await proxyRequestError(error)))
  }

  return (
    <section className="module-page proxies-page">
      {loadError === null ? null : <Alert message={loadError} showIcon type="error" />}
      <Card className="condition-panel filter-bar" size="small">
        <BusinessLabelFilter
          blankLabel={usageLabel("未分组", proxies.filter((item) => item.tag.length === 0).length)}
          canDelete={allowDelete}
          canWrite={canWrite}
          onChange={(tag) =>
            changeSelectQuery({
              tag: tag === UNASSIGNED_VALUE ? "" : tag,
              noTag: tag === UNASSIGNED_VALUE,
            })
          }
          closable
          options={tagOptions}
          page={PageKey.Proxies}
          system
          title="分组"
          value={draft.noTag ? UNASSIGNED_VALUE : draft.tag}
        />
        <BusinessLabelFilter
          blankLabel={usageLabel(
            "未备注",
            proxies.filter((item) => splitRemarks(item.remark).length === 0).length,
          )}
          canDelete={allowDelete}
          canWrite={canWrite}
          closable
          kind="remark"
          multiple
          onChange={(remarks) =>
            changeSelectQuery(
              remarks.includes(UNASSIGNED_VALUE)
                ? { remarks: [], unremarked: true }
                : { remarks, unremarked: false },
            )
          }
          options={remarkOptions}
          page={PageKey.Proxies}
          system
          title="备注"
          value={draft.unremarked ? [UNASSIGNED_VALUE] : draft.remarks}
        />
        <LabelFilterRow
          onChange={(values) => changeSelectQuery({ type: values[0] ?? "" })}
          options={PROXY_TYPE_OPTIONS.map((option) => ({
            label: option.label,
            value: option.value,
          }))}
          selected={choice(draft.type)}
          system
          title="类型"
        />
        <LabelFilterRow
          onChange={(values) => changeSelectQuery({ region: values[0] ?? "" })}
          options={regionOptions}
          selected={choice(draft.region)}
          system
          title="地区"
        />
        <LabelFilterRow
          onChange={(values) => changeSelectQuery({ save: values[0] ?? "" })}
          options={ENABLE_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
          selected={choice(draft.save)}
          system
          title="节流"
        />
        <LabelFilterRow
          onChange={(values) => changeSelectQuery({ expiredTime: values[0] ?? "" })}
          options={expireOptions}
          selected={choice(draft.expiredTime)}
          system
          title="过期时间"
        />
        <LabelFilterRow
          onChange={(values) => changeSelectQuery({ favorite: values[0] === "yes" })}
          options={[{ label: "已收藏", value: "yes" }]}
          selected={draft.favorite ? ["yes"] : []}
          system
          title="收藏"
        />
        <div className="condition-search">
          <span className="filter-label">搜索</span>
          <Input
            allowClear
            aria-label="ID"
            onChange={(event) => changeSelectQuery({ id: event.target.value })}
            placeholder="ID"
            style={{ width: 85 }}
            value={draft.id}
          />
          <Input
            allowClear
            aria-label="搜索"
            onChange={(event) => changeSelectQuery({ search: event.target.value })}
            placeholder="IP/端口/备注/分组"
            style={{ width: 185 }}
            value={draft.search}
          />
          <Select
            allowClear
            aria-label="加速节点"
            onChange={(value: string | null) => changeSelectQuery({ turboNode: value ?? "" })}
            options={turboOptions}
            placeholder="加速节点"
            style={{ width: 220 }}
            value={draft.turboNode.length === 0 ? null : draft.turboNode}
            virtual={false}
          />
          <Button onClick={resetQuery}>重置</Button>
          <FilterModeSwitch mode={filterMode} onChange={setFilterMode} />
        </div>
      </Card>
      <div className="resource-crud-toolbar">
        <Space wrap>
          <SelectionScopeSwitch onChange={setSelectionScope} scope={selectionScope} />
          {groupIds.length > 1 ? (
            <Select
              aria-label="代理权限组"
              onChange={setCreationGroup}
              options={groupIds.map((id) => ({ label: id, value: id }))}
              style={{ width: 180 }}
              value={creationGroup}
              virtual={false}
            />
          ) : null}
          {canWrite ? (
            <>
              <Button
                icon={<PlusOutlined aria-hidden />}
                disabled={busy || creationGroup.length === 0}
                onClick={() =>
                  setEditRecord({ ...emptyProxy(0, nowText()), groupId: creationGroup })
                }
                type="primary"
              >
                新增
              </Button>
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
          {canWrite ? (
            <Button
              disabled={busy || proxies.length === 0}
              onClick={() =>
                runDetect(
                  proxies.map((item) => item.id),
                  1,
                )
              }
            >
              一键检测
            </Button>
          ) : null}
          <Button
            disabled={selected.length === 0}
            icon={<DownloadOutlined aria-hidden />}
            onClick={exportSelected}
          >
            导出选中
          </Button>
          {canWrite ? (
            <>
              <Button
                icon={<UploadOutlined aria-hidden />}
                onClick={() => setImportOpen(true)}
                type="primary"
              >
                批量导入
              </Button>
              <Button
                disabled={selected.length === 0}
                onClick={() => setBatchAssignOpen(true)}
                type="primary"
              >
                批量分配（{selected.length}）
              </Button>
              <Button
                disabled={selected.length === 0}
                onClick={() => requireSelection(() => setBatchUpdateOpen(true))}
              >
                批量修改
              </Button>
            </>
          ) : null}
          <Button onClick={() => setBuyOpen(true)} type="primary">
            购买代理
          </Button>
          <Button icon={<QuestionCircleOutlined aria-hidden />} onClick={() => setFaqOpen(true)}>
            常见问题
          </Button>
        </Space>
      </div>
      <div className="proxy-resource-bar">
        <span>剩余动态流量：{SEED_DYNAMIC_TRAFFIC}</span>
        <Button onClick={() => setBuyOpen(true)} type="link">
          充值
        </Button>
        <span>静态IP数量：{staticCount}</span>
        <Button onClick={() => setBuyOpen(true)} type="link">
          购买
        </Button>
        <span>IPLC专线购买</span>
        <Button onClick={() => setBuyOpen(true)} type="link">
          购买
        </Button>
      </div>
      <Table
        columns={[
          { dataIndex: "id", key: "id", title: "ID", width: 80 },
          {
            dataIndex: "type",
            key: "type",
            render: (type: string) => proxyTypeLabel(type),
            title: "类型",
            width: 80,
          },
          {
            dataIndex: "tag",
            key: "tag",
            render: (tag: string, item: MytProxy) =>
              canWrite ? (
                <EditableTextTag
                  color="orange"
                  emptyLabel="分组"
                  name={tag.length === 0 ? null : tag}
                  onCommit={(name) => saveProxyText(item, { tag: name })}
                  onRemove={() => saveProxyText(item, { tag: "" })}
                  removeLabel={`移除分组 ${tag}`}
                />
              ) : (
                <Tag className="proxy-tag">{tag.length === 0 ? "未分组" : tag}</Tag>
              ),
            title: "分组",
            width: 130,
          },
          {
            key: "endpoint",
            render: (_value: unknown, item: MytProxy) => (
              <div className="proxy-endpoint">
                <span className="proxy-endpoint-text">{endpointText(item)}</span>
                {item.type === "0" ? (
                  <Tag>{item.v2Protocol?.toUpperCase() ?? extraModeLabel(item.extra)}</Tag>
                ) : null}
                {item.type !== "0" && item.type !== "3" ? (
                  <Tag color={item.proxyType === "dynamic" ? "warning" : "success"}>
                    {item.proxyType === "dynamic" ? "动态" : "静态"}
                  </Tag>
                ) : null}
              </div>
            ),
            title: "IP端口",
            width: 200,
          },
          {
            key: "result",
            render: (_value: unknown, item: MytProxy) => {
              const parsed = parseCheckResult(item.result)
              const primary = getPrimaryCheckResult(parsed)
              return (
                <div className="proxy-result-cell">
                  <div className="proxy-result-toolbar">
                    <Button
                      disabled={!canWrite || busy}
                      onClick={() => runDetect([item.id])}
                      size="small"
                      type="link"
                    >
                      检测
                    </Button>
                    {parsed !== null ? (
                      <Tag color={parsed.ok ? "success" : "error"}>
                        {getResultStatusLabel(parsed.ok)}
                      </Tag>
                    ) : null}
                  </div>
                  {primary !== null ? (
                    <div className="proxy-result-summary">
                      <Tag>{getResultIp(primary)}</Tag>
                      <Tag>{getResultCountry(primary)}</Tag>
                      {primary.response_body?.city ? (
                        <span>{primary.response_body.city}</span>
                      ) : null}
                      {primary.response_body?.isp ? <span>{primary.response_body.isp}</span> : null}
                    </div>
                  ) : (
                    <div className="proxy-result-summary proxy-result-summary-empty">
                      <span className="proxy-result-empty">
                        {parsed !== null ? checkMessage(parsed.message) : "未检测"}
                      </span>
                    </div>
                  )}
                </div>
              )
            },
            title: "检测结果",
            width: 220,
          },
          {
            key: "region",
            render: (_value: unknown, item: MytProxy) => {
              const region = proxyDetectedRegion(item)
              return region.length === 0 ? "-" : region
            },
            title: "地区",
            width: 80,
          },
          {
            dataIndex: "bindNumber",
            key: "bindNumber",
            render: (value: number) => <b>{value || 0}</b>,
            title: "绑定数量",
            width: 100,
          },
          {
            key: "remark",
            render: (_value: unknown, item: MytProxy) => (
              <RemarkTags
                canWrite={canWrite}
                onChange={(name) => saveProxyText(item, { remark: name })}
                removeLabel={(name) => `移除备注 ${name}`}
                value={item.remark}
              />
            ),
            title: "备注",
            width: 160,
          },
          {
            key: "time",
            render: (_value: unknown, item: MytProxy) => (
              <div className="proxy-time-cell">
                <div>过期：{expireDate(item.expiredTime)}</div>
                <div>更新：{shortDate(item.updateTime)}</div>
              </div>
            ),
            title: "时间",
            width: 150,
          },
          ...(canWrite
            ? [
                {
                  align: "center" as const,
                  fixed: "right" as const,
                  key: "actions",
                  render: (_value: unknown, item: MytProxy) => (
                    <Space size={0} wrap>
                      <Button
                        aria-label={item.favorite ? "取消收藏" : "收藏"}
                        className={
                          item.favorite
                            ? "proxy-favorite-button is-favorite"
                            : "proxy-favorite-button"
                        }
                        icon={
                          item.favorite ? <StarFilled aria-hidden /> : <StarOutlined aria-hidden />
                        }
                        onClick={() => {
                          void perform(async () => {
                            await api.save({ ...item, favorite: !item.favorite }, proxies, false)
                            message.success(item.favorite ? "已取消收藏" : "已收藏")
                          })
                        }}
                        disabled={busy}
                        size="small"
                        type="link"
                      />
                      <Button
                        icon={<PlayCircleOutlined aria-hidden />}
                        onClick={() => setRunProxy(item)}
                        size="small"
                        type="link"
                      >
                        启动
                      </Button>
                      <Button
                        disabled={item.type === "3"}
                        icon={<CopyOutlined aria-hidden />}
                        onClick={() =>
                          void perform(async () => {
                            const source = await api.credentials(item)
                            const { uuid: _uuid, revision: _revision, ...copy } = source
                            setEditRecord({
                              ...copy,
                              bindNumber: 0,
                              createTime: nowText(),
                              favorite: false,
                              id: 0,
                              result: null,
                              updateTime: nowText(),
                            })
                          })
                        }
                        size="small"
                        type="link"
                      >
                        复制
                      </Button>
                      <Button
                        icon={<EditOutlined aria-hidden />}
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => setEditRecord(await api.credentials(item)))
                        }
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
                  width: 260,
                },
              ]
            : [
                {
                  align: "center" as const,
                  fixed: "right" as const,
                  key: "actions",
                  render: (_value: unknown, item: MytProxy) => (
                    <Button
                      icon={<PlayCircleOutlined aria-hidden />}
                      onClick={() => setRunProxy(item)}
                      size="small"
                      type="link"
                    >
                      启动
                    </Button>
                  ),
                  title: "操作",
                  width: 80,
                },
              ]),
        ]}
        dataSource={filtered}
        pagination={{ ...proxyPaging.pagination, total: filtered.length }}
        rowKey="id"
        rowSelection={proxySelection}
        scroll={{ x: "max-content" }}
        size="small"
      />
      {editRecord === null ? null : (
        <ProxyFormDialog
          busy={busy}
          onCancel={() => setEditRecord(null)}
          onSubmit={(item) =>
            void perform(async () => {
              const saved = await api.save(item, proxies, true)
              message.success(item.id === 0 ? "新增成功" : "修改成功")
              setEditRecord(null)
              if (item.uuid === undefined && saved) await detectCreated([saved])
            })
          }
          proxies={proxies}
          record={editRecord}
        />
      )}
      {importOpen ? (
        <ProxyImportDialog
          nextId={nextId}
          now={nowText()}
          onCancel={() => setImportOpen(false)}
          onImported={(imported) =>
            perform(async () => {
              if (imported.length > 500) throw new Error("单次最多导入 500 条代理")
              let saved = 0
              const pending: MytProxy[] = []
              const failures: string[] = []
              for (const [index, item] of imported.entries()) {
                try {
                  const created = await api.save({ ...item, groupId: creationGroup }, proxies, true)
                  saved++
                  if (created) pending.push(created)
                } catch (error) {
                  failures.push(`第 ${index + 1} 行：${await proxyRequestError(error)}`)
                }
                if (pending.length >= 2 || index + 1 === imported.length) {
                  await detectCreated(pending.splice(0))
                }
              }
              if (failures.length > 0)
                throw new Error(
                  `已导入 ${saved} 条，失败 ${failures.length} 条。${failures.slice(0, 3).join("；")}`,
                )
              message.success(`导入成功！共导入 ${saved} 条代理`)
              setImportOpen(false)
            })
          }
        />
      ) : null}
      {batchUpdateOpen ? (
        <ProxyBatchUpdateDialog
          onCancel={() => setBatchUpdateOpen(false)}
          onSubmit={(patch) =>
            void perform(async () => {
              await persistBatch(batchUpdateByTags(selected, selectedIds, patch, nowText()))
              setBatchUpdateOpen(false)
            })
          }
        />
      ) : null}
      <BatchAssignDialog
        groupOptions={[
          batchClearOption("清除分组"),
          ...unionLabelNames(
            catalogGroups,
            tagOptions.map((item) => item.value),
          ).map((name) => ({ label: name, value: name })),
        ]}
        onCancel={() => setBatchAssignOpen(false)}
        onSubmit={applyProxyBatch}
        open={batchAssignOpen}
        remarkOptions={[
          batchClearOption("清除备注"),
          ...remarkNames.map((remark) => ({ label: remark, value: remark })),
        ]}
        selectedCount={selected.length}
      />
      {runProxy === null ? null : (
        <ProxyRunDialog
          devices={devices}
          onCancel={() => setRunProxy(null)}
          onSubmit={() => {
            message.success("正在执行:runProxy")
            setRunProxy(null)
          }}
          proxy={runProxy}
        />
      )}
      {resultView === null ? null : (
        <ProxyCheckResultDialog
          onCancel={() => setResultView(null)}
          proxyId={resultView.id}
          result={resultView.result}
        />
      )}
      {faqOpen ? <ProxyFaqDialog onCancel={() => setFaqOpen(false)} /> : null}
      {buyOpen ? <ProxyBuyDialog onCancel={() => setBuyOpen(false)} /> : null}
    </section>
  )
}
