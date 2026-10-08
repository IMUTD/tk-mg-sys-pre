import {
  type AccountDevice,
  nowText as accountNowText,
  shortDate as accountShortDate,
  createSeedAccountDevices,
  createSeedAccounts,
  type MytAccount,
  statusLabel,
} from "../accounts/myt-account"

export const POOL_BACK_TYPE_OPTIONS = [
  { label: "容器备份(内测)", value: "1" },
  { label: "本地备份", value: "2" },
  { label: "云端备份", value: "3" },
] as const

export const CREATE_BACK_TYPE_OPTIONS = [
  { label: "本地备份", value: "2" },
  { label: "私有云备份", value: "3" },
  { label: "全量备份", value: "4" },
  { label: "全量备份(私有云)", value: "5" },
] as const

export const DEVICE_SEQ_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

export type PoolBackType = (typeof POOL_BACK_TYPE_OPTIONS)[number]["value"]

export type PoolAccount = {
  follower: number
  following: number
  heart: number
  id: number
  recordId?: string
  statisticsState?: "stored" | "unavailable"
  online: boolean
  playBeforeYesterday: number
  playToday: number
  playTotal: number
  playYesterday: number
  proxyRemark: string
  region: string
  remark: string
  status: string
  tag: string
  tagBucket: readonly string[]
  transferred: boolean
  uid: string
  updateTime: string
  username: string
  videoPlays: readonly number[]
}

export type PoolProgress = {
  key: string
  size: number
  total: number
  round?: number
  unusedAccountIds?: readonly string[]
}

export type MytTaskRes = {
  accounts: readonly PoolAccount[]
  backType: string
  count: number
  createTime: string
  deviceId: number | null
  deviceSeq: number | null
  enable: boolean
  filterCondition: string
  id: number
  recordId?: string
  deviceLabel?: string
  expiresAt?: string
  key: string
  progress: readonly PoolProgress[]
  remark: string
  tag: readonly string[]
  times: number
  updateTime: string
  userId: number | string
}

export type TaskResQuery = {
  id: string
  key: string
  remark: string
}

export type CreatePoolQuery = {
  backType: string
  deviceId: number | null
  deviceSeq: number | null
  online: boolean | null
  status: string
  tag: readonly string[]
  tagExclude: readonly string[]
  tagInclude: readonly string[]
  tagQueryMode: "AND" | "OR"
}

export const nowText = accountNowText
export const shortDate = accountShortDate

export const emptyTaskResQuery = (): TaskResQuery => ({ id: "", key: "", remark: "" })

export const emptyCreatePoolQuery = (): CreatePoolQuery => ({
  backType: "2",
  deviceId: null,
  deviceSeq: null,
  online: null,
  status: "",
  tag: [],
  tagExclude: [],
  tagInclude: [],
  tagQueryMode: "AND",
})

export const emptyTaskRes = (id: number, now: string): MytTaskRes => ({
  accounts: [],
  backType: "2",
  count: 0,
  createTime: now,
  deviceId: null,
  deviceSeq: null,
  enable: true,
  filterCondition: "",
  id,
  key: "",
  progress: [],
  remark: "",
  tag: [],
  times: 1,
  updateTime: now,
  userId: 1,
})

export const poolBackTypeLabel = (backType: string): string => {
  const option = [...POOL_BACK_TYPE_OPTIONS, ...CREATE_BACK_TYPE_OPTIONS].find(
    (item) => item.value === backType,
  )
  return option?.label ?? "-"
}

export const deviceLabel = (
  devices: readonly AccountDevice[],
  pool: Pick<MytTaskRes, "backType" | "deviceId" | "deviceSeq" | "deviceLabel">,
): string => {
  if (pool.backType === "3" || pool.backType === "5") return "-"
  if (pool.deviceLabel)
    return pool.deviceSeq === null ? pool.deviceLabel : `${pool.deviceLabel} #${pool.deviceSeq}`
  const device = devices.find((item) => item.id === pool.deviceId)
  const name = device
    ? `${device.ip}-${device.name}`
    : pool.deviceId === null
      ? "-"
      : `设备ID:${pool.deviceId}`
  return pool.deviceSeq === null ? name : `${name} #${pool.deviceSeq}`
}

