import { combineChecks, type FilterMode } from "../../components/tables/operation-controls"
import { formatRemarks, splitRemarks } from "../labels/remark-list"

export const APP_OPTIONS = [
  { label: "Tiktok", value: "tiktok" },
  { label: "Youtube", value: "youtube" },
  { label: "Facebook", value: "facebook" },
  { label: "Instagram", value: "instagram" },
  { label: "Twitter", value: "twitter" },
] as const

export const BACKUP_APP_OPTIONS = [
  ...APP_OPTIONS,
  { label: "Reddit", value: "reddit" },
  { label: "Capcut", value: "capcut" },
] as const

export const STATUS_OPTIONS = [
  { label: "正常", value: "0" },
  { label: "封号", value: "1" },
  { label: "过期", value: "2" },
  { label: "不可见", value: "3" },
  { label: "未注册", value: "4" },
] as const

export const BACK_TYPE_OPTIONS = [
  { label: "本地备份", value: "2" },
  { label: "私有云备份", value: "3" },
  { label: "云端备份", value: "4" },
  { label: "全量备份", value: "5" },
] as const

export const QUICK_FILTER_OPTIONS = [
  { label: "无用户名", value: "noUsername" },
  { label: "无密码", value: "noPassword" },
  { label: "有密码", value: "hasPassword" },
  { label: "无2FA", value: "noTotp" },
  { label: "有2FA", value: "hasTotp" },
  { label: "在线", value: "online" },
  { label: "离线", value: "offline" },
  { label: "无代理", value: "noProxy" },
  { label: "已收藏", value: "favorite" },
] as const

export const PARSED_RESOURCE_FIELD_OPTIONS = [
  { label: "手机号", value: "phone" },
  { label: "API接码", value: "api" },
  { label: "2FA", value: "twoFA" },
  { label: "邮箱", value: "email" },
  { label: "邮箱密码", value: "emailPassword" },
  { label: "客户端ID", value: "msClientId" },
  { label: "令牌TOKEN", value: "msToken" },
  { label: "辅助邮箱", value: "assistEmail" },
  { label: "POP3用户名", value: "pop3Username" },
  { label: "POP3密码", value: "pop3Password" },
  { label: "POP3服务器", value: "pop3Server" },
] as const

export const SEQ_LIST = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

export const SEQ_EMOJI: Record<number, string> = {
  1: "1️⃣",
  2: "2️⃣",
  3: "3️⃣",
  4: "4️⃣",
  5: "5️⃣",
  6: "6️⃣",
  7: "7️⃣",
  8: "8️⃣",
}

export const RECYCLE_DAYS = 7
export const ACCOUNT_EXPORT_LIMIT = 5000
export const DEFAULT_AVATAR =
  "https://p16-va.tiktokcdn.com/musically-maliva-obj/1594805258216454~c5_100x100.jpeg"

export type AccountStatus = (typeof STATUS_OPTIONS)[number]["value"]
export type AccountBackType = (typeof BACK_TYPE_OPTIONS)[number]["value"]
export type AccountQuickFilter = (typeof QUICK_FILTER_OPTIONS)[number]["value"]
export type AssignProxyMode = "average" | "random"

export type ParsedResourceField = {
  key: string
  value: string
}

export type AccountExtra = {
  avatar: string
  create_time: number
  last_aweme: string
  nickname: string
  playBeforeYesterday: number
  playToday: number
  playTotal: number
  playYesterday: number
  region: string
  proxyLabel?: string
  signature: string
  task_id: string
  task_param_copy: { parsed_reg_resource: Record<string, string> }
}

export type AccountDevice = {
  boxGroupName?: string
  id: number
  ip: string
  name: string
  recordId?: string | undefined
  sequenceNo?: number
  serial: string
}

export type AccountProxy = {
  expiredTime: string
  id: number
  ip: string
  port: number
  recordId?: string | undefined
  remark: string
  tags?: readonly string[]
}

export type MytAccount = {
  app: string
  backKey: string
  backupName?: string
  backType: AccountBackType | ""
  createTime: string
  deleted: boolean
  deleteTime: string | null
  deviceId: number | null
  deviceSeq: number | null
  enable: boolean
  extra: AccountExtra
  favorite: boolean
  follower: number
  following: number
  id: number
  online: boolean
  password: string
  proxyId: number | null
  recordDeviceId?: string | undefined
  recordId?: string | undefined
  recordInstanceId?: string | undefined
  recordProxyId?: string | undefined
  region: string
  remark: string
  status: AccountStatus
  tag: string
  tagBucket: string[]
  totp: string
  transferKey: string
  transferred: boolean
  uid: string
  updateTime: string
  username: string
}

