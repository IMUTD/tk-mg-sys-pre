import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SearchOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons"
import {
  App,
  Avatar,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from "antd"
import type { Key } from "react"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"

import "./accounts.css"
import { PageKey } from "../../lib/pages"
import { BusinessLabelFilter } from "../labels/filter-row"
import { accountRequestError, createAccountsApi, type OperationAccount } from "./api"
import {
  AssignProxyDialog,
  BackupDialog,
  CheckTaskDialog,
  EditProxyDialog,
  EditRegionDialog,
  EditTagDialog,
  MoveTagDialog,
  PlayStatsDialog,
  RestoreDialog,
  TagBucketDialog,
} from "./batch-dialogs"
import { accountWrite, applyCredential, toDeskAccount } from "./desk-account"
import { AccountFormDialog } from "./form-dialog"
import {
  ACCOUNT_EXPORT_LIMIT,
  type AccountBackType,
  type AccountDevice,
  type AccountQuery,
  type AccountQuickFilter,
  APP_OPTIONS,
  type AssignProxyMode,
  accountDevice,
  accountProxy,
  accountStatistics,
  accountsToCsv,
  appLabel,
  assignProxies,
  BACK_TYPE_OPTIONS,
  createBackupAccount,
  createSeedAccountDevices,
  createSeedAccountProxies,
  createSeedAccounts,
  createTransferKey,
  deleteAccountsByTag,
  editSelectedProxy,
  editSelectedRegion,
  editSelectedTag,
  emptyAccountQuery,
  filterAccounts,
  formatProxyOptionLabel,
  getAvatar,
  type MytAccount,
  mergeTransferKeys,
  moveAccountTags,
  mutateTagBucket,
  nowText,
  profileLink,
  proxyUsedCounts,
  QUICK_FILTER_OPTIONS,
  recycleAccounts,
  resetBannedStatus,
  restoreAccounts,
  revokeTransferKey,
  SEQ_EMOJI,
  STATUS_OPTIONS,
  shortDate,
  splitTransferKey,
  statusLabel,
  transferStatistics,
  transferStatisticsToCsv,
  uniqueTagBuckets,
  uniqueTags,
} from "./myt-account"
import { RecycleDialog } from "./recycle-dialog"
import { AccountStatisticsDialog } from "./statistics-dialog"
import { TransferDialog } from "./transfer-dialog"

type AccountsListPageProps = {
  readonly canDelete?: boolean
  readonly canWrite: boolean
  readonly groupId?: string
}

type BackupForm = {
  app: string
  backType: AccountBackType
  closeAfter: boolean
  deviceId: number | null
  deviceSeq: number | null
  openLog: boolean
  password: string
  proxyId: number | null
  tag: string
  username: string
}

type RestoreForm = {
  closeAfter: boolean
  deviceId: number | null
  deviceSeq: number | null
  openLog: boolean
  proxyId: number | null
}

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

const normalizeQuick = (value: readonly string[]): AccountQuickFilter[] => {
  const set = new Set(value)
  if (set.has("noPassword") && set.has("hasPassword")) set.delete("hasPassword")
  if (set.has("noTotp") && set.has("hasTotp")) set.delete("hasTotp")
  if (set.has("online") && set.has("offline")) set.delete("offline")
  return QUICK_FILTER_OPTIONS.map((option) => option.value).filter((item) => set.has(item))
}

const emptyBackup = (): BackupForm => ({
  app: "tiktok",
  backType: "2",
  closeAfter: true,
  deviceId: null,
  deviceSeq: null,
  openLog: false,
  password: "",
  proxyId: null,
  tag: "",
  username: "",
})

export const AccountsListPage = ({
  canDelete,
  canWrite,
  groupId = "",
}: AccountsListPageProps): ReactNode => {
  const allowDelete = canDelete === true
  const { message, modal } = App.useApp()
  const [draft, setDraft] = useState<AccountQuery>(emptyAccountQuery)
  const [query, setQuery] = useState<AccountQuery>(emptyAccountQuery)
  const [accounts, setAccounts] = useState<MytAccount[]>(() => createSeedAccounts())
  const [devices] = useState<AccountDevice[]>(() => createSeedAccountDevices())
  const [proxies] = useState(() => createSeedAccountProxies())
  const [selectedIds, setSelectedIds] = useState<readonly number[]>([])
  const [editRecord, setEditRecord] = useState<MytAccount | null>(null)
  const [recycleOpen, setRecycleOpen] = useState(false)
  const [statisticsOpen, setStatisticsOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [moveTagOpen, setMoveTagOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [editTagOpen, setEditTagOpen] = useState(false)
  const [editProxyOpen, setEditProxyOpen] = useState(false)
  const [editRegionOpen, setEditRegionOpen] = useState(false)
  const [tagBucketOpen, setTagBucketOpen] = useState<"add" | "remove" | null>(null)
  const [backupOpen, setBackupOpen] = useState(false)
  const [restoreAccount, setRestoreAccount] = useState<MytAccount | null>(null)
  const [playStatsOpen, setPlayStatsOpen] = useState(false)
  const [checkTask, setCheckTask] = useState<{
    autoStart: boolean
    tags: readonly string[]
    updateVideoData: boolean
  } | null>(null)
  const [accountInfoCount, setAccountInfoCount] = useState(128)
  const [moveOldTags, setMoveOldTags] = useState<readonly string[]>([])
  const [moveNewTag, setMoveNewTag] = useState("")
  const [assignForm, setAssignForm] = useState<{
    accountTags: readonly string[]
    assignMode: AssignProxyMode
    proxyId: number | null
    proxyTags: readonly string[]
  }>({ accountTags: [], assignMode: "average", proxyId: null, proxyTags: [] })
  const [editTagValue, setEditTagValue] = useState("")
  const [editProxyValue, setEditProxyValue] = useState<number | null>(null)
  const [editRegionValue, setEditRegionValue] = useState("")
  const [tagBucketValue, setTagBucketValue] = useState<string[]>([])
  const [backupForm, setBackupForm] = useState<BackupForm>(emptyBackup)
  const [restoreForm, setRestoreForm] = useState<RestoreForm>({
    closeAfter: true,
    deviceId: null,
    deviceSeq: null,
    openLog: false,
    proxyId: null,
  })

  const live = useMemo(() => filterAccounts(accounts, emptyAccountQuery()), [accounts])
  const filtered = useMemo(() => filterAccounts(accounts, query), [accounts, query])
  const selected = accounts.filter((item) => selectedIds.includes(item.id) && !item.deleted)
  const tags = uniqueTags(accounts)
  const tagBuckets = uniqueTagBuckets(accounts)
  const statistics = accountStatistics(accounts)
  const transfers = transferStatistics(accounts)
  const usedCounts = proxyUsedCounts(accounts)
  const nextId = Math.max(0, ...accounts.map((item) => item.id)) + 1
  const tagCountText = selected.length > 0 ? `(${selected.length})` : `(${filtered.length})`
  const tagOperationDisabled = selected.length === 0 && filtered.length > 5000
  const saveTags = async (mode: "add" | "remove" | "clear", tags: readonly string[]): Promise<void> => {
    const targets = (selected.length > 0 ? selected : filtered).filter((item) => !item.deleted)
    const deskIds = targets.map((item) => item.id)
    if (groupId.length === 0) {
      setAccounts((current) =>
        mutateTagBucket(current, selected.length > 0 ? selectedIds : null, tags, mode, nowText(), query.tag),
      )
      return
    }
    const ids = targets.flatMap((item) => (item.recordId === undefined ? [] : [item.recordId]))
    if (ids.length === 0) throw new Error("没有可写入的账号")
    await createAccountsApi().updateTags(groupId, ids, mode, mode === "clear" ? [] : tags)
    setAccounts((current) => mutateTagBucket(current, deskIds, tags, mode, nowText()))
  }

  useEffect(() => {
    if (groupId.length === 0) return
    const api = createAccountsApi()
    let stop = false
    setAccounts([])
    setSelectedIds([])
    const load = async () => {
      const records: OperationAccount[] = []
      for (const deleted of [false, true]) {
        for (let page = 1; !stop; page += 1) {
          const result = await api.list({ groupId, page, pageSize: 500, deleted })
          records.push(...result.items)
          if (result.items.length === 0 || page * result.pageSize >= result.total) break
        }
      }
      const desk = records.map(toDeskAccount)
      const ids = desk.flatMap((item) => (item.recordId === undefined ? [] : [item.recordId]))
      const credentials = []
      for (let offset = 0; offset < ids.length && !stop; offset += 500) {
        credentials.push(...(await api.credentials(groupId, ids.slice(offset, offset + 500))))
      }
      const byId = new Map(credentials.map((item) => [item.id, item]))
      if (stop) return
      setAccounts(
        desk.map((item) => {
          const credential = item.recordId === undefined ? undefined : byId.get(item.recordId)
          return credential === undefined ? item : applyCredential(item, credential)
        }),
      )
    }
    void load().catch(() => {
      if (!stop) message.error("账号加载失败")
    })
    return () => {
      stop = true
    }
  }, [groupId, message.error])

  const applyQuery = (next = draft): void => {
    setDraft(next)
    setQuery(next)
    setSelectedIds([])
  }

  const resetQuery = (): void => {
    const empty = emptyAccountQuery()
    setDraft(empty)
    setQuery(empty)
    setSelectedIds([])
  }

  const changeSelectQuery = (patch: Partial<AccountQuery>): void => {
    applyQuery({ ...draft, ...patch })
  }

  const requireSelection = (action: () => void): void => {
    if (selected.length === 0) {
      message.warning("请先选择账号")
      return
    }
    action()
  }

  const confirmExport = (count: number, run: () => void): void => {
    if (count > ACCOUNT_EXPORT_LIMIT) {
      message.warning("最多导出5000条，当前筛选或选中数据超过5000条，请缩小范围后重试")
      return
    }
    void modal.confirm({
      cancelText: "取消",
      content: `确认导出${count}条数据?`,
      okText: "确定",
      onOk: run,
      title: "提示",
    })
  }

  const recycleIds = (ids: readonly number[]): void => {
    const time = nowText()
    const recordIds = accounts.flatMap((item) =>
      ids.includes(item.id) && item.recordId !== undefined ? [item.recordId] : [],
    )
    const apply = (): void => {
      setAccounts((current) => recycleAccounts(current, ids, time))
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)))
    }
    if (groupId.length === 0 || recordIds.length === 0) {
      apply()
      return
    }
    void createAccountsApi()
      .recycle(groupId, recordIds)
      .then(apply)
      .catch(async (error: unknown) => message.error(await accountRequestError(error)))
  }

  const restoreIds = (ids: readonly number[]): void => {
    void modal.confirm({
      cancelText: "取消",
      content: `确认恢复选中的 ${ids.length} 个账号吗？`,
      okText: "确定",
      onOk: () => {
        const recordIds = accounts.flatMap((item) =>
          ids.includes(item.id) && item.recordId !== undefined ? [item.recordId] : [],
        )
        const apply = (): void => {
          setAccounts((current) => restoreAccounts(current, ids, nowText()))
          message.success(`已恢复 ${ids.length} 个账号`)
        }
        if (groupId.length === 0 || recordIds.length === 0) {
          apply()
          return
        }
        void createAccountsApi()
          .restore(groupId, recordIds)
          .then(apply)
          .catch(async (error: unknown) => message.error(await accountRequestError(error)))
      },
      title: "提示",
    })
  }

  const deleteSelected = (): void => {
    if (selected.length === 0) return
    void modal.confirm({
      cancelText: "取消",
      content: `确认删除选中的 ${selected.length} 个账号吗？删除后将进入回收站。`,
      okText: "确定",
      onOk: () => {
        recycleIds(selectedIds)
        message.success("删除成功")
      },
      title: "提示",
    })
  }

  const deleteOne = (account: MytAccount): void => {
    void modal.confirm({
      cancelText: "取消",
      content: "确定删除吗？",
      okText: "确定",
      onOk: () => {
        recycleIds([account.id])
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

  const copyValue = (value: string): void => {
    void copyText(value, () => message.success("复制成功"))
  }

  const openCheck = (tagsToCheck: readonly string[]): void => {
    const count = live.filter(
      (item) => tagsToCheck.includes(item.tag) && item.status === "0",
    ).length
    if (count > 10000) {
      message.warning("预计命中数量超过10000，请缩小范围")
      return
    }
    setCheckTask({ autoStart: false, tags: tagsToCheck, updateVideoData: false })
  }

  const assignPreview = useMemo(() => {
    const accountCount = live.filter((item) => assignForm.accountTags.includes(item.tag)).length
    const proxyIds =
      assignForm.proxyId === null
        ? proxies
            .filter((proxy) => (proxy.tags ?? []).some((tag) => assignForm.proxyTags.includes(tag)))
            .map((proxy) => proxy.id)
        : [assignForm.proxyId]
    return {
      accountCount,
      nums: proxyIds.length > 0 ? Math.ceil(accountCount / proxyIds.length) : 0,
      proxyCount: proxyIds.length,
      proxyIds,
    }
  }, [assignForm, live, proxies])

  return (
    <section className="module-page accounts-page">
      <Card className="filter-bar" size="small">
        <BusinessLabelFilter
          page={PageKey.Accounts}
          title="账号分组"
          options={tags.map((tag) => ({ value: tag, label: tag }))}
          value={draft.tag}
          onChange={(tag) => changeSelectQuery({ tag })}
          canWrite={canWrite}
          canDelete={allowDelete}
        />
        <BusinessLabelFilter
          page={PageKey.Accounts}
          title="标签"
          scope="account-tag"
          options={tagBuckets.map((tag) => ({ value: tag, label: tag }))}
          value={draft.tagBucket}
          onChange={(tagBucket) => changeSelectQuery({ tagBucket })}
          canWrite={canWrite}
          canDelete={allowDelete}
        />
        <Space className="resource-filter-row" wrap>
          <span className="filter-label">账号状态：</span>
          <Select
            allowClear
            aria-label="账号状态"
            onChange={(value: string | null) => changeSelectQuery({ status: value ?? "" })}
            options={[...STATUS_OPTIONS]}
            placeholder="账号状态"
            style={{ width: 140 }}
            value={draft.status.length === 0 ? null : draft.status}
            virtual={false}
          />
          <span className="filter-label">APP类型：</span>
          <Select
            allowClear
            aria-label="APP类型"
            onChange={(value: string | null) => changeSelectQuery({ app: value ?? "" })}
            options={[...APP_OPTIONS]}
            placeholder="APP类型"
            style={{ width: 140 }}
            value={draft.app.length === 0 ? null : draft.app}
            virtual={false}
          />
          <span className="filter-label">备份方式：</span>
          <Select
            allowClear
            aria-label="备份方式"
            onChange={(value: string | null) => changeSelectQuery({ backType: value ?? "" })}
            options={[...BACK_TYPE_OPTIONS]}
            placeholder="备份方式"
            style={{ width: 140 }}
            value={draft.backType.length === 0 ? null : draft.backType}
            virtual={false}
          />
          <span className="filter-label">绑定设备：</span>
          <Select
            allowClear
            aria-label="绑定设备"
            onChange={(value: number | null) =>
              changeSelectQuery({ deviceId: value === null ? "" : String(value) })
            }
            options={devices.map((device) => ({
              label: `${device.name} - ${device.ip}`,
              value: device.id,
            }))}
            placeholder="绑定设备"
            showSearch
            style={{ width: 185 }}
            value={draft.deviceId.length === 0 ? null : Number(draft.deviceId)}
            virtual={false}
          />
        </Space>
        <Space className="resource-filter-row quick-filters" wrap>
          <span className="filter-label">快捷筛选：</span>
          <Checkbox.Group
            onChange={(value) => changeSelectQuery({ quick: normalizeQuick(value.map(String)) })}
            options={QUICK_FILTER_OPTIONS.map((option) => ({
              label: option.label,
              value: option.value,
            }))}
            value={[...draft.quick]}
          />
        </Space>
        <Space className="resource-filter-row" wrap>
          <span className="filter-label">绑定代理：</span>
          <Select
            allowClear
            aria-label="绑定代理"
            onChange={(value: number | null) =>
              changeSelectQuery({ proxyId: value === null ? "" : String(value) })
            }
            options={proxies.map((proxy) => ({
              label: formatProxyOptionLabel(proxy, usedCounts.get(proxy.id) ?? 0),
              value: proxy.id,
            }))}
            placeholder="请选择代理"
            style={{ width: 220 }}
            value={draft.proxyId.length === 0 ? null : Number(draft.proxyId)}
            virtual={false}
          />
          <span className="filter-label">用户名</span>
          <Input
            allowClear
            aria-label="用户名"
            onChange={(event) => setDraft({ ...draft, username: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="用户名"
            style={{ width: 160 }}
            value={draft.username}
          />
          <span className="filter-label">UID</span>
          <Input
            allowClear
            aria-label="UID"
            onChange={(event) => setDraft({ ...draft, uidQuery: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="UID（逗号/空格分隔）"
            style={{ width: 200 }}
            value={draft.uidQuery}
          />
          <span className="filter-label">备注</span>
          <Input
            allowClear
            aria-label="备注筛选"
            onChange={(event) => setDraft({ ...draft, remark: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="备注"
            style={{ width: 160 }}
            value={draft.remark}
          />
          <span className="filter-label">归属地</span>
          <Input
            allowClear
            aria-label="归属地"
            onChange={(event) => setDraft({ ...draft, region: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="归属地(US,GB)"
            style={{ width: 140 }}
            value={draft.region}
          />
          <Input
            allowClear
            aria-label="最少粉丝数"
            onChange={(event) => setDraft({ ...draft, followerGT: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="最少粉丝数"
            style={{ width: 120 }}
            value={draft.followerGT}
          />
          <Input
            allowClear
            aria-label="最少关注数"
            onChange={(event) => setDraft({ ...draft, followingGT: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="最少关注数"
            style={{ width: 120 }}
            value={draft.followingGT}
          />
          <Input
            allowClear
            aria-label="转移码"
            onChange={(event) => setDraft({ ...draft, transferKey: event.target.value })}
            onPressEnter={() => applyQuery()}
            placeholder="转移码"
            style={{ width: 180 }}
            value={draft.transferKey}
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
          <Button onClick={() => setRecycleOpen(true)}>回收站</Button>
          <Button
            icon={<DownloadOutlined aria-hidden />}
            onClick={() =>
              confirmExport(filtered.length, () => {
                downloadCsv(accountsToCsv(filtered), "全部数据.csv")
                message.success("导出成功")
              })
            }
          >
            导出
          </Button>
          <Dropdown
            disabled={selected.length === 0}
            menu={{
              items: [
                { key: "downloadSelected", label: "导出选中" },
                { key: "editTag", label: "修改分组" },
                { key: "editProxy", label: "修改代理" },
                { key: "editRegion", label: "修改归属地" },
                { key: "showPlayStats", label: "查询播放量" },
                { key: "openProfiles", label: "批量打开主页" },
              ],
              onClick: ({ key }) => {
                if (key === "downloadSelected") {
                  confirmExport(selected.length, () => {
                    downloadCsv(accountsToCsv(selected), "选中数据.csv")
                    message.success("导出成功")
                  })
                  return
                }
                if (key === "editTag") {
                  requireSelection(() => {
                    setEditTagValue("")
                    setEditTagOpen(true)
                  })
                  return
                }
                if (key === "editProxy") {
                  requireSelection(() => {
                    setEditProxyValue(null)
                    setEditProxyOpen(true)
                  })
                  return
                }
                if (key === "editRegion") {
                  requireSelection(() => {
                    setEditRegionValue("")
                    setEditRegionOpen(true)
                  })
                  return
                }
                if (key === "showPlayStats") {
                  requireSelection(() => setPlayStatsOpen(true))
                  return
                }
                if (key === "openProfiles") {
                  const links = selected
                    .map((account) => profileLink(account))
                    .filter((item): item is NonNullable<typeof item> => item !== null)
                  if (links.length === 0) {
                    message.warning(
                      "选中账号中没有可打开主页的 TikTok、Instagram、YouTube 或 Facebook 账号",
                    )
                    return
                  }
                  for (const item of links) window.open(item.url, "_blank")
                  message.success(`已尝试打开 ${links.length} 个主页`)
                }
              },
            }}
            trigger={["click"]}
          >
            <Button disabled={selected.length === 0} type="primary">
              {selected.length > 0 ? `操作选中账号(${selected.length})` : "操作选中账号"}
            </Button>
          </Dropdown>
          <Button onClick={() => setStatisticsOpen(true)} type="primary">
            统计
          </Button>
          <Button onClick={() => setTransferOpen(true)} type="primary">
            转移码
          </Button>
          {canWrite ? (
            <>
              <Button
                onClick={() => {
                  setMoveOldTags([])
                  setMoveNewTag("")
                  setMoveTagOpen(true)
                }}
                type="primary"
              >
                分组整理
              </Button>
              <Button
                onClick={() => {
                  setAssignForm({
                    accountTags: [],
                    assignMode: "average",
                    proxyId: null,
                    proxyTags: [],
                  })
                  setAssignOpen(true)
                }}
                type="primary"
              >
                分配代理
              </Button>
              <Dropdown.Button
                disabled={tagOperationDisabled}
                menu={{
                  items: [
                    { key: "remove", label: `移除标签${tagCountText}` },
                    { key: "clear", label: `清理标签${tagCountText}` },
                  ],
                  onClick: ({ key }) => {
                    if (key === "remove") {
                      setTagBucketValue([])
                      setTagBucketOpen("remove")
                      return
                    }
                    void modal.confirm({
                      cancelText: "取消",
                      content: "确认清理这些账号的所有标签吗？",
                      okText: "确认清理",
                      onOk: async () => {
                        try {
                          await saveTags("clear", [])
                          message.success("已成功清理标签")
                        } catch (error: unknown) {
                          message.error(await accountRequestError(error))
                        }
                      },
                      title: "清理标签",
                    })
                  },
                }}
                onClick={() => {
                  setTagBucketValue([])
                  setTagBucketOpen("add")
                }}
              >
                添加标签{tagCountText}
              </Dropdown.Button>
              <Button
                icon={<PlusOutlined aria-hidden />}
                onClick={() => {
                  setBackupForm(emptyBackup())
                  setBackupOpen(true)
                }}
                type="primary"
              >
                手动备份
              </Button>
            </>
          ) : null}
        </Space>
      </div>
      <Table
        columns={[
          {
            key: "avatar",
            render: (_value: unknown, account: MytAccount) => (
              <Tooltip
                title={
                  <div>
                    <div>昵称:{account.extra.nickname}</div>
                    <div>签名:{account.extra.signature}</div>
                    <div>最近播放:{account.extra.last_aweme}</div>
                    <div>任务ID:{account.extra.task_id}</div>
                  </div>
                }
              >
                <div className="avatar-cell">
                  <Avatar shape="square" size={50} src={getAvatar(account.extra)} />
                  {account.extra.region.length === 0 ? null : (
                    <span
                      className={`status-indicator ${account.online ? "status-indicator-online" : "status-indicator-offline"}`}
                    >
                      {account.extra.region}
                    </span>
                  )}
                </div>
              </Tooltip>
            ),
            title: "头像",
            width: 70,
          },
          {
            key: "app",
            render: (_value: unknown, account: MytAccount) => appLabel(account.app),
            title: "APP",
            width: 100,
          },
          {
            key: "tagBucket",
            render: (_value: unknown, account: MytAccount) =>
              account.tagBucket.map((tag) => (
                <Tag
                  color="success"
                  key={tag}
                  onClick={() => copyValue(tag)}
                  style={{ cursor: "pointer" }}
                >
                  {tag}
                </Tag>
              )),
            title: "标签组",
          },
          {
            key: "tag",
            render: (_value: unknown, account: MytAccount) => (
              <Tag onClick={() => copyValue(account.tag)} style={{ cursor: "pointer" }}>
                {account.tag}
              </Tag>
            ),
            title: "账号分组",
          },
          {
            key: "uid",
            render: (_value: unknown, account: MytAccount) => (
              <div className="uid-cell">
                <Button onClick={() => copyValue(account.uid)} size="small" type="link">
                  {account.uid}
                </Button>
                <div>
                  <Tag onClick={() => copyValue(account.username)}>{account.username}</Tag>
                  {account.extra.task_param_copy.parsed_reg_resource["email"] ===
                  undefined ? null : (
                    <div>{account.extra.task_param_copy.parsed_reg_resource["email"]}</div>
                  )}
                  <Tag
                    onClick={() => {
                      if (account.password.length === 0) return
                      copyValue(account.password)
                    }}
                  >
                    {account.password.length > 0 ? "复制密码" : "无密码"}
                  </Tag>
                  {account.totp.length === 0 ? null : (
                    <Tag title="已开启2FA保护" onClick={() => copyValue(account.totp)}>
                      2FA
                    </Tag>
                  )}
                </div>
              </div>
            ),
            title: "UID/账号/密码",
            width: 260,
          },
          {
            align: "center",
            dataIndex: "follower",
            key: "follower",
            sorter: (left: MytAccount, right: MytAccount) => left.follower - right.follower,
            title: "粉丝",
            width: 90,
          },
          {
            align: "center",
            dataIndex: "following",
            key: "following",
            sorter: (left: MytAccount, right: MytAccount) => left.following - right.following,
            title: "关注",
            width: 80,
          },
          {
            key: "status",
            render: (_value: unknown, account: MytAccount) => statusLabel(account.status),
            title: "状态",
            width: 80,
          },
          {
            dataIndex: "remark",
            ellipsis: true,
            key: "remark",
            render: (remark: string, account: MytAccount) => {
              const label = account.extra.proxyLabel ?? ""
              if (remark.length === 0 && label.length === 0) return "-"
              return (
                <>
                  {remark.length === 0 ? null : <div>{remark}</div>}
                  {label.length === 0 ? null : <div className="muted">{label}</div>}
                </>
              )
            },
            title: "备注",
          },
          {
            key: "device",
            render: (_value: unknown, account: MytAccount) => {
              const device = accountDevice(devices, account.deviceId)
              const proxy = accountProxy(proxies, account.proxyId)
              return (
                <Tooltip
                  title={
                    <div>
                      <div>代理:{proxy === null ? "" : `[${proxy.id}]-${proxy.remark}`}</div>
                      {device === null ? null : (
                        <>
                          <div>IP:{device.ip}</div>
                          <div>序列号:{device.serial}</div>
                          <div>点击进入设备管理页面</div>
                        </>
                      )}
                    </div>
                  }
                >
                  <div>
                    {proxy === null ? null : (
                      <div className="muted">{`代理:[${proxy.id}]-${proxy.remark}`}</div>
                    )}
                    {device === null ? null : (
                      <Link to="/operations/devices" title="打开设备管理">
                        {device.name}
                        {account.deviceSeq === null
                          ? ""
                          : (SEQ_EMOJI[account.deviceSeq] ?? account.deviceSeq)}
                      </Link>
                    )}
                    {account.backType === "2" ? (
                      <span title="本地备份"> 本地</span>
                    ) : account.backType === "3" ? (
                      <span title="私有云备份"> 云</span>
                    ) : null}
                  </div>
                </Tooltip>
              )
            },
            title: "设备名",
            width: 150,
          },
          {
            align: "center",
            key: "favorite",
            render: (_value: unknown, account: MytAccount) => (
              <Button
                aria-label={account.favorite ? "取消收藏" : "收藏"}
                icon={account.favorite ? <StarFilled /> : <StarOutlined />}
                onClick={() => {
                  if (!canWrite) return
                  setAccounts((current) =>
                    current.map((item) =>
                      item.id === account.id
                        ? { ...item, favorite: !item.favorite, updateTime: nowText() }
                        : item,
                    ),
                  )
                  message.success("操作成功")
                }}
                type={account.favorite ? "primary" : "default"}
              />
            ),
            title: "收藏",
            width: 70,
          },
          {
            key: "updateTime",
            render: (_value: unknown, account: MytAccount) => shortDate(account.updateTime),
            title: "更新时间",
            width: 120,
          },
          ...(canWrite
            ? [
                {
                  align: "center" as const,
                  fixed: "right" as const,
                  key: "actions",
                  render: (_value: unknown, account: MytAccount) => (
                    <Space>
                      <Button
                        icon={<PlayCircleOutlined aria-hidden />}
                        onClick={() => {
                          setRestoreForm({
                            closeAfter: true,
                            deviceId: account.deviceId,
                            deviceSeq: account.deviceSeq,
                            openLog: false,
                            proxyId: account.proxyId,
                          })
                          setRestoreAccount(account)
                        }}
                        size="small"
                        type="link"
                      >
                        启动
                      </Button>
                      <Button
                        icon={<EditOutlined aria-hidden />}
                        onClick={() => setEditRecord(account)}
                        size="small"
                        type="link"
                      >
                        编辑
                      </Button>
                      {allowDelete ? (
                        <Button danger onClick={() => deleteOne(account)} size="small" type="link">
                          删除
                        </Button>
                      ) : null}
                    </Space>
                  ),
                  title: "操作",
                  width: 210,
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
          getCheckboxProps: (account: MytAccount) => ({
            "aria-label": `选择 ${account.username || account.uid}`,
          }),
          onChange: (keys: readonly Key[]) => setSelectedIds(keys.map((key) => Number(key))),
          selectedRowKeys: [...selectedIds],
        }}
        scroll={{ x: "max-content" }}
        size="small"
      />
      {editRecord === null ? null : (
        <AccountFormDialog
          accounts={accounts}
          onCancel={() => setEditRecord(null)}
          onSubmit={(account) => {
            const apply = (): void => {
              setAccounts((current) =>
                current.map((item) =>
                  item.id === account.id ? { ...account, updateTime: nowText() } : item,
                ),
              )
              message.success("修改成功")
              setEditRecord(null)
            }
            if (groupId.length === 0 || account.recordId === undefined) {
              apply()
              return
            }
            void createAccountsApi()
              .update(groupId, account.recordId, accountWrite(account))
              .then(apply)
              .catch(async (error: unknown) => message.error(await accountRequestError(error)))
          }}
          proxies={proxies}
          record={editRecord}
        />
      )}
      {recycleOpen ? (
        <RecycleDialog
          accounts={accounts}
          canWrite={canWrite}
          onCancel={() => setRecycleOpen(false)}
          onRestore={(ids) => restoreIds(ids)}
        />
      ) : null}
      {statisticsOpen ? (
        <AccountStatisticsDialog
          accountInfoCount={accountInfoCount}
          canWrite={canWrite}
          onBatchCheck={openCheck}
          onCancel={() => setStatisticsOpen(false)}
          onCheck={(tag) => openCheck([tag])}
          onCopyTag={copyValue}
          onDeleteAll={(tag) => {
            const typed = window.prompt("此操作将删除该分组下所有账号，请输入“确认全部删除”后继续")
            if (typed !== "确认全部删除") return
            const time = nowText()
            const removed = live.filter((item) => item.tag === tag).length
            setAccounts((current) => deleteAccountsByTag(current, tag, false, time))
            message.success(`删除成功,共删除${removed}个账号`)
          }}
          onDeleteBanned={(tag) => {
            void modal.confirm({
              cancelText: "取消",
              content: "此操作将删除该分组下所有封号账号, 是否继续?",
              okText: "确定",
              onOk: () => {
                const time = nowText()
                const removed = live.filter(
                  (item) => item.tag === tag && item.status === "1",
                ).length
                setAccounts((current) => deleteAccountsByTag(current, tag, true, time))
                message.success(`删除成功, 共删除${removed}个封号账号`)
              },
              title: "提示",
            })
          }}
          onReset={(tag) => {
            void modal.confirm({
              cancelText: "取消",
              content: "此操作将重置账号封号状态,是否继续?",
              okText: "确定",
              onOk: () => {
                setAccounts((current) => resetBannedStatus(current, tag, nowText()))
                message.success("重置成功")
              },
              title: "提示",
            })
          }}
          rows={statistics}
        />
      ) : null}
      {transferOpen ? (
        <TransferDialog
          canWrite={canWrite}
          onCancel={() => setTransferOpen(false)}
          onCopy={copyValue}
          onExport={(rows) => {
            downloadCsv(transferStatisticsToCsv(rows), "转移码统计.csv")
            message.success(`导出成功，共 ${rows.length} 条记录`)
          }}
          onMerge={(keys) => {
            const input = window.prompt("请输入合并后的转移码，不输入则自动生成", "")
            if (input === null) return
            const next =
              input.trim().length === 0 ? createTransferKey() : input.trim().toLowerCase()
            if (input.trim().length > 0 && !/^[a-f0-9]{32}$/.test(next)) {
              message.error("转移码必须为32位十六进制字符")
              return
            }
            setAccounts((current) => mergeTransferKeys(current, keys, next, nowText()))
            message.success("合并成功")
          }}
          onRevoke={(key, count) => {
            void modal.confirm({
              cancelText: "取消",
              content: `此操作将撤销该转移码，影响 ${count} 个账号，撤销后这些账号将无法再使用此转移码进行转移。是否继续？`,
              okText: "确定",
              onOk: () => {
                const affected = live.filter((item) => item.transferKey === key).length
                setAccounts((current) => revokeTransferKey(current, key, nowText()))
                message.success(`撤销成功，共撤销 ${affected} 个账号的转移码`)
              },
              title: "撤销转移码确认",
            })
          }}
          onSplit={(key, count) => {
            const raw = window.prompt("请输入每份数量")
            if (raw === null) return
            const size = Number(raw)
            if (!Number.isInteger(size) || size <= 0) {
              message.warning("每份数量必须为正整数")
              return
            }
            if (size >= count) {
              message.warning("每份数量必须严格小于当前转移码数量")
              return
            }
            const chunks = Math.ceil(count / size)
            const keys = Array.from({ length: chunks }, () => createTransferKey())
            setAccounts((current) => splitTransferKey(current, key, size, keys, nowText()))
            message.success(`拆分成功，共生成 ${keys.length} 个新转移码`)
          }}
          rows={transfers}
        />
      ) : null}
      {moveTagOpen ? (
        <MoveTagDialog
          newTag={moveNewTag}
          oldTags={moveOldTags}
          onCancel={() => setMoveTagOpen(false)}
          onChange={(oldTags, newTag) => {
            setMoveOldTags(oldTags)
            setMoveNewTag(newTag)
          }}
          onOk={() => {
            const moved = live.filter((item) => moveOldTags.includes(item.tag)).length
            setAccounts((current) => moveAccountTags(current, moveOldTags, moveNewTag, nowText()))
            message.success(`移动成功,共移动${moved}个账号`)
            setMoveTagOpen(false)
          }}
          tags={tags}
        />
      ) : null}
      {assignOpen ? (
        <AssignProxyDialog
          accountCount={assignPreview.accountCount}
          accountTags={assignForm.accountTags}
          assignMode={assignForm.assignMode}
          nums={assignPreview.nums}
          onCancel={() => setAssignOpen(false)}
          onChange={setAssignForm}
          onOk={() => {
            if (assignPreview.proxyIds.length === 0) {
              message.warning("请选择代理分组或目标代理")
              return
            }
            setAccounts((current) =>
              assignProxies(
                current,
                assignForm.accountTags,
                assignPreview.proxyIds,
                assignForm.assignMode,
                nowText(),
              ),
            )
            message.success(`分配成功,共分配${assignPreview.accountCount}个账号`)
            setAssignOpen(false)
          }}
          proxyCount={assignPreview.proxyCount}
          proxyId={assignForm.proxyId}
          proxyTags={assignForm.proxyTags}
          proxies={proxies}
          tags={tags}
          usedCounts={usedCounts}
        />
      ) : null}
      {editTagOpen ? (
        <EditTagDialog
          onCancel={() => setEditTagOpen(false)}
          onChange={setEditTagValue}
          onOk={() => {
            setAccounts((current) => editSelectedTag(current, selectedIds, editTagValue, nowText()))
            message.success(`修改成功,共修改${selected.length}个账号`)
            setEditTagOpen(false)
          }}
          tags={tags}
          value={editTagValue}
        />
      ) : null}
      {editProxyOpen ? (
        <EditProxyDialog
          onCancel={() => setEditProxyOpen(false)}
          onChange={setEditProxyValue}
          onOk={() => {
            setAccounts((current) =>
              editSelectedProxy(current, selectedIds, editProxyValue, nowText()),
            )
            message.success(`修改成功,共修改${selected.length}个账号`)
            setEditProxyOpen(false)
          }}
          proxies={proxies}
          usedCounts={usedCounts}
          value={editProxyValue}
        />
      ) : null}
      {editRegionOpen ? (
        <EditRegionDialog
          onCancel={() => setEditRegionOpen(false)}
          onChange={setEditRegionValue}
          onOk={() => {
            if (!/^[A-Z]{2,3}$/.test(editRegionValue.trim())) {
              message.error("请输入 2 到 3 位国家简称，如 US、GB、DE")
              return
            }
            setAccounts((current) =>
              editSelectedRegion(current, selectedIds, editRegionValue, nowText()),
            )
            message.success(`修改成功,共修改${selected.length}个账号`)
            setEditRegionOpen(false)
          }}
          value={editRegionValue}
        />
      ) : null}
      {tagBucketOpen === null ? null : (
        <TagBucketDialog
          mode={tagBucketOpen}
          onCancel={() => setTagBucketOpen(null)}
          onChange={setTagBucketValue}
          onOk={() => {
            void saveTags(tagBucketOpen, tagBucketValue)
              .then(() => {
                message.success("编辑成功")
                setTagBucketOpen(null)
              })
              .catch(async (error: unknown) => {
                message.error(await accountRequestError(error))
              })
          }}
          options={tagBuckets}
          tags={tagBucketValue}
        />
      )}
      {backupOpen ? (
        <BackupDialog
          {...backupForm}
          devices={devices}
          onCancel={() => setBackupOpen(false)}
          onChange={setBackupForm}
          onOk={() => {
            if (backupForm.deviceId === null || backupForm.deviceSeq === null) {
              message.error("请选择设备和机位")
              return
            }
            const created = createBackupAccount({
              app: backupForm.app,
              backType: backupForm.backType,
              createTime: nowText(),
              deviceId: backupForm.deviceId,
              deviceSeq: backupForm.deviceSeq,
              id: nextId,
              password: backupForm.password,
              proxyId: backupForm.proxyId,
              tag: backupForm.tag,
              username: backupForm.username,
            })
            setAccounts((current) => [created, ...current])
            message.success("正在执行:backup")
            if (backupForm.closeAfter) setBackupOpen(false)
          }}
          proxies={proxies}
          tags={tags}
          usedCounts={usedCounts}
        />
      ) : null}
      {restoreAccount === null ? null : (
        <RestoreDialog
          {...restoreForm}
          devices={devices}
          onCancel={() => setRestoreAccount(null)}
          onChange={setRestoreForm}
          onOk={() => {
            if (restoreForm.deviceId === null || restoreForm.deviceSeq === null) {
              message.error("请选择设备和机位")
              return
            }
            message.success(`正在执行:restore-${restoreAccount.uid}`)
            if (restoreForm.closeAfter) setRestoreAccount(null)
          }}
          proxies={proxies}
          title={`启动账号[${restoreAccount.uid}]`}
          usedCounts={usedCounts}
        />
      )}
      {playStatsOpen ? (
        <PlayStatsDialog
          accounts={selected.map((account) => ({
            follower: account.follower,
            playBeforeYesterday: account.extra.playBeforeYesterday,
            playToday: account.extra.playToday,
            playTotal: account.extra.playTotal,
            playYesterday: account.extra.playYesterday,
            status: account.status,
            tag: account.tag,
            uid: account.uid,
            username: account.username,
          }))}
          onCancel={() => setPlayStatsOpen(false)}
          remaining={accountInfoCount}
        />
      ) : null}
      {checkTask === null ? null : (
        <CheckTaskDialog
          accountInfoCount={accountInfoCount}
          autoStart={checkTask.autoStart}
          onCancel={() => setCheckTask(null)}
          onChange={(next) => setCheckTask({ ...checkTask, ...next })}
          onOk={() => {
            const count = live.filter(
              (item) => checkTask.tags.includes(item.tag) && item.status === "0",
            ).length
            if (count > accountInfoCount) {
              message.warning("今日剩余检测次数不足")
              return
            }
            setAccountInfoCount((current) => current - count)
            const label =
              checkTask.tags.length <= 3
                ? checkTask.tags.join("、")
                : `${checkTask.tags.slice(0, 3).join("、")} 等 ${checkTask.tags.length} 个分组`
            message.success(
              checkTask.autoStart
                ? `${label} 的检查任务已创建并自动启动`
                : `${label} 的检查任务已创建`,
            )
            setCheckTask(null)
            setStatisticsOpen(false)
          }}
          tagLabel={
            checkTask.tags.length === 0
              ? "-"
              : checkTask.tags.length <= 3
                ? checkTask.tags.join("、")
                : `${checkTask.tags.slice(0, 3).join("、")} 等 ${checkTask.tags.length} 个分组`
          }
          totalCount={
            live.filter((item) => checkTask.tags.includes(item.tag) && item.status === "0").length
          }
          updateVideoData={checkTask.updateVideoData}
        />
      )}
    </section>
  )
}