export const remainingDays = (createTime: string, now = new Date()): string => {
  const created = new Date(createTime.replace(" ", "T"))
  if (Number.isNaN(created.getTime())) return "-"
  const expire = new Date(created.getTime() + 2_592_000_000)
  const days = Math.ceil((expire.getTime() - now.getTime()) / 86_400_000)
  return days >= 0 ? `${days}天` : "过期"
}

export const allowCopy = (pool: MytTaskRes): boolean =>
  !pool.key.startsWith("gen-") || pool.filterCondition.length > 0

export const needsDevice = (backType: string): boolean =>
  backType === "1" || backType === "2" || backType === "4"

export const needsSeq = (backType: string): boolean => backType === "1"

export const canJoinPool = (account: MytAccount): boolean =>
  !account.deleted && account.enable && !account.transferred && account.transferKey.length === 0

export const validatePoolKey = (key: string): string | null => {
  const trimmed = key.trim()
  if (trimmed.length === 0) return "编码不能为空"
  if (trimmed.includes("+")) return "账号池名不能包含 +"
  return null
}

export const toPoolAccount = (account: MytAccount): PoolAccount => ({
  follower: account.follower,
  following: account.following,
  heart: account.extra.playTotal,
  id: account.id,
  ...(account.recordId === undefined ? {} : { recordId: account.recordId }),
  online: account.online,
  playBeforeYesterday: account.extra.playBeforeYesterday,
  playToday: account.extra.playToday,
  playTotal: account.extra.playTotal,
  playYesterday: account.extra.playYesterday,
  proxyRemark: account.proxyId === null ? "无代理" : `代理${account.proxyId}`,
  region: account.region,
  remark: account.remark,
  status: account.status,
  tag: account.tag,
  tagBucket: account.tagBucket,
  transferred: account.transferred || account.transferKey.length > 0,
  uid: account.uid,
  updateTime: account.updateTime,
  username: account.username,
  videoPlays: [
    account.extra.playToday,
    account.extra.playYesterday,
    account.extra.playBeforeYesterday,
  ],
})

export const uniqueAccountTags = (
  accounts: readonly MytAccount[],
): { tag: string; total: number }[] => {
  const counts = new Map<string, number>()
  for (const account of accounts) {
    if (account.deleted || account.tag.length === 0) continue
    counts.set(account.tag, (counts.get(account.tag) ?? 0) + 1)
  }
  return [...counts.entries()].map(([tag, total]) => ({ tag, total }))
}

export const uniqueTagBuckets = (accounts: readonly MytAccount[]): string[] => {
  const tags = new Set<string>()
  for (const account of accounts) {
    if (account.deleted) continue
    for (const tag of account.tagBucket) tags.add(tag)
  }
  return [...tags]
}

export const uniqueSourceTags = (
  accounts: readonly MytAccount[],
  query: CreatePoolQuery,
): { tag: string; total: number }[] => {
  if (needsDevice(query.backType) && query.deviceId === null) return []
  return uniqueAccountTags(
    accounts.filter((account) => {
      if (account.deleted) return false
      if (needsDevice(query.backType) && account.deviceId !== query.deviceId) return false
      if (query.deviceSeq !== null && account.deviceSeq !== query.deviceSeq) return false
      return true
    }),
  )
}

export const filterTaskRes = (pools: readonly MytTaskRes[], query: TaskResQuery): MytTaskRes[] =>
  pools
    .filter((item) => {
      if (query.id.trim().length > 0 && !String(item.id).includes(query.id.trim())) return false
      if (
        query.key.trim().length > 0 &&
        !item.key.toLowerCase().includes(query.key.trim().toLowerCase())
      )
        return false
      if (
        query.remark.trim().length > 0 &&
        !item.remark.toLowerCase().includes(query.remark.trim().toLowerCase())
      )
        return false
      return true
    })
    .slice()
    .sort((left, right) => right.id - left.id)