export type AccountQuery = {
  app: string
  backType: string
  deviceId: string
  followerGT: string
  followingGT: string
  identity: string
  proxyId: string
  quick: readonly AccountQuickFilter[]
  region: readonly string[]
  remark: string
  status: string
  tag: string
  tagBucket: readonly string[]
  transferKey: string
  uidQuery: string
  ungrouped: boolean
  unremarked: boolean
  untagged: boolean
  userRemark: string
  userRemarks: readonly string[]
  username: string
}

export type AccountTagStatistic = {
  available: number
  baned: number
  tag: string
  total: number
  transferred: number
}

export type TransferStatistic = {
  count: number
  tags: string
  transferKey: string
}

export const emptyAccountQuery = (): AccountQuery => ({
  app: "",
  backType: "",
  deviceId: "",
  followerGT: "",
  followingGT: "",
  identity: "",
  proxyId: "",
  quick: [],
  region: [],
  remark: "",
  status: "",
  tag: "",
  tagBucket: [],
  transferKey: "",
  uidQuery: "",
  ungrouped: false,
  unremarked: false,
  untagged: false,
  userRemark: "",
  userRemarks: [],
  username: "",
})

export const emptyExtra = (): AccountExtra => ({
  avatar: "",
  create_time: 0,
  last_aweme: "",
  nickname: "",
  playBeforeYesterday: 0,
  playToday: 0,
  playTotal: 0,
  playYesterday: 0,
  region: "",
  signature: "",
  task_id: "",
  task_param_copy: { parsed_reg_resource: {} },
})

const pad2 = (value: number): string => value.toString().padStart(2, "0")

export const nowText = (): string => {
  const date = new Date()
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

export const shortDate = (value: string | null): string => {
  if (value === null || value.length === 0) return "-"
  const date = new Date(value.replace(" ", "T"))
  if (Number.isNaN(date.getTime())) return value
  const now = new Date()
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000)
  if (diffDays === 0) return time
  if (diffDays === -1) return `昨天 ${time}`
  const monthDay = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  const hm = time.slice(0, 5)
  if (date.getFullYear() === now.getFullYear()) return `${monthDay} ${hm}`
  return `${date.getFullYear()}-${monthDay} ${hm}`
}

export const appLabel = (app: string): string =>
  BACKUP_APP_OPTIONS.find((option) => option.value === app)?.label ?? (app.length === 0 ? "-" : app)

export const statusLabel = (status: AccountStatus): string =>
  STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status

export const backTypeLabel = (backType: string): string =>
  BACK_TYPE_OPTIONS.find((option) => option.value === backType)?.label ?? ""

