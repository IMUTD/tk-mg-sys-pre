import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
  StarFilled,
  StarOutlined,
  UploadOutlined,
} from "@ant-design/icons"
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Input,
  Select,
  Space,
  Table,
  Tag,
} from "antd"
import type { Key } from "react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { createProxiesApi, type ProxiesApi, proxyRequestError } from "./api"

import {
  ProxyBatchTagDialog,
  ProxyBatchTurboDialog,
  ProxyBatchUpdateDialog,
  ProxyBuyDialog,
  ProxyCheckResultDialog,
  ProxyDetectDialog,
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
  editSelectedTag,
  editSelectedTurboNode,
  emptyProxy,
  emptyProxyQuery,
  endpointText,
  expireDate,
  expirePresetOptions,
  extraModeLabel,
  filterProxies,
  getModeTags,
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
  proxyTypeLabel,
  SEED_DYNAMIC_TRAFFIC,
  shortDate,
  staticProxyCount,
  turboNodeLabel,
  turboNodeProxies,
  uniqueTagOptions,
} from "./myt-proxy"
import "./proxies.css"
import { PageKey } from "../../lib/pages"
import { BusinessLabelFilter } from "../labels/filter-row"

type ProxiesListPageProps = {
  readonly groupIds?: readonly string[]
  readonly api?: ProxiesApi
  readonly canDelete?: boolean
  readonly canWrite: boolean
}

// PostgreSQL label names cannot contain NUL, so this filter cannot collide with a catalog name.
const unassignedFilter = "\0unassigned"
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

const copyText = async (value: string, onSuccess: () => void): Promise<void> => {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    /* jsdom and restricted clipboard still show success like 云大师 */
  }
  onSuccess()
}

const rowLabel = (proxy: MytProxy): string =>
  proxy.remark.length > 0 ? proxy.remark : endpointText(proxy)