export const filterSourceAccounts = (
  accounts: readonly MytAccount[],
  query: CreatePoolQuery,
): MytAccount[] => {
  if (needsDevice(query.backType) && query.deviceId === null) return []
  return accounts.filter((account) => {
    if (account.deleted) return false
    if (!canJoinPool(account)) return false
    if (needsDevice(query.backType) && account.deviceId !== query.deviceId) return false
    if (query.deviceSeq !== null && account.deviceSeq !== query.deviceSeq) return false
    if (query.tag.length > 0 && !query.tag.includes(account.tag)) return false
    if (query.status.length > 0 && account.status !== query.status) return false
    if (query.online !== null && account.online !== query.online) return false
    if (query.tagInclude.length > 0) {
      const matched =
        query.tagQueryMode === "AND"
          ? query.tagInclude.every((tag) => account.tagBucket.includes(tag))
          : query.tagInclude.some((tag) => account.tagBucket.includes(tag))
      if (!matched) return false
    }
    if (query.tagExclude.some((tag) => account.tagBucket.includes(tag))) return false
    return true
  })
}

export const countMatchingAccounts = (
  accounts: readonly MytAccount[],
  tags: readonly string[],
  backType: string,
  deviceId: number | null,
): number => {
  if (tags.length === 0) return 0
  return filterSourceAccounts(accounts, {
    ...emptyCreatePoolQuery(),
    backType,
    deviceId,
    tag: tags,
  }).length
}

export const poolAccountsToCsv = (accounts: readonly PoolAccount[]): string => {
  const csvCell = (value: string): string => {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
    return `"${safe.replaceAll('"', '""')}"`
  }
  const header = "UID,用户名,分组,状态,粉丝,关注,播放总量,备注"
  const rows = accounts.map((item) =>
    [
      item.uid,
      item.username,
      item.tag,
      statusLabel(item.status as "0" | "1"),
      String(item.follower),
      String(item.following),
      String(item.playTotal),
      item.remark,
    ]
      .map(csvCell)
      .join(","),
  )
  return [header, ...rows].join("\n")
}

export const unusedAccountsToCsv = (pool: MytTaskRes): string => {
  const unused = new Map<string | number, PoolAccount>()
  for (const item of pool.progress) {
    const accounts =
      item.unusedAccountIds === undefined
        ? pool.accounts.filter((account) => account.tag === item.key).slice(0, item.size)
        : pool.accounts.filter(
            (account) =>
              account.recordId !== undefined && item.unusedAccountIds?.includes(account.recordId),
          )
    for (const account of accounts) unused.set(account.recordId ?? account.id, account)
  }
  return poolAccountsToCsv([...unused.values()])
}

export const createPoolFromAccounts = (
  accounts: readonly MytAccount[],
  input: {
    backType: string
    deviceId: number | null
    deviceSeq: number | null
    key: string
    remark: string
    tag: readonly string[]
    times: number
  },
  id: number,
  now: string,
): MytTaskRes => {
  const members = accounts.map(toPoolAccount)
  return {
    accounts: members,
    backType: input.backType,
    count: members.length,
    createTime: now,
    deviceId: input.deviceId,
    deviceSeq: input.deviceSeq,
    enable: true,
    filterCondition: "",
    id,
    key: input.key,
    progress: input.tag.map((tag) => ({
      key: tag,
      size: members.filter((item) => item.tag === tag).length,
      total: members.filter((item) => item.tag === tag).length,
    })),
    remark: input.remark,
    tag: input.tag,
    times: input.times,
    updateTime: now,
    userId: 1,
  }
}

export const progressPercent = (item: PoolProgress): number =>
  item.total === 0 ? 0 : Math.floor(((item.total - item.size) / item.total) * 100)

export const createSeedDevices = createSeedAccountDevices
export const createSeedSourceAccounts = createSeedAccounts
export { statusLabel }

export const createSeedTaskRes = (): MytTaskRes[] => []