export const hideMiddle = (value: string): string => {
  if (value.length <= 8) return value
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

export const parseUidQuery = (value: string): string[] => [
  ...new Set(value.split(/[,，\s]+/).filter((item) => item.length > 0)),
]

export const parseIdentityQuery = (value: string): string[] => [
  ...new Set(value.split(/[,，;；、|\s]+/).filter((item) => item.length > 0)),
]

export const getAvatar = (extra: AccountExtra): string =>
  extra.avatar.length === 0 ? DEFAULT_AVATAR : extra.avatar.replace("sign-", "")

export const parsedResourceFields = (extra: AccountExtra): ParsedResourceField[] =>
  Object.entries(extra.task_param_copy.parsed_reg_resource).map(([key, value]) => ({ key, value }))

export const applyParsedResourceFields = (
  extra: AccountExtra,
  fields: readonly ParsedResourceField[],
): AccountExtra | string => {
  const data: Record<string, string> = {}
  const seen = new Set<string>()
  for (const field of fields) {
    const key = field.key.trim()
    if (key.length === 0) continue
    if (seen.has(key)) return key
    seen.add(key)
    data[key] = field.value
  }
  return {
    ...extra,
    task_param_copy: { parsed_reg_resource: data },
  }
}

export const accountDevice = (
  devices: readonly AccountDevice[],
  deviceId: number | null,
): AccountDevice | null => devices.find((device) => device.id === deviceId) ?? null

export const accountProxy = (
  proxies: readonly AccountProxy[],
  proxyId: number | null,
): AccountProxy | null => proxies.find((proxy) => proxy.id === proxyId) ?? null

export const formatProxyOptionLabel = (proxy: AccountProxy, usedCount: number): string =>
  `[ID:${proxy.id}] ${proxy.ip}:${proxy.port} (备注:${formatRemarks(proxy.remark)}) - (绑定:${usedCount})`

export const proxyUsedCounts = (accounts: readonly MytAccount[]): Map<number, number> => {
  const counts = new Map<number, number>()
  for (const account of accounts) {
    if (account.deleted || account.proxyId === null) continue
    counts.set(account.proxyId, (counts.get(account.proxyId) ?? 0) + 1)
  }
  return counts
}

export const uniqueTags = (accounts: readonly MytAccount[]): string[] =>
  [
    ...new Set(
      accounts.filter((item) => !item.deleted && item.tag.length > 0).map((item) => item.tag),
    ),
  ].sort((left, right) => left.localeCompare(right, "zh-CN"))

export const uniqueTagBuckets = (accounts: readonly MytAccount[]): string[] =>
  [
    ...new Set(
      accounts
        .filter((item) => !item.deleted)
        .flatMap((item) => item.tagBucket)
        .filter((tag) => tag.length > 0),
    ),
  ].sort((left, right) => left.localeCompare(right, "zh-CN"))

export const uniqueProxyTags = (proxies: readonly AccountProxy[]): string[] => [
  ...new Set(proxies.flatMap((proxy) => proxy.tags ?? []).filter((item) => item.length > 0)),
]

export const isRecentlyDeleted = (account: MytAccount, now = Date.now()): boolean => {
  if (!account.deleted || account.deleteTime === null) return false
  const deletedAt = new Date(account.deleteTime.replace(" ", "T")).getTime()
  if (Number.isNaN(deletedAt)) return false
  return now - deletedAt <= RECYCLE_DAYS * 86_400_000
}

const matchesQuick = (account: MytAccount, quick: readonly AccountQuickFilter[]): boolean => {
  for (const item of quick) {
    switch (item) {
      case "noUsername":
        if (account.username.length > 0) return false
        break
      case "noPassword":
        if (account.password.length > 0) return false
        break
      case "hasPassword":
        if (account.password.length === 0) return false
        break
      case "noTotp":
        if (account.totp.length > 0) return false
        break
      case "hasTotp":
        if (account.totp.length === 0) return false
        break
      case "online":
        if (!account.online) return false
        break
      case "offline":
        if (account.online) return false
        break
      case "noProxy":
        if (account.proxyId !== null) return false
        break
      case "favorite":
        if (!account.favorite) return false
        break
    }
  }
  return true
}

export const filterAccounts = (
  accounts: readonly MytAccount[],
  query: AccountQuery,
  recycled = false,
  mode: FilterMode = "and",
): MytAccount[] => {
  const uids = parseUidQuery(query.uidQuery)
  const identity = parseIdentityQuery(query.identity)
  const followerGT = query.followerGT.length === 0 ? null : Number(query.followerGT)
  const followingGT = query.followingGT.length === 0 ? null : Number(query.followingGT)
  const deviceId = query.deviceId.length === 0 ? null : Number(query.deviceId)
  const proxyId = query.proxyId.length === 0 ? null : Number(query.proxyId)
  return accounts.filter((account) => {
    if (recycled) {
      if (!isRecentlyDeleted(account)) return false
    } else if (account.deleted) {
      return false
    }
    const remarkParts = splitRemarks(account.remark)
    return combineChecks(mode, [
      query.ungrouped || query.tag.length > 0
        ? query.ungrouped
          ? account.tag.trim().length === 0
          : account.tag === query.tag
        : null,
      query.status.length > 0 ? account.status === query.status : null,
      query.app.length > 0 ? account.app === query.app : null,
      query.backType.length > 0 ? account.backType === query.backType : null,
      deviceId !== null ? account.deviceId === deviceId : null,
      proxyId !== null ? account.proxyId === proxyId : null,
      query.username.length > 0
        ? account.username.toLowerCase().includes(query.username.toLowerCase())
        : null,
      uids.length > 0 ? uids.includes(account.uid) : null,
      identity.length > 0
        ? identity.some(
            (token) =>
              account.username.toLowerCase() === token.toLowerCase() || account.uid === token,
          )
        : null,
      query.remark.length > 0
        ? account.remark.toLowerCase().includes(query.remark.toLowerCase())
        : null,
      query.unremarked ? remarkParts.length === 0 : null,
      ...(query.unremarked
        ? []
        : query.userRemarks.length > 0
          ? query.userRemarks.map((name) => remarkParts.includes(name))
          : query.userRemark.length > 0
            ? [remarkParts.includes(query.userRemark)]
            : []),
      ...query.region.map((region) => account.region.trim().toLowerCase() === region.toLowerCase()),
      followerGT !== null && !Number.isNaN(followerGT) ? account.follower >= followerGT : null,
      followingGT !== null && !Number.isNaN(followingGT) ? account.following >= followingGT : null,
      query.transferKey.length > 0
        ? account.transferKey.toLowerCase().includes(query.transferKey.toLowerCase())
        : null,
      query.untagged ? !account.tagBucket.some((tag) => tag.trim().length > 0) : null,
      ...(query.untagged ? [] : query.tagBucket.map((tag) => account.tagBucket.includes(tag))),
      ...query.quick.map((item) => matchesQuick(account, [item])),
    ])
  })
}

export const accountStatistics = (accounts: readonly MytAccount[]): AccountTagStatistic[] => {
  const grouped = new Map<string, AccountTagStatistic>()
  for (const account of accounts) {
    if (account.deleted) continue
    const tag = account.tag.length === 0 ? "未分组" : account.tag
    const current = grouped.get(tag) ?? {
      available: 0,
      baned: 0,
      tag,
      total: 0,
      transferred: 0,
    }
    current.total += 1
    if (account.status === "1") current.baned += 1
    else if (account.status !== "4") current.available += 1
    if (account.transferred) current.transferred += 1
    grouped.set(tag, current)
  }
  return [...grouped.values()]
}

export const bannedRate = (row: AccountTagStatistic): number =>
  row.total === 0 ? 0 : Math.floor((row.baned / row.total) * 100)

export const transferStatistics = (accounts: readonly MytAccount[]): TransferStatistic[] => {
  const grouped = new Map<string, { count: number; tags: Set<string> }>()
  for (const account of accounts) {
    if (account.deleted || account.transferKey.length === 0) continue
    const current = grouped.get(account.transferKey) ?? { count: 0, tags: new Set<string>() }
    current.count += 1
    if (account.tag.length > 0) current.tags.add(account.tag)
    grouped.set(account.transferKey, current)
  }
  return [...grouped.entries()].map(([transferKey, item]) => ({
    count: item.count,
    tags: [...item.tags].join(", "),
    transferKey,
  }))
}

const csvCell = (value: string | number): string => `"${String(value).replaceAll('"', '""')}"`

export const accountsToCsv = (accounts: readonly MytAccount[]): string => {
  const header = [
    "uid",
    "username",
    "app",
    "tag",
    "status",
    "follower",
    "following",
    "remark",
    "region",
    "deviceId",
    "deviceSeq",
    "proxyId",
    "backType",
    "password",
    "totp",
  ].join(",")
  const rows = accounts.map((account) =>
    [
      account.uid,
      account.username,
      appLabel(account.app),
      account.tag,
      statusLabel(account.status),
      account.follower,
      account.following,
      account.remark,
      account.region,
      account.deviceId ?? "",
      account.deviceSeq ?? "",
      account.proxyId ?? "",
      backTypeLabel(account.backType),
      account.password.length > 0 ? "已配置" : "无",
      account.totp.length > 0 ? "已配置" : "无",
    ]
      .map((value) => csvCell(value))
      .join(","),
  )
  return `\ufeff${[header, ...rows].join("\n")}`
}

export const transferStatisticsToCsv = (rows: readonly TransferStatistic[]): string => {
  const header = ["转移码", "包含分组", "剩余数量"]
  const body = rows.map((row) =>
    [row.transferKey, row.tags, row.count].map((value) => csvCell(value)).join(","),
  )
  return `\ufeff${[header.map((value) => csvCell(value)).join(","), ...body].join("\n")}`
}

export const recycleAccounts = (
  accounts: readonly MytAccount[],
  ids: readonly number[],
  deleteTime: string,
): MytAccount[] => {
  const idSet = new Set(ids)
  return accounts.map((account) =>
    idSet.has(account.id)
      ? { ...account, deleted: true, deleteTime, updateTime: deleteTime }
      : account,
  )
}

export const restoreAccounts = (
  accounts: readonly MytAccount[],
  ids: readonly number[],
  updateTime: string,
): MytAccount[] => {
  const idSet = new Set(ids)
  return accounts.map((account) =>
    idSet.has(account.id) ? { ...account, deleted: false, deleteTime: null, updateTime } : account,
  )
}

export const deleteAccountsByTag = (
  accounts: readonly MytAccount[],
  tag: string,
  bannedOnly: boolean,
  deleteTime: string,
): MytAccount[] =>
  accounts.map((account) => {
    if (account.deleted || account.tag !== tag) return account
    if (bannedOnly && account.status !== "1") return account
    return { ...account, deleted: true, deleteTime, updateTime: deleteTime }
  })

export const resetBannedStatus = (
  accounts: readonly MytAccount[],
  tag: string,
  updateTime: string,
): MytAccount[] =>
  accounts.map((account) =>
    !account.deleted && account.tag === tag && account.status === "1"
      ? { ...account, status: "0", updateTime }
      : account,
  )

export const moveAccountTags = (
  accounts: readonly MytAccount[],
  oldTags: readonly string[],
  newTag: string,
  updateTime: string,
): MytAccount[] => {
  const oldSet = new Set(oldTags)
  return accounts.map((account) =>
    !account.deleted && oldSet.has(account.tag) ? { ...account, tag: newTag, updateTime } : account,
  )
}

export const editSelectedTag = (
  accounts: readonly MytAccount[],
  ids: readonly number[],
  newTag: string,
  updateTime: string,
): MytAccount[] => {
  const idSet = new Set(ids)
  return accounts.map((account) =>
    idSet.has(account.id) ? { ...account, tag: newTag, updateTime } : account,
  )
}

export const editSelectedRemark = (
  accounts: readonly MytAccount[],
  ids: readonly number[],
  remark: string,
  updateTime: string,
): MytAccount[] => {
  const idSet = new Set(ids)
  return accounts.map((account) =>
    idSet.has(account.id) ? { ...account, remark, updateTime } : account,
  )
}

export const editSelectedProxy = (
  accounts: readonly MytAccount[],
  ids: readonly number[],
  proxyId: number | null,
  updateTime: string,
): MytAccount[] => {
  const idSet = new Set(ids)
  return accounts.map((account) =>
    idSet.has(account.id) ? { ...account, proxyId, updateTime } : account,
  )
}

export const editSelectedRegion = (
  accounts: readonly MytAccount[],
  ids: readonly number[],
  region: string,
  updateTime: string,
): MytAccount[] => {
  const idSet = new Set(ids)
  const next = region.trim().toUpperCase()
  return accounts.map((account) =>
    idSet.has(account.id)
      ? {
          ...account,
          extra: { ...account.extra, region: next },
          region: next,
          updateTime,
        }
      : account,
  )
}

export const mutateTagBucket = (
  accounts: readonly MytAccount[],
  ids: readonly number[] | null,
  tags: readonly string[],
  mode: "add" | "remove" | "clear",
  updateTime: string,
  queryTag?: string,
): MytAccount[] => {
  const idSet = ids === null ? null : new Set(ids)
  return accounts.map((account) => {
    if (account.deleted) return account
    const matched =
      idSet === null
        ? queryTag === undefined || queryTag.length === 0 || account.tag === queryTag
        : idSet.has(account.id)
    if (!matched) return account
    if (mode === "clear") return { ...account, tagBucket: [], updateTime }
    if (mode === "add") {
      return {
        ...account,
        tagBucket: [...new Set([...account.tagBucket, ...tags])],
        updateTime,
      }
    }
    const removeSet = new Set(tags)
    return {
      ...account,
      tagBucket: account.tagBucket.filter((tag) => !removeSet.has(tag)),
      updateTime,
    }
  })
}

export const assignProxies = (
  accounts: readonly MytAccount[],
  accountTags: readonly string[],
  proxyIds: readonly number[],
  mode: AssignProxyMode,
  updateTime: string,
): MytAccount[] => {
  if (proxyIds.length === 0) return [...accounts]
  const tagSet = new Set(accountTags)
  const targets = accounts.filter((account) => !account.deleted && tagSet.has(account.tag))
  const order =
    mode === "random" ? [...targets].sort(() => (Math.random() < 0.5 ? -1 : 1)) : targets
  const assigned = new Map<number, number>()
  order.forEach((account, index) => {
    const proxyId = proxyIds[index % proxyIds.length]
    if (proxyId !== undefined) assigned.set(account.id, proxyId)
  })
  return accounts.map((account) => {
    const proxyId = assigned.get(account.id)
    return proxyId === undefined ? account : { ...account, proxyId, updateTime }
  })
}

export const mergeTransferKeys = (
  accounts: readonly MytAccount[],
  sourceKeys: readonly string[],
  nextKey: string,
  updateTime: string,
): MytAccount[] => {
  const source = new Set(sourceKeys)
  return accounts.map((account) =>
    source.has(account.transferKey) ? { ...account, transferKey: nextKey, updateTime } : account,
  )
}

export const splitTransferKey = (
  accounts: readonly MytAccount[],
  transferKey: string,
  chunkSize: number,
  newKeys: readonly string[],
  updateTime: string,
): MytAccount[] => {
  const targets = accounts.filter(
    (account) => !account.deleted && account.transferKey === transferKey,
  )
  const assigned = new Map<number, string>()
  targets.forEach((account, index) => {
    const chunkIndex = Math.floor(index / chunkSize)
    const nextKey = newKeys[chunkIndex]
    if (nextKey !== undefined) assigned.set(account.id, nextKey)
  })
  return accounts.map((account) => {
    const nextKey = assigned.get(account.id)
    return nextKey === undefined ? account : { ...account, transferKey: nextKey, updateTime }
  })
}

export const revokeTransferKey = (
  accounts: readonly MytAccount[],
  transferKey: string,
  updateTime: string,
): MytAccount[] =>
  accounts.map((account) =>
    account.transferKey === transferKey ? { ...account, transferKey: "", updateTime } : account,
  )

export const createTransferKey = (): string => {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 17 + 29) % 256
  }
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")
}

