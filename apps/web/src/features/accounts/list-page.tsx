import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons"
import {
  App,
  AutoComplete,
  Avatar,
  Button,
  Card,
  Dropdown,
  Input,
  Popover,
  Space,
  Table,
  Tag,
  Tooltip,
} from "antd"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"

import "./accounts.css"
import { useFilteredRowSelection } from "../../components/tables/filtered-selection"
import {
  type FilterMode,
  type SelectionScope,
  FilterModeSwitch,
  SelectionScopeSwitch,
  combineChecks,
  pageSlice,
  useClientPagination,
} from "../../components/tables/operation-controls"
import { PageKey } from "../../lib/pages"
import { createDevicesApi } from "../devices/api"
import { createLabelsApi, labelsChanged } from "../labels/api"
import { BatchAssignDialog, batchClearOption, type BatchAssignResult } from "../labels/batch-assign-dialog"
import { addRemarks, splitRemarks } from "../labels/remark-list"
import { RemarkTags } from "../labels/remark-tags"
import { BusinessLabelFilter, LabelFilterRow, UNASSIGNED_VALUE, unionLabelNames, usageLabel } from "../labels/filter-row"
import { EditableTextTag } from "../labels/editable-text-tag"
import { accountRequestError, createAccountsApi, type OperationAccount } from "./api"
import { createProxiesApi } from "../proxies/api"
import {
  AssignProxyDialog,
  BackupDialog,
  CheckTaskDialog,
  EditProxyDialog,
  EditRegionDialog,
  EditRemarkDialog,
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
  type AccountProxy,
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
  editSelectedRemark,
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

const deviceOptionLabel = (device: AccountDevice): string => `${device.name} - ${device.ip}`

const proxyGroupName = (proxy: AccountProxy | null): string => proxy?.tags?.[0]?.trim() ?? ""

const accountDeviceName = (device: AccountDevice | null, proxy: AccountProxy | null): string => {
  const parts = [
    proxy === null ? "" : String(proxy.id),
    proxyGroupName(proxy),
    device?.sequenceNo === undefined ? "" : String(device.sequenceNo),
    device?.boxGroupName?.trim() ?? "",
  ].filter((part) => part.length > 0)
  return parts.length === 0 ? "-" : parts.join("-")
}

const accountDeviceDetail = (device: AccountDevice | null, proxy: AccountProxy | null): string => {
  const text = (value: string | number | null | undefined): string =>
    value === null || value === undefined || String(value).trim().length === 0 ? "无" : String(value)
  return [
    `代理编号: ${text(proxy?.id)}`,
    `代理分组: ${text(proxyGroupName(proxy))}`,
    `盒子序号: ${text(device?.sequenceNo)}`,
    `盒子分组: ${text(device?.boxGroupName)}`,
    `IP: ${text(device?.ip)}`,
    `序列号: ${text(device?.serial)}`,
  ].join("\n")
}

const resourceIdForText = (
  text: string,
  options: readonly { readonly id: number; readonly label: string }[],
): string => {
  const matched = options.find((item) => item.label === text)
  return matched === undefined ? "" : String(matched.id)
}

const labelIncludes = (label: string, keyword: string): boolean =>
  label.toLowerCase().includes(keyword.trim().toLowerCase())

export const AccountsListPage = ({
  canDelete,
  canWrite,
  groupId = "",
}: AccountsListPageProps): ReactNode => {
  const allowDelete = canDelete === true
  const { message, modal } = App.useApp()
  const [draft, setDraft] = useState<AccountQuery>(emptyAccountQuery)
  const [filterMode, setFilterMode] = useState<FilterMode>("and")
  const [selectionScope, setSelectionScope] = useState<SelectionScope>("all")
  const [query, setQuery] = useState<AccountQuery>(emptyAccountQuery)
  const [deviceText, setDeviceText] = useState("")
  const [proxyText, setProxyText] = useState("")
  const [accounts, setAccounts] = useState<MytAccount[]>(() => createSeedAccounts())
  const [devices, setDevices] = useState<AccountDevice[]>(() => createSeedAccountDevices())
  const [proxies, setProxies] = useState(() => createSeedAccountProxies())
  const [instanceIds, setInstanceIds] = useState<Readonly<Record<string, string>>>({})
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedIds, setSelectedIds] = useState<readonly number[]>([])
  const [editRecord, setEditRecord] = useState<MytAccount | null>(null)
  const [recycleOpen, setRecycleOpen] = useState(false)
  const [statisticsOpen, setStatisticsOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [moveTagOpen, setMoveTagOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [editTagOpen, setEditTagOpen] = useState(false)
  const [editRemarkOpen, setEditRemarkOpen] = useState(false)
  const [batchAssignOpen, setBatchAssignOpen] = useState(false)
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
  const [editRemarkValue, setEditRemarkValue] = useState("")
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
  const groupCounts = new Map<string, number>()
  const bucketCounts = new Map<string, number>()
  const remarkCounts = new Map<string, number>()
  let ungroupedAccounts = 0
  let untaggedAccounts = 0
  let unremarkedAccounts = 0
  for (const account of live) {
    const tag = account.tag.trim()
    if (tag.length === 0) ungroupedAccounts += 1
    else groupCounts.set(tag, (groupCounts.get(tag) ?? 0) + 1)
    if (account.tagBucket.length === 0) untaggedAccounts += 1
    for (const item of account.tagBucket) bucketCounts.set(item, (bucketCounts.get(item) ?? 0) + 1)
    const remarkParts = splitRemarks(account.remark)
    if (remarkParts.length === 0) unremarkedAccounts += 1
    for (const remark of remarkParts) remarkCounts.set(remark, (remarkCounts.get(remark) ?? 0) + 1)
  }
  const usedCounts = proxyUsedCounts(accounts)
  const filtered = useMemo(() => {
    const deviceKeyword = deviceText.trim()
    const proxyKeyword = proxyText.trim()
    const cardActive = [
      query.app,
      query.backType,
      query.deviceId,
      query.followerGT,
      query.followingGT,
      query.identity,
      query.proxyId,
      query.remark,
      query.status,
      query.tag,
      query.transferKey,
      query.uidQuery,
      query.userRemark,
      query.username,
    ].some((value) => value.length > 0) ||
      query.quick.length > 0 ||
      query.region.length > 0 ||
      query.tagBucket.length > 0 ||
      query.userRemarks.length > 0 ||
      query.ungrouped ||
      query.unremarked ||
      query.untagged
    return accounts.filter((account) => {
      if (account.deleted) return false
      const deviceActive = deviceKeyword.length > 0 && query.deviceId.length === 0
      const proxyActive = proxyKeyword.length > 0 && query.proxyId.length === 0
      const device = accountDevice(devices, account.deviceId)
      const proxy = accountProxy(proxies, account.proxyId)
      return combineChecks(filterMode, [
        cardActive ? filterAccounts([account], query, false, filterMode).length === 1 : null,
        deviceActive ? labelIncludes(device === null ? "" : deviceOptionLabel(device), deviceKeyword) : null,
        proxyActive
          ? labelIncludes(
              proxy === null ? "" : formatProxyOptionLabel(proxy, usedCounts.get(proxy.id) ?? 0),
              proxyKeyword,
            )
          : null,
      ])
    })
  }, [accounts, deviceText, devices, filterMode, proxies, proxyText, query, usedCounts])
  const accountPaging = useClientPagination(
    JSON.stringify([filterMode, query, deviceText, proxyText]),
  )
  const selected = accounts.filter((item) => selectedIds.includes(item.id) && !item.deleted)
  const tags = uniqueTags(accounts)
  const tagBuckets = uniqueTagBuckets(accounts)
  const [catalogTags, setCatalogTags] = useState<readonly string[]>([])
  const [catalogGroups, setCatalogGroups] = useState<readonly string[]>([])
  const [catalogRemarks, setCatalogRemarks] = useState<readonly string[]>([])
  useEffect(() => {
    const api = createLabelsApi()
    const load = (): void => {
      void api
        .list(PageKey.Accounts, "account-tag")
        .then((result) => setCatalogTags(result.groups.map((item) => item.name)))
        .catch(() => undefined)
      void api
        .list(PageKey.Accounts, "account")
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
  const tagChoices = [
    ...new Set([...catalogTags, ...tagBuckets].filter((tag) => tag.trim().length > 0)),
  ].sort((left, right) => left.localeCompare(right, "zh-CN"))
  const remarks = [
    ...new Set(accounts.flatMap((account) => (account.deleted ? [] : splitRemarks(account.remark)))),
  ].sort((left, right) => left.localeCompare(right, "zh-CN"))
  const regions = [
    ...new Set(
      accounts.flatMap((account) =>
        account.deleted || account.region.trim().length === 0 ? [] : [account.region.trim()],
      ),
    ),
  ].sort((left, right) => left.localeCompare(right))
  const statistics = accountStatistics(accounts)
  const transfers = transferStatistics(accounts)
  const nextId = Math.max(0, ...accounts.map((item) => item.id)) + 1
  const recordIdsOf = (rows: readonly MytAccount[]): string[] =>
    rows.flatMap((item) => (item.recordId === undefined ? [] : [item.recordId]))
  const deviceRecordId = (id: number | null): string | null =>
    id === null ? null : (devices.find((item) => item.id === id)?.recordId ?? null)
  const proxyRecordId = (id: number | null): string | null =>
    id === null ? null : (proxies.find((item) => item.id === id)?.recordId ?? null)
  const instanceRecordId = (deviceId: number | null, seq: number | null): string | null =>
    deviceId === null || seq === null ? null : (instanceIds[`${deviceId}:${seq}`] ?? null)
  const groupTag = (tag: string): string => (tag === "未分组" ? "" : tag)
  const rememberAccountGroup = (name: string): Promise<void> => {
    const tag = name.trim()
    if (tag.length === 0) return Promise.resolve()
    return createLabelsApi()
      .create(PageKey.Accounts, "group", tag)
      .then(() => {
        labelsChanged()
      })
      .catch(() => undefined)
  }
  const rememberAccountRemark = (name: string): Promise<void> => {
    const parts = splitRemarks(name).filter((part) => !part.includes("+"))
    if (parts.length === 0) return Promise.resolve()
    return Promise.all(
      parts.map((part) => createLabelsApi().create(PageKey.Accounts, "remark", part)),
    )
      .then(() => {
        labelsChanged()
      })
      .catch(() => undefined)
  }
  const reloadAccounts = (): void => setReloadKey((current) => current + 1)
  const reportError = (error: unknown): void => {
    void accountRequestError(error).then((text) => message.error(text))
  }
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
  const rememberAccountLabel = (kind: "group" | "remark", name: string, scope?: "account" | "account-tag"): void => {
    const value = name.trim()
    if (value.length === 0 || value.includes("+")) return
    void createLabelsApi()
      .create(PageKey.Accounts, kind === "remark" ? "remark" : "group", value, scope ?? "account")
      .then(() => labelsChanged())
      .catch(() => undefined)
  }
  const saveAccountGroup = (account: MytAccount, name: string): void => {
    if (name.includes("+")) {
      message.error("分组名称不能包含 + 符号")
      return
    }
    const apply = (): void => {
      setAccounts((current) =>
        current.map((item) => (item.id === account.id ? { ...item, tag: name } : item)),
      )
    }
    if (groupId.length === 0 || account.recordId === undefined) {
      apply()
      return
    }
    void createAccountsApi()
      .setGroup(groupId, [account.recordId], name)
      .then(() => {
        apply()
        rememberAccountLabel("group", name)
      })
      .catch(reportError)
  }
  const saveAccountTag = (account: MytAccount, previous: string | null, name: string): void => {
    if (name.includes("+")) {
      message.error("标签名称不能包含 + 符号")
      return
    }
    const apply = (): void => {
      setAccounts((current) =>
        current.map((item) => {
          if (item.id !== account.id) return item
          const without = previous === null ? item.tagBucket : item.tagBucket.filter((tag) => tag !== previous)
          return { ...item, tagBucket: name.length === 0 || without.includes(name) ? without : [...without, name] }
        }),
      )
    }
    if (groupId.length === 0 || account.recordId === undefined) {
      apply()
      return
    }
    const api = createAccountsApi()
    const run = async (): Promise<void> => {
      if (previous !== null && previous !== name) await api.updateTags(groupId, [account.recordId ?? ""], "remove", [previous])
      if (name.length > 0 && name !== previous) await api.updateTags(groupId, [account.recordId ?? ""], "add", [name])
      apply()
      rememberAccountLabel("group", name, "account-tag")
    }
    void run().catch(reportError)
  }
  const saveAccountRemark = (account: MytAccount, name: string): void => {
    if (splitRemarks(name).some((part) => part.includes("+"))) {
      message.error("备注名称不能包含 + 符号")
      return
    }
    if (name.length > 200) {
      message.error("备注总长度不能超过 200")
      return
    }
    const apply = (): void => {
      setAccounts((current) =>
        current.map((item) => (item.id === account.id ? { ...item, remark: name } : item)),
      )
    }
    if (groupId.length === 0 || account.recordId === undefined) {
      apply()
      return
    }
    void createAccountsApi()
      .setNote(groupId, [account.recordId], name)
      .then(() => {
        apply()
        for (const part of splitRemarks(name)) rememberAccountLabel("remark", part)
      })
      .catch(reportError)
  }
  const applyAccountBatch = (choice: BatchAssignResult): void => {
    const groupName = choice.group.kind === "set" ? (choice.group.values[0] ?? "") : ""
    const remarkNames = choice.remarks.kind === "set" ? [...choice.remarks.values] : []
    const tagNames = choice.tags.kind === "set" ? choice.tags.values : []
    if (groupName.includes("+")) {
      message.error("分组名称不能包含 + 符号")
      return
    }
    if (remarkNames.some((name) => name.includes("+"))) {
      message.error("备注名称不能包含 + 符号")
      return
    }
    if (tagNames.some((name) => name.includes("+"))) {
      message.error("标签名称不能包含 + 符号")
      return
    }
    const targets = selected.filter((item) => !item.deleted)
    if (
      choice.remarks.kind === "set" &&
      targets.some((item) => addRemarks(item.remark, remarkNames).length > 200)
    ) {
      message.error("备注总长度不能超过 200")
      return
    }
    const recordIds = targets.flatMap((item) => (item.recordId === undefined ? [] : [item.recordId]))
    const ids = new Set(targets.map((item) => item.id))
    const apply = (): void => {
      setAccounts((current) =>
        current.map((item) => {
          if (!ids.has(item.id)) return item
          const tagBucket =
            choice.tags.kind === "skip"
              ? item.tagBucket
              : choice.tags.kind === "clear"
                ? []
                : [...new Set([...item.tagBucket, ...choice.tags.values])]
          return {
            ...item,
            ...(choice.group.kind === "skip" ? {} : { tag: groupName }),
            ...(choice.remarks.kind === "skip"
              ? {}
              : { remark: choice.remarks.kind === "clear" ? "" : addRemarks(item.remark, remarkNames) }),
            tagBucket,
          }
        }),
      )
      setBatchAssignOpen(false)
      message.success("已分配")
    }
    if (groupId.length === 0 || recordIds.length === 0) {
      apply()
      return
    }
    const api = createAccountsApi()
    const run = async (): Promise<void> => {
      if (choice.group.kind !== "skip") {
        await api.setGroup(groupId, recordIds, groupName)
        rememberAccountLabel("group", groupName)
      }
      if (choice.remarks.kind !== "skip") {
        const notes = new Map<string, string[]>()
        for (const item of targets) {
          if (item.recordId === undefined) continue
          const note = choice.remarks.kind === "clear" ? "" : addRemarks(item.remark, remarkNames)
          notes.set(note, [...(notes.get(note) ?? []), item.recordId])
        }
        for (const [note, ids] of notes) await api.setNote(groupId, ids, note)
        for (const name of remarkNames) rememberAccountLabel("remark", name)
      }
      if (choice.tags.kind === "clear") await api.updateTags(groupId, recordIds, "clear")
      if (choice.tags.kind === "set") {
        await api.updateTags(groupId, recordIds, "add", choice.tags.values)
        for (const name of choice.tags.values) rememberAccountLabel("group", name, "account-tag")
      }
      apply()
    }
    void run().catch(reportError)
  }

  useEffect(() => {
    if (groupId.length === 0) return
    const api = createAccountsApi()
    let stop = false
    setAccounts([])
    setSelectedIds([])
    const load = async () => {
      const devicesApi = createDevicesApi()
      const [deviceRows, proxyRows, transfers, ownedBoxes] = await Promise.all([
        devicesApi.list(groupId),
        createProxiesApi().list([groupId]),
        api.listTransfers(groupId),
        devicesApi.owned().catch(() => []),
      ])
      const ownedById = new Map(ownedBoxes.map((box) => [box.id, box]))
      const nextDevices = deviceRows.map((device, index) => {
        const owned = ownedById.get(device.id)
        return {
          id: index + 1,
          ip: owned?.host ?? device.host,
          name: device.name,
          recordId: device.id,
          serial: owned?.externalId ?? "",
          ...(owned?.sequenceNo == null ? {} : { sequenceNo: owned.sequenceNo }),
          ...(owned?.boxGroupName == null || owned.boxGroupName.length === 0
            ? {}
            : { boxGroupName: owned.boxGroupName }),
        }
      })
      const nextInstances: Record<string, string> = {}
      for (const [index, device] of deviceRows.entries()) {
        for (const instance of device.instances) {
          nextInstances[`${index + 1}:${instance.index}`] = instance.id
        }
      }
      const nextProxies: AccountProxy[] = proxyRows.map((proxy) => ({
        expiredTime: proxy.expiredTime ?? "",
        id: proxy.id,
        ip: proxy.ip,
        port: Number(proxy.port) || 0,
        ...(proxy.uuid === undefined ? {} : { recordId: proxy.uuid }),
        remark: proxy.remark,
        ...(proxy.apiTags === undefined ? {} : { tags: proxy.apiTags }),
      }))
      const deviceNumber = new Map(nextDevices.flatMap((item) => [[item.recordId, item.id] as const]))
      const proxyNumber = new Map(
        nextProxies.flatMap((item) =>
          item.recordId === undefined ? [] : [[item.recordId, item.id] as const],
        ),
      )
      const transferCode = new Map<string, string>()
      for (const row of transfers) {
        for (const id of row.accountIds) transferCode.set(id, row.code)
      }
      const records: OperationAccount[] = []
      for (const deleted of [false, true]) {
        for (let page = 1; !stop; page += 1) {
          const result = await api.list({ groupId, page, pageSize: 500, deleted })
          records.push(...result.items)
          if (result.items.length === 0 || page * result.pageSize >= result.total) break
        }
      }
      const desk = records.map(toDeskAccount).map((item) => ({
        ...item,
        deviceId:
          item.recordDeviceId === undefined ? null : (deviceNumber.get(item.recordDeviceId) ?? null),
        proxyId:
          item.recordProxyId === undefined ? null : (proxyNumber.get(item.recordProxyId) ?? null),
        transferKey: item.recordId === undefined ? "" : (transferCode.get(item.recordId) ?? ""),
      }))
      const ids = desk.flatMap((item) => (item.recordId === undefined ? [] : [item.recordId]))
      const credentials = []
      for (let offset = 0; offset < ids.length && !stop; offset += 500) {
        credentials.push(...(await api.credentials(groupId, ids.slice(offset, offset + 500))))
      }
      const byId = new Map(credentials.map((item) => [item.id, item]))
      if (stop) return
      setDevices(nextDevices)
      setProxies(nextProxies)
      setInstanceIds(nextInstances)
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
  }, [groupId, message.error, reloadKey])
  useEffect(() => {
    if (groupId.length === 0) return
    let stop = false
    const refreshBindings = async (): Promise<void> => {
      const [ownedBoxes, proxyRows] = await Promise.all([
        createDevicesApi().owned().catch(() => []),
        createProxiesApi().list([groupId]).catch(() => []),
      ])
      if (stop) return
      setDevices((current) =>
        current.map((device) => {
          const owned =
            device.recordId === undefined
              ? undefined
              : ownedBoxes.find((box) => box.id === device.recordId)
          if (owned === undefined) return device
          return {
            id: device.id,
            ip: owned.host,
            name: device.name,
            serial: owned.externalId,
            ...(device.recordId === undefined ? {} : { recordId: device.recordId }),
            ...(owned.sequenceNo == null ? {} : { sequenceNo: owned.sequenceNo }),
            ...(owned.boxGroupName == null || owned.boxGroupName.length === 0
              ? {}
              : { boxGroupName: owned.boxGroupName }),
          }
        }),
      )
      setProxies((current) =>
        current.map((proxy) => {
          const fresh = proxyRows.find((row) => row.uuid === proxy.recordId || row.id === proxy.id)
          if (fresh === undefined) return proxy
          return {
            ...proxy,
            ip: fresh.ip,
            remark: fresh.remark,
            ...(fresh.apiTags === undefined ? {} : { tags: fresh.apiTags }),
          }
        }),
      )
    }
    const timer = window.setInterval(() => void refreshBindings(), 15_000)
    window.addEventListener("business-labels-changed", refreshBindings)
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void refreshBindings()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      stop = true
      window.clearInterval(timer)
      window.removeEventListener("business-labels-changed", refreshBindings)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [groupId])

  const applyQuery = (next = draft): void => {
    setDraft(next)
    setQuery(next)
  }

  const resetQuery = (): void => {
    const empty = emptyAccountQuery()
    setDeviceText("")
    setProxyText("")
    setDraft(empty)
    setQuery(empty)
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
  const accountSelection = useFilteredRowSelection({
    getCheckboxProps: (account: MytAccount) => ({
      "aria-label": `选择 ${account.username || account.uid}`,
    }),
    onChange: (keys) => setSelectedIds(keys.map((key) => Number(key))),
    pageKeys: pageSlice(filtered, accountPaging.current, accountPaging.pageSize).map((account) => account.id),
    rowKey: "id",
    rows: filtered,
    selectedKeys: selectedIds,
    selectionScope,
  })

  return (
    <section className="module-page accounts-page">
      <Card className="condition-panel filter-bar" size="small">
        <BusinessLabelFilter
          page={PageKey.Accounts}
          title="账号分组"
          system
          blankLabel={usageLabel("未分组", ungroupedAccounts)}
          options={tags.map((tag) => ({ value: tag, label: usageLabel(tag, groupCounts.get(tag) ?? 0) }))}
          value={draft.ungrouped ? UNASSIGNED_VALUE : draft.tag}
          onChange={(tag) =>
            changeSelectQuery(
              tag === UNASSIGNED_VALUE ? { tag: "", ungrouped: true } : { tag, ungrouped: false },
            )
          }
          canWrite={canWrite}
          canDelete={allowDelete}
          closable
        />
        <BusinessLabelFilter
          page={PageKey.Accounts}
          title="账号标签"
          scope="account-tag"
          multiple
          system
          blankLabel={usageLabel("未标签", untaggedAccounts)}
          options={tagBuckets.map((tag) => ({
            value: tag,
            label: usageLabel(tag, bucketCounts.get(tag) ?? 0),
          }))}
          value={draft.untagged ? [UNASSIGNED_VALUE] : draft.tagBucket}
          onChange={(tagBucket) =>
            changeSelectQuery(
              tagBucket.includes(UNASSIGNED_VALUE)
                ? { tagBucket: [], untagged: true }
                : { tagBucket, untagged: false },
            )
          }
          canWrite={canWrite}
          canDelete={allowDelete}
          closable
        />
        <BusinessLabelFilter
          page={PageKey.Accounts}
          title="用户备注"
          kind="remark"
          scope="account"
          system
          blankLabel={usageLabel("未备注", unremarkedAccounts)}
          multiple
          options={remarks.map((remark) => ({
            value: remark,
            label: usageLabel(remark, remarkCounts.get(remark) ?? 0),
          }))}
          value={draft.unremarked ? [UNASSIGNED_VALUE] : draft.userRemarks}
          onChange={(userRemarks) =>
            changeSelectQuery(
              userRemarks.includes(UNASSIGNED_VALUE)
                ? { userRemarks: [], unremarked: true }
                : { userRemarks, unremarked: false },
            )
          }
          canWrite={canWrite}
          canDelete={allowDelete}
          closable
        />
        <LabelFilterRow
          title="账号状态"
          system
          options={STATUS_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
          selected={draft.status.length === 0 ? [] : [draft.status]}
          onChange={(values) => changeSelectQuery({ status: values[0] ?? "" })}
        />
        <LabelFilterRow
          title="APP类型"
          system
          options={APP_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
          selected={draft.app.length === 0 ? [] : [draft.app]}
          onChange={(values) => changeSelectQuery({ app: values[0] ?? "" })}
        />
        <LabelFilterRow
          title="备份方式"
          system
          options={BACK_TYPE_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
          selected={draft.backType.length === 0 ? [] : [draft.backType]}
          onChange={(values) => changeSelectQuery({ backType: values[0] ?? "" })}
        />
        <LabelFilterRow
          title="快捷筛选"
          system
          multiple
          options={QUICK_FILTER_OPTIONS.map((option) => ({
            label: option.label,
            value: option.value,
          }))}
          selected={[...draft.quick]}
          onChange={(values) => changeSelectQuery({ quick: normalizeQuick(values) })}
        />
        <LabelFilterRow
          title="归属地"
          system
          multiple
          options={regions.map((region) => ({ label: region, value: region }))}
          selected={[...draft.region]}
          onChange={(region) => changeSelectQuery({ region })}
        />
        <Space className="condition-search resource-filter-row" wrap>
          <span className="filter-label">搜索</span>
          <AutoComplete
            allowClear
            aria-label="绑定设备"
            filterOption={(input, option) => labelIncludes(String(option?.value ?? ""), input)}
            onChange={(value) => {
              const text = typeof value === "string" ? value : ""
              setDeviceText(text)
              changeSelectQuery({
                deviceId: resourceIdForText(
                  text,
                  devices.map((device) => ({ id: device.id, label: deviceOptionLabel(device) })),
                ),
              })
            }}
            options={devices.map((device) => {
              const label = deviceOptionLabel(device)
              return { label, value: label }
            })}
            placeholder="绑定设备"
            style={{ width: 185 }}
            value={deviceText}
          />
          <AutoComplete
            allowClear
            aria-label="绑定代理"
            filterOption={(input, option) => labelIncludes(String(option?.value ?? ""), input)}
            onChange={(value) => {
              const text = typeof value === "string" ? value : ""
              setProxyText(text)
              changeSelectQuery({
                proxyId: resourceIdForText(
                  text,
                  proxies.map((proxy) => ({
                    id: proxy.id,
                    label: formatProxyOptionLabel(proxy, usedCounts.get(proxy.id) ?? 0),
                  })),
                ),
              })
            }}
            options={proxies.map((proxy) => {
              const label = formatProxyOptionLabel(proxy, usedCounts.get(proxy.id) ?? 0)
              return { label, value: label }
            })}
            placeholder="绑定代理"
            style={{ width: 220 }}
            value={proxyText}
          />
          <Popover
            content={
              <Input.TextArea
                aria-label="用户名 / UID 内容"
                autoSize={{ minRows: 8, maxRows: 16 }}
                onChange={(event) => changeSelectQuery({ identity: event.target.value })}
                placeholder="用户名或 UID，可用逗号、分号、空格或换行分隔"
                style={{ width: 420 }}
                value={draft.identity}
              />
            }
            placement="bottomLeft"
            trigger="click"
          >
            <Input
              aria-label="用户名 / UID"
              placeholder="用户名 / UID"
              readOnly
              style={{ width: 220, cursor: "pointer" }}
              value={draft.identity}
            />
          </Popover>
          <Input
            allowClear
            aria-label="最少粉丝数"
            onChange={(event) => changeSelectQuery({ followerGT: event.target.value })}
            placeholder="最少粉丝数"
            style={{ width: 120 }}
            value={draft.followerGT}
          />
          <Input
            allowClear
            aria-label="最少关注数"
            onChange={(event) => changeSelectQuery({ followingGT: event.target.value })}
            placeholder="最少关注数"
            style={{ width: 120 }}
            value={draft.followingGT}
          />
          <Input
            allowClear
            aria-label="转移码"
            onChange={(event) => changeSelectQuery({ transferKey: event.target.value })}
            placeholder="转移码"
            style={{ width: 180 }}
            value={draft.transferKey}
          />
          <Button onClick={resetQuery}>重置</Button>
          <FilterModeSwitch mode={filterMode} onChange={setFilterMode} />
        </Space>
      </Card>
      <div className="resource-crud-toolbar">
        <Space wrap>
          <SelectionScopeSwitch onChange={setSelectionScope} scope={selectionScope} />
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
              <Button
                disabled={selected.length === 0}
                onClick={() => setBatchAssignOpen(true)}
                type="primary"
              >
                批量分配（{selected.length}）
              </Button>
            </>
          ) : null}
        </Space>
        <Space wrap>
          <Button onClick={() => setRecycleOpen(true)}>回收站</Button>
          <Button
            icon={<DownloadOutlined aria-hidden />}
            onClick={() =>
              confirmExport(filtered.length, () => {
                if (groupId.length === 0) {
                  downloadCsv(accountsToCsv(filtered), "全部数据.csv")
                  message.success("导出成功")
                  return
                }
                void createAccountsApi()
                  .exportByIds(groupId, recordIdsOf(filtered))
                  .then((csv) => {
                    downloadCsv(csv, "全部数据.csv")
                    message.success("导出成功")
                  })
                  .catch(reportError)
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
                { key: "editRemark", label: "修改备注" },
                { key: "editProxy", label: "修改代理" },
                { key: "editRegion", label: "修改归属地" },
                { key: "showPlayStats", label: "查询播放量" },
                { key: "openProfiles", label: "批量打开主页" },
              ],
              onClick: ({ key }) => {
                if (key === "downloadSelected") {
                  confirmExport(selected.length, () => {
                    if (groupId.length === 0) {
                      downloadCsv(accountsToCsv(selected), "选中数据.csv")
                      message.success("导出成功")
                      return
                    }
                    void createAccountsApi()
                      .exportByIds(groupId, recordIdsOf(selected))
                      .then((csv) => {
                        downloadCsv(csv, "选中数据.csv")
                        message.success("导出成功")
                      })
                      .catch(reportError)
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
                if (key === "editRemark") {
                  requireSelection(() => {
                    setEditRemarkValue("")
                    setEditRemarkOpen(true)
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
              canWrite ? (
                <Space size={4} wrap>
                  {account.tagBucket.length === 0 ? (
                    <EditableTextTag
                      color="blue"
                      emptyLabel="标签"
                      name={null}
                      onCommit={(name) => saveAccountTag(account, null, name)}
                    />
                  ) : (
                    account.tagBucket.map((tag) => (
                      <EditableTextTag
                        color="blue"
                        emptyLabel="标签"
                        key={tag}
                        name={tag}
                        onCommit={(name) => saveAccountTag(account, tag, name)}
                        onRemove={() => saveAccountTag(account, tag, "")}
                        removeLabel={`移除标签 ${tag}`}
                      />
                    ))
                  )}
                </Space>
              ) : (
                account.tagBucket.map((tag) => (
                  <Tag color="success" key={tag}>
                    {tag}
                  </Tag>
                ))
              ),
            title: "标签组",
          },
          {
            key: "tag",
            render: (_value: unknown, account: MytAccount) =>
              canWrite ? (
                <EditableTextTag
                  color="orange"
                  emptyLabel="分组"
                  name={account.tag.length > 0 ? account.tag : null}
                  onCommit={(name) => saveAccountGroup(account, name)}
                  onRemove={() => saveAccountGroup(account, "")}
                  removeLabel={`移除分组 ${account.tag}`}
                />
              ) : (
                account.tag
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
            key: "remark",
            render: (_value: unknown, account: MytAccount) => {
              const label = account.extra.proxyLabel ?? ""
              return (
                <>
                  <RemarkTags
                    canWrite={canWrite}
                    onChange={(name) => saveAccountRemark(account, name)}
                    removeLabel={(name) => `移除备注 ${name}`}
                    value={account.remark}
                  />
                  {label.length === 0 ? null : <div className="muted">{label}</div>}
                </>
              )
            },
            title: "用户备注",
          },
          {
            key: "device",
            render: (_value: unknown, account: MytAccount) => {
              const device = accountDevice(devices, account.deviceId)
              const proxy = accountProxy(proxies, account.proxyId)
              return (
                <Tooltip title={<span style={{ whiteSpace: "pre-line" }}>{accountDeviceDetail(device, proxy)}</span>}>
                  <div>
                    {device === null ? (
                      accountDeviceName(device, proxy)
                    ) : (
                      <Link to="/operations/devices">{accountDeviceName(device, proxy)}</Link>
                    )}
                    {account.backType === "2" ? (
                      <span title="本地备份"> 本地</span>
                    ) : account.backType === "3" ? (
                      <span title="私有云备份"> 云</span>
                    ) : account.backType === "4" ? (
                      <span title="云端备份"> 云端</span>
                    ) : account.backType === "5" ? (
                      <span title="全量备份"> 全量</span>
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
                  const next = !account.favorite
                  const apply = () => {
                    setAccounts((current) =>
                      current.map((item) =>
                        item.id === account.id
                          ? { ...item, favorite: next, updateTime: nowText() }
                          : item,
                      ),
                    )
                    message.success("操作成功")
                  }
                  if (groupId.length === 0 || account.recordId === undefined) {
                    apply()
                    return
                  }
                  void createAccountsApi()
                    .setFavorite(groupId, [account.recordId], next)
                    .then(apply)
                    .catch(reportError)
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
        pagination={{ ...accountPaging.pagination, total: filtered.length }}
        rowKey="id"
        rowSelection={accountSelection}
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
            const recordId = account.recordId
            if (groupId.length === 0 || recordId === undefined) {
              apply()
              return
            }
            void rememberAccountGroup(account.tag)
              .then(() => rememberAccountRemark(account.remark))
              .then(() => createAccountsApi().update(groupId, recordId, accountWrite(account)))
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
            const removed = live.filter((item) => item.tag === tag).length
            const apply = () => {
              setAccounts((current) => deleteAccountsByTag(current, tag, false, nowText()))
              message.success(`删除成功,共删除${removed}个账号`)
            }
            if (groupId.length === 0) {
              apply()
              return
            }
            void createAccountsApi()
              .deleteByTag(groupId, groupTag(tag), false, typed)
              .then(() => {
                message.success(`删除成功,共删除${removed}个账号`)
                reloadAccounts()
              })
              .catch(reportError)
          }}
          onDeleteBanned={(tag) => {
            void modal.confirm({
              cancelText: "取消",
              content: "此操作将删除该分组下所有封号账号, 是否继续?",
              okText: "确定",
              onOk: () => {
                const removed = live.filter((item) => item.tag === tag && item.status === "1").length
                const apply = () => {
                  setAccounts((current) => deleteAccountsByTag(current, tag, true, nowText()))
                  message.success(`删除成功, 共删除${removed}个封号账号`)
                }
                if (groupId.length === 0) {
                  apply()
                  return
                }
                return createAccountsApi()
                  .deleteByTag(groupId, groupTag(tag), true)
                  .then(() => {
                    message.success(`删除成功, 共删除${removed}个封号账号`)
                    reloadAccounts()
                  })
                  .catch(reportError)
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
                const apply = () => {
                  setAccounts((current) => resetBannedStatus(current, tag, nowText()))
                  message.success("重置成功")
                }
                if (groupId.length === 0) {
                  apply()
                  return
                }
                return createAccountsApi()
                  .resetBanned(groupId, groupTag(tag))
                  .then(() => {
                    message.success("重置成功")
                    reloadAccounts()
                  })
                  .catch(reportError)
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
          onCreate={
            groupId.length === 0
              ? undefined
              : () => {
                  const ids = recordIdsOf(selected)
                  if (ids.length === 0) {
                    message.warning("请先选择账号")
                    return
                  }
                  void createAccountsApi()
                    .createTransfer(groupId, ids)
                    .then((result) => {
                      message.success(`已生成转移码 ${result.code}`)
                      reloadAccounts()
                    })
                    .catch(reportError)
                }
          }
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
            const apply = () => {
              setAccounts((current) => mergeTransferKeys(current, keys, next, nowText()))
              message.success("合并成功")
            }
            if (groupId.length === 0) {
              apply()
              return
            }
            void createAccountsApi()
              .mergeTransfers(groupId, keys, next)
              .then(() => {
                message.success("合并成功")
                reloadAccounts()
              })
              .catch(reportError)
          }}
          onRevoke={(key, count) => {
            void modal.confirm({
              cancelText: "取消",
              content: `此操作将撤销该转移码，影响 ${count} 个账号，撤销后这些账号将无法再使用此转移码进行转移。是否继续？`,
              okText: "确定",
              onOk: () => {
                const affected = live.filter((item) => item.transferKey === key).length
                const apply = () => {
                  setAccounts((current) => revokeTransferKey(current, key, nowText()))
                  message.success(`撤销成功，共撤销 ${affected} 个账号的转移码`)
                }
                if (groupId.length === 0) {
                  apply()
                  return
                }
                return createAccountsApi()
                  .revokeTransfer(groupId, key)
                  .then(apply)
                  .catch(reportError)
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
            const apply = () => {
              setAccounts((current) => splitTransferKey(current, key, size, keys, nowText()))
              message.success(`拆分成功，共生成 ${keys.length} 个新转移码`)
            }
            if (groupId.length === 0) {
              apply()
              return
            }
            void createAccountsApi()
              .splitTransfer(groupId, key, size)
              .then((result) => {
                message.success(`拆分成功，共生成 ${result.codes.length} 个新转移码`)
                reloadAccounts()
              })
              .catch(reportError)
          }}
          onRedeem={
            groupId.length === 0
              ? undefined
              : (code) => {
                  void createAccountsApi()
                    .redeemTransfer(groupId, code)
                    .then((result) => {
                      message.success(`兑换成功，共转入 ${result.affected} 个账号`)
                      reloadAccounts()
                    })
                    .catch(reportError)
                }
          }
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
            const apply = () => {
              setAccounts((current) => moveAccountTags(current, moveOldTags, moveNewTag, nowText()))
              message.success(`移动成功,共移动${moved}个账号`)
              setMoveTagOpen(false)
            }
            if (groupId.length === 0) {
              apply()
              return
            }
            void rememberAccountGroup(moveNewTag)
              .then(() =>
                createAccountsApi().moveGroupTags(groupId, moveOldTags.map(groupTag), moveNewTag),
              )
              .then(apply)
              .catch(reportError)
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
            const apply = () => {
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
            }
            if (groupId.length === 0) {
              apply()
              return
            }
            const next = assignProxies(
              accounts,
              assignForm.accountTags,
              assignPreview.proxyIds,
              assignForm.assignMode,
              nowText(),
            )
            const groups = new Map<string, string[]>()
            for (const account of next) {
              const previous = accounts.find((item) => item.id === account.id)
              if (previous === undefined || previous.proxyId === account.proxyId) continue
              if (account.recordId === undefined || account.proxyId === null) continue
              const proxyId = proxyRecordId(account.proxyId)
              if (proxyId === null) continue
              groups.set(proxyId, [...(groups.get(proxyId) ?? []), account.recordId])
            }
            void Promise.all(
              [...groups.entries()].map(([proxyId, ids]) =>
                createAccountsApi().assignProxy(groupId, ids, proxyId),
              ),
            )
              .then(apply)
              .catch(reportError)
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
            const apply = () => {
              setAccounts((current) => editSelectedTag(current, selectedIds, editTagValue, nowText()))
              message.success(`修改成功,共修改${selected.length}个账号`)
              setEditTagOpen(false)
            }
            if (groupId.length === 0) {
              apply()
              return
            }
            void rememberAccountGroup(editTagValue)
              .then(() =>
                createAccountsApi().setGroup(groupId, recordIdsOf(selected), editTagValue.trim()),
              )
              .then(apply)
              .catch(reportError)
          }}
          tags={tags}
          value={editTagValue}
        />
      ) : null}
      {editRemarkOpen ? (
        <EditRemarkDialog
          onCancel={() => setEditRemarkOpen(false)}
          onChange={setEditRemarkValue}
          onOk={() => {
            const remark = editRemarkValue.trim()
            const apply = () => {
              setAccounts((current) =>
                editSelectedRemark(current, selectedIds, remark, nowText()),
              )
              message.success(`修改成功,共修改${selected.length}个账号`)
              setEditRemarkOpen(false)
            }
            if (groupId.length === 0) {
              apply()
              return
            }
            void rememberAccountRemark(remark)
              .then(() => createAccountsApi().setNote(groupId, recordIdsOf(selected), remark))
              .then(apply)
              .catch(reportError)
          }}
          remarks={remarks}
          value={editRemarkValue}
        />
      ) : null}
      {editProxyOpen ? (
        <EditProxyDialog
          onCancel={() => setEditProxyOpen(false)}
          onChange={setEditProxyValue}
          onOk={() => {
            const apply = () => {
              setAccounts((current) =>
                editSelectedProxy(current, selectedIds, editProxyValue, nowText()),
              )
              message.success(`修改成功,共修改${selected.length}个账号`)
              setEditProxyOpen(false)
            }
            if (groupId.length === 0) {
              apply()
              return
            }
            const proxyId = proxyRecordId(editProxyValue)
            if (editProxyValue !== null && proxyId === null) {
              message.error("所选代理尚未入库")
              return
            }
            void createAccountsApi()
              .assignProxy(groupId, recordIdsOf(selected), proxyId)
              .then(apply)
              .catch(reportError)
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
            const apply = () => {
              setAccounts((current) =>
                editSelectedRegion(current, selectedIds, editRegionValue, nowText()),
              )
              message.success(`修改成功,共修改${selected.length}个账号`)
              setEditRegionOpen(false)
            }
            if (groupId.length === 0) {
              apply()
              return
            }
            void createAccountsApi()
              .setRegion(groupId, recordIdsOf(selected), editRegionValue.trim())
              .then(apply)
              .catch(reportError)
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
          options={tagChoices}
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
            const finish = (account: MytAccount) => {
              setAccounts((current) => [account, ...current])
              message.success("正在执行:backup")
              if (backupForm.closeAfter) setBackupOpen(false)
            }
            if (groupId.length === 0) {
              finish(created)
              return
            }
            const deviceId = deviceRecordId(backupForm.deviceId)
            const deviceInstanceId = instanceRecordId(backupForm.deviceId, backupForm.deviceSeq)
            if (deviceId === null || deviceInstanceId === null) {
              message.error("所选设备或机位尚未入库")
              return
            }
            const knownApps = ["tiktok", "youtube", "facebook", "instagram", "twitter"] as const
            const app = knownApps.find((item) => item === backupForm.app) ?? "tiktok"
            const backupType =
              backupForm.backType === "3"
                ? "private_cloud"
                : backupForm.backType === "4"
                  ? "cloud"
                  : backupForm.backType === "5"
                    ? "full"
                    : "local"
            void createAccountsApi()
              .backup(groupId, {
                app,
                backupType,
                deviceId,
                deviceInstanceId,
                identifier: backupForm.username,
                name: backupForm.username,
                proxyId: proxyRecordId(backupForm.proxyId),
                secret: backupForm.password,
                tags: backupForm.tag.trim().length === 0 ? [] : [backupForm.tag.trim()],
              })
              .then((saved) => {
                finish({
                  ...created,
                  recordDeviceId: deviceId,
                  recordId: saved.id,
                  recordInstanceId: deviceInstanceId,
                  recordProxyId: proxyRecordId(backupForm.proxyId) ?? undefined,
                })
              })
              .catch(reportError)
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
            const finish = () => {
              const deviceId = deviceRecordId(restoreForm.deviceId)
              const instanceId = instanceRecordId(restoreForm.deviceId, restoreForm.deviceSeq)
              setAccounts((current) =>
                current.map((item) =>
                  item.id === restoreAccount.id
                    ? {
                        ...item,
                        deviceId: restoreForm.deviceId,
                        deviceSeq: restoreForm.deviceSeq,
                        proxyId: restoreForm.proxyId,
                        recordDeviceId: deviceId ?? undefined,
                        recordInstanceId: instanceId ?? undefined,
                        recordProxyId: proxyRecordId(restoreForm.proxyId) ?? undefined,
                        updateTime: nowText(),
                      }
                    : item,
                ),
              )
              message.success(`正在执行:restore-${restoreAccount.uid}`)
              if (restoreForm.closeAfter) setRestoreAccount(null)
            }
            if (groupId.length === 0 || restoreAccount.recordId === undefined) {
              finish()
              return
            }
            const deviceId = deviceRecordId(restoreForm.deviceId)
            const deviceInstanceId = instanceRecordId(restoreForm.deviceId, restoreForm.deviceSeq)
            if (deviceId === null || deviceInstanceId === null) {
              message.error("所选设备或机位尚未入库")
              return
            }
            void createAccountsApi()
              .start(groupId, restoreAccount.recordId, {
                deviceId,
                deviceInstanceId,
                proxyId: proxyRecordId(restoreForm.proxyId),
              })
              .then(finish)
              .catch(reportError)
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
      <BatchAssignDialog
        groupOptions={[
          batchClearOption("清除分组"),
          ...unionLabelNames(catalogGroups, tags).map((name) => ({ label: name, value: name })),
        ]}
        onCancel={() => setBatchAssignOpen(false)}
        onSubmit={applyAccountBatch}
        open={batchAssignOpen}
        remarkOptions={[
          batchClearOption("清除备注"),
          ...unionLabelNames(catalogRemarks, remarks).map((name) => ({ label: name, value: name })),
        ]}
        tagOptions={[
          batchClearOption("清除标签"),
          ...tagChoices.map((name) => ({ label: name, value: name })),
        ]}
        selectedCount={selected.length}
      />
    </section>
  )
}