export const ProxiesListPage = ({
  canDelete,
  canWrite,
  groupIds = noGroups,
  api: providedApi,
}: ProxiesListPageProps): ReactNode => {
  const allowDelete = canDelete === true
  const { message, modal } = App.useApp()
  const [draft, setDraft] = useState<ProxyQuery>(emptyProxyQuery)
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
  const [devices] = useState(() => createSeedProxyDevices())
  const [selectedIds, setSelectedIds] = useState<readonly number[]>([])
  const [editRecord, setEditRecord] = useState<MytProxy | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [batchTagOpen, setBatchTagOpen] = useState(false)
  const [batchTurboOpen, setBatchTurboOpen] = useState(false)
  const [batchUpdateOpen, setBatchUpdateOpen] = useState(false)
  const [detectIds, setDetectIds] = useState<readonly number[] | null>(null)
  const [runProxy, setRunProxy] = useState<MytProxy | null>(null)
  const [faqOpen, setFaqOpen] = useState(false)
  const [buyOpen, setBuyOpen] = useState(false)
  const [resultView, setResultView] = useState<{
    id: number
    result: NonNullable<ReturnType<typeof parseCheckResult>>
  } | null>(null)
  const expireOptions = useMemo(() => expirePresetOptions(), [])
  const filtered = useMemo(() => filterProxies(proxies, query), [proxies, query])
  const selected = proxies.filter((item) => selectedIds.includes(item.id))
  const tagOptions = uniqueTagOptions(proxies)
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
  const detectCreated = async (items: readonly MytProxy[]): Promise<void> => {
    if (items.length === 0) return
    const result = await detectProxyBatch(api, items, defaultIpLookupOptions, updateDetection)
    message.info(`IP 查询完成，成功 ${result.succeeded} 个，失败 ${result.failed} 个`)
  }

  const applyQuery = (next = draft): void => {
    setDraft(next)
    setQuery(next)
    setSelectedIds([])
  }

  const changeSelectQuery = (patch: Partial<ProxyQuery>): void => {
    applyQuery({ ...draft, ...patch })
  }

  const resetQuery = (): void => {
    const empty = emptyProxyQuery()
    setDraft(empty)
    setQuery(empty)
    setSelectedIds([])
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

  return (
    <section className="module-page proxies-page">
      {loadError === null ? null : <Alert message={loadError} showIcon type="error" />}
      <Card className="filter-bar" size="small">
        <BusinessLabelFilter
          page={PageKey.Proxies}
          options={[{ value: unassignedFilter, label: "未分组" }, ...tagOptions]}
          value={draft.noTag ? unassignedFilter : draft.tag}
          onChange={(tag) =>
            changeSelectQuery({
              tag: tag === unassignedFilter ? "" : tag,
              noTag: tag === unassignedFilter,
            })
          }
          canWrite={canWrite}
          canDelete={allowDelete}
        />
        <Space className="resource-filter-row" wrap>
          {groupIds.length > 1 ? (
            <Select
              aria-label="代理权限组"
              value={creationGroup}
              options={groupIds.map((id) => ({ label: id, value: id }))}
              onChange={setCreationGroup}
              style={{ width: 180 }}
              virtual={false}
            />
          ) : null}
          <span className="filter-label">ID</span>
          <Input
            allowClear
            aria-label="ID"
            onChange={(event) => setDraft({ ...draft, id: event.target.value })}
            onPressEnter={() => applyQuery()}
            style={{ width: 85 }}
            value={draft.id}
          />
          <span className="filter-label">搜索</span>
          <Input
            allowClear
            aria-label="搜索"
            onChange={(event) => setDraft({ ...draft, search: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="IP/端口/备注/分组"
            style={{ width: 185 }}
            value={draft.search}
          />
          <span className="filter-label">类型</span>
          <Select
            allowClear
            aria-label="类型"
            onChange={(value: string | null) => changeSelectQuery({ type: value ?? "" })}
            options={PROXY_TYPE_OPTIONS.map((option) => ({
              label: option.label,
              value: option.value,
            }))}
            placeholder="类型"
            style={{ width: 120 }}
            value={draft.type.length === 0 ? null : draft.type}
            virtual={false}
          />
          <span className="filter-label">节流</span>
          <Select
            allowClear
            aria-label="节流"
            onChange={(value: string | null) => changeSelectQuery({ save: value ?? "" })}
            options={ENABLE_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
            placeholder="节流"
            style={{ width: 110 }}
            value={draft.save.length === 0 ? null : draft.save}
            virtual={false}
          />
          <span className="filter-label">TUN模式</span>
          <Select
            allowClear
            aria-label="TUN模式"
            onChange={(value: string | null) => changeSelectQuery({ tun: value ?? "" })}
            options={ENABLE_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
            placeholder="TUN模式"
            style={{ width: 120 }}
            value={draft.tun.length === 0 ? null : draft.tun}
            virtual={false}
          />
          <span className="filter-label">加速节点</span>
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
          <span className="filter-label">过期时间</span>
          <Select
            allowClear
            aria-label="过期时间"
            onChange={(value: string | null) => changeSelectQuery({ expiredTime: value ?? "" })}
            options={expireOptions}
            placeholder="过期时间"
            style={{ width: 120 }}
            value={draft.expiredTime.length === 0 ? null : draft.expiredTime}
            virtual={false}
          />
          <Checkbox
            checked={draft.favorite}
            onChange={(event) => changeSelectQuery({ favorite: event.target.checked })}
          >
            收藏
          </Checkbox>
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
              <Dropdown
                disabled={selected.length === 0}
                menu={{
                  items: [
                    { key: "editTag", label: "修改分组" },
                    { key: "editTurbo", label: "修改加速" },
                    { key: "detect", label: "批量检测" },
                  ],
                  onClick: ({ key }) => {
                    if (key === "editTag") {
                      requireSelection(() => setBatchTagOpen(true))
                      return
                    }
                    if (key === "editTurbo") {
                      requireSelection(() => setBatchTurboOpen(true))
                      return
                    }
                    requireSelection(() => setDetectIds(selectedIds))
                  },
                }}
                trigger={["click"]}
              >
                <Button disabled={selected.length === 0} type="primary">
                  批量操作
                </Button>
              </Dropdown>
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
            render: (tag: string) => (
              <Tag
                className="proxy-tag"
                onClick={() => void copyText(tag, () => message.success("复制成功"))}
              >
                {tag.length === 0 ? "未分组" : tag}
              </Tag>
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
                      onClick={() => setDetectIds([item.id])}
                      size="small"
                      type="link"
                    >
                      检测
                    </Button>
                    {parsed !== null ? (
                      <Button
                        onClick={() => setResultView({ id: item.id, result: parsed })}
                        size="small"
                        type="link"
                      >
                        查看
                      </Button>
                    ) : null}
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
            key: "mode",
            render: (_value: unknown, item: MytProxy) => (
              <div className="proxy-mode-list">
                {getModeTags(item).map((tag) => (
                  <Tag
                    className={`proxy-mode-tag mode-${tag.key} ${tag.enabled ? "is-on" : "is-off"}`}
                    key={tag.key}
                  >
                    {tag.label}
                  </Tag>
                ))}
              </div>
            ),
            title: "模式",
            width: 140,
          },
          {
            dataIndex: "bindNumber",
            key: "bindNumber",
            render: (value: number) => <b>{value || 0}</b>,
            title: "绑定数量",
            width: 100,
          },
          {
            dataIndex: "remark",
            ellipsis: true,
            key: "remark",
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
        pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
        rowKey="id"
        rowSelection={{
          getCheckboxProps: (item: MytProxy) => ({
            "aria-label": `选择 ${rowLabel(item)}`,
          }),
          onChange: (keys: readonly Key[]) => setSelectedIds(keys.map((key) => Number(key))),
          selectedRowKeys: [...selectedIds],
        }}
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
      {batchTagOpen ? (
        <ProxyBatchTagDialog
          onCancel={() => setBatchTagOpen(false)}
          onSubmit={(tag) =>
            void perform(async () => {
              await persistBatch(editSelectedTag(selected, selectedIds, tag, nowText()))
              setBatchTagOpen(false)
            })
          }
        />
      ) : null}
      {batchTurboOpen ? (
        <ProxyBatchTurboDialog
          onCancel={() => setBatchTurboOpen(false)}
          onSubmit={(turboNode) =>
            void perform(async () => {
              await persistBatch(editSelectedTurboNode(selected, selectedIds, turboNode, nowText()))
              setBatchTurboOpen(false)
            })
          }
          proxies={proxies.filter(
            (item) =>
              !selectedIds.includes(item.id) &&
              selected.every((row) => row.groupId === item.groupId),
          )}
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
      {detectIds === null ? null : (
        <ProxyDetectDialog
          busy={busy}
          count={detectIds.length}
          onCancel={() => setDetectIds(null)}
          onSubmit={(options) =>
            void perform(async () => {
              const { succeeded, failed } = await detectProxyBatch(
                api,
                proxies.filter((row) => detectIds.includes(row.id)),
                options,
                updateDetection,
              )
              message.info(`检测完成，成功 ${succeeded} 个，失败 ${failed} 个`)
              setDetectIds(null)
            })
          }
        />
      )}
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