export const profileLink = (account: MytAccount): { platform: string; url: string } | null => {
  if ((account.app === "tiktok" || account.app === "capcut") && account.uid.length > 0) {
    return { platform: "TikTok", url: `https://www.tiktok.com/@${account.uid}` }
  }
  if (account.app === "instagram" && account.username.length > 0) {
    return {
      platform: "Instagram",
      url: `https://www.instagram.com/${account.username.replace(/^@/, "")}/reels`,
    }
  }
  if (account.app === "youtube") {
    const handle = (account.username || account.uid).replace(/^@/, "")
    if (handle.length === 0) return null
    return { platform: "YouTube", url: `https://www.youtube.com/@${handle}` }
  }
  if (account.app === "facebook" && account.uid.length > 0) {
    return { platform: "Facebook", url: `https://www.facebook.com/${account.uid}` }
  }
  return null
}

export const createBackupAccount = (input: {
  app: string
  backType: AccountBackType
  createTime: string
  deviceId: number
  deviceSeq: number
  id: number
  password: string
  proxyId: number | null
  tag: string
  username: string
}): MytAccount => ({
  app: input.app,
  backKey: input.username.length === 0 ? `uid-${input.id}` : input.username,
  backType: input.backType,
  createTime: input.createTime,
  deleted: false,
  deleteTime: null,
  deviceId: input.deviceId,
  deviceSeq: input.deviceSeq,
  enable: true,
  extra: emptyExtra(),
  favorite: false,
  follower: 0,
  following: 0,
  id: input.id,
  online: true,
  password: input.password,
  proxyId: input.proxyId,
  region: "",
  remark: "",
  status: "0",
  tag: input.tag,
  tagBucket: [],
  totp: "",
  transferKey: "",
  transferred: false,
  uid: `backup-${input.id}`,
  updateTime: input.createTime,
  username: input.username,
})

export const createSeedAccountDevices = (): AccountDevice[] => []

export const createSeedAccountProxies = (): AccountProxy[] => []

export const createSeedAccounts = (): MytAccount[] => []
