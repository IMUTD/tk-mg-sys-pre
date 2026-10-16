import { useEffect, useState } from "react"
import { type AccountDevice, emptyExtra, type MytAccount } from "../accounts/myt-account"
import {
  type AccountPoolsApi,
  FilterSchema,
  type PoolSource,
  type SourceFilter,
  type StoredPool,
  type StoredPoolDetails,
  type StoredPoolDevice,
} from "./api"
import { type CreatePoolQuery, emptyCreatePoolQuery, type MytTaskRes } from "./myt-task-res"

export type PoolDeskDevice = AccountDevice & { readonly recordId: string }
const dateText = (date: Date) => date.toISOString().replace("T", " ").slice(0, 19)
export const poolDevices = (items: readonly StoredPoolDevice[]): PoolDeskDevice[] =>
  items.map((item, index) => ({
    id: index + 1,
    recordId: item.id,
    ip: item.host,
    name: item.name,
    serial: item.serial,
  }))
export const sourceFilter = (
  query: CreatePoolQuery,
  devices: readonly PoolDeskDevice[],
): SourceFilter => ({
  ...query,
  backType: query.backType as SourceFilter["backType"],
  status: query.status as SourceFilter["status"],
  deviceId: devices.find((item) => item.id === query.deviceId)?.recordId ?? null,
  tag: [...query.tag],
  tagInclude: [...query.tagInclude],
  tagExclude: [...query.tagExclude],
})
export const sourceAccount = (
  item: PoolSource,
  index: number,
  devices: readonly PoolDeskDevice[],
): MytAccount => ({
  app: "tiktok",
  backKey: "",
  backType: "",
  createTime: item.updateTime,
  deleted: false,
  deleteTime: null,
  deviceId: devices.find((device) => device.recordId === item.deviceId)?.id ?? null,
  deviceSeq: item.deviceSeq,
  enable: true,
  extra: {
    ...emptyExtra(),
    nickname: item.username,
    playBeforeYesterday: item.playBeforeYesterday,
    playToday: item.playToday,
    playTotal: item.playTotal,
    playYesterday: item.playYesterday,
  },
  favorite: item.heart > 0,
  follower: item.follower,
  following: item.following,
  id: index + 1,
  recordId: item.id,
  online: item.online,
  password: "",
  proxyId: null,
  region: item.region,
  remark: item.remark,
  status: item.status,
  tag: item.tag,
  tagBucket: [...item.tagBucket],
  totp: "",
  transferKey: "",
  transferred: item.transferred,
  uid: item.uid,
  updateTime: item.updateTime,
  username: item.username,
})
const isDeskPool = (item: StoredPool): boolean =>
  item.filterCondition !== null &&
  "kind" in item.filterCondition &&
  item.filterCondition.kind === "desk"

export const deskPool = (item: StoredPool, devices: readonly PoolDeskDevice[]): MytTaskRes => ({
  accounts: [],
  progress: [],
  id: item.displayId,
  recordId: item.id,
  backType: isDeskPool(item) ? "" : item.backType,
  count: item.count,
  createTime: dateText(item.createdAt),
  deviceId: isDeskPool(item)
    ? null
    : (devices.find((device) => device.recordId === item.deviceId)?.id ?? null),
  deviceLabel: isDeskPool(item) ? "" : item.deviceLabel,
  deviceSeq: isDeskPool(item) ? null : item.deviceSeq,
  enable: true,
  expiresAt: item.expiresAt.toISOString(),
  filterCondition: item.filterCondition === null ? "" : JSON.stringify(item.filterCondition),
  key: item.key,
  remark: item.remark,
  tag:
    item.filterCondition !== null && "tag" in item.filterCondition ? item.filterCondition.tag : [],
  times: item.times,
  updateTime: dateText(item.updatedAt),
  userId: item.createdByName,
})
export const deskPoolDetails = (
  item: StoredPoolDetails,
  devices: readonly PoolDeskDevice[],
): MytTaskRes => ({
  ...deskPool(item, devices),
  accounts: item.accounts.map((account, index) => ({
    ...account,
    id: index + 1,
    recordId: account.id,
  })),
  progress: item.progress,
})

export const usePoolSources = (
  groupId: string,
  api: AccountPoolsApi,
  query: CreatePoolQuery,
  devices: readonly PoolDeskDevice[],
  pageSize = 10,
) => {
  const [page, setPage] = useState(1)
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [items, setItems] = useState<readonly MytAccount[]>([])
  const [total, setTotal] = useState(0)
  const [groups, setGroups] = useState<readonly { tag: string; total: number }[]>([])
  const filterJson = JSON.stringify(sourceFilter(query, devices))
  // biome-ignore lint/correctness/useExhaustiveDependencies: A changed filter resets server pagination.
  useEffect(() => {
    setPage(1)
  }, [filterJson])
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload explicitly refreshes server candidates.
  useEffect(() => {
    let active = true
    const filter = JSON.parse(filterJson) as SourceFilter
    setItems([])
    setTotal(0)
    setError(false)
    if (["1", "2", "4"].includes(filter.backType) && filter.deviceId === null) {
      setGroups([])
      setLoading(false)
      return
    }
    setLoading(true)
    void api
      .sources(groupId, filter, page, pageSize)
      .then((result) => {
        if (!active) return
        setItems(result.items.map((item, index) => sourceAccount(item, index, devices)))
        setTotal(result.total)
        setGroups(result.groups)
      })
      .catch(() => {
        if (active) setError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [groupId, api, devices, filterJson, page, pageSize, reload])
  return {
    items,
    total,
    groups,
    page,
    setPage,
    loading,
    error,
    refresh: () => setReload((value) => value + 1),
  }
}

export const poolFormQuery = (record: MytTaskRes): CreatePoolQuery => {
  let saved: Partial<SourceFilter> = {}
  try {
    const parsed = FilterSchema.safeParse(JSON.parse(record.filterCondition))
    if (parsed.success) saved = parsed.data
  } catch {
    // New forms and legacy records have no saved filter.
  }
  return {
    ...emptyCreatePoolQuery(),
    ...saved,
    backType: record.backType,
    deviceId: record.deviceId,
    deviceSeq: record.deviceSeq,
    tag: record.tag,
  }
}
