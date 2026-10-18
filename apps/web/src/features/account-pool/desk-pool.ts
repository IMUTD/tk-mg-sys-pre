import type { OperationAccount } from "../accounts/api"
import { remarkMatches, splitRemarks } from "../labels/remark-list"
import type { DeskPoolQuery } from "./api"

const QUICK_ORDER = [
  "noUsername",
  "noPassword",
  "hasPassword",
  "noTotp",
  "hasTotp",
  "online",
  "offline",
  "noProxy",
  "favorite",
] as const

const QUICK_LABELS: Record<(typeof QUICK_ORDER)[number], string> = {
  favorite: "已收藏",
  hasPassword: "有密码",
  hasTotp: "有2FA",
  noPassword: "无密码",
  noProxy: "无代理",
  noTotp: "无2FA",
  noUsername: "无用户名",
  offline: "离线",
  online: "在线",
}

const STATUS_LABELS: Record<string, string> = {
  "0": "正常",
  "1": "封号",
  "2": "过期",
  "3": "不可见",
}
const APP_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "Tiktok",
  twitter: "Twitter",
  youtube: "Youtube",
}
const BACKUP_LABELS: Record<string, string> = {
  "2": "本地备份",
  "3": "私有云备份",
  "4": "云端备份",
  "5": "全量备份",
}

const sorted = (values: readonly string[]): string[] =>
  [...new Set(values.map((item) => item.trim()).filter((item) => item.length > 0))].sort(
    (left, right) => left.localeCompare(right, "zh-CN"),
  )

export const emptyDeskQuery = (): DeskPoolQuery => ({
  app: "",
  backType: "",
  deviceId: null,
  followerGT: "",
  followingGT: "",
  identity: "",
  proxyId: null,
  quick: [],
  region: [],
  status: "",
  tag: "",
  tagBucket: [],
  transferKey: "",
  ungrouped: false,
  unremarked: false,
  untagged: false,
  userRemark: "",
  userRemarks: [],
})

export const normalizeDeskQuery = (query: DeskPoolQuery): DeskPoolQuery => ({
  ...query,
  followerGT: query.followerGT.trim().length === 0 ? "" : String(Number(query.followerGT)),
  followingGT: query.followingGT.trim().length === 0 ? "" : String(Number(query.followingGT)),
  identity: sorted(query.identity.split(/[,，;；、|\s]+/)).join("、"),
  quick: QUICK_ORDER.filter((item) => query.quick.includes(item)),
  region: sorted(query.region),
  tag: query.tag.trim(),
  tagBucket: sorted(query.tagBucket),
  transferKey: query.transferKey.trim(),
  userRemark: query.userRemark.trim(),
  userRemarks: sorted(query.userRemarks),
})

export const deskPoolKey = (
  query: DeskPoolQuery,
  labels: { readonly device: string; readonly proxy: string },
): string => {
  const parts: string[] = []
  if (query.ungrouped) parts.push("账号分组=未分组")
  else if (query.tag.length > 0) parts.push(`账号分组=${query.tag}`)
  if (query.untagged) parts.push("账号标签=未标签")
  else if (query.tagBucket.length > 0) parts.push(`账号标签=${query.tagBucket.join("、")}`)
  if (query.unremarked) parts.push("用户备注=未备注")
  else if (query.userRemarks.length > 0) parts.push(`用户备注=${query.userRemarks.join("、")}`)
  else if (query.userRemark.length > 0) parts.push(`用户备注=${query.userRemark}`)
  if (query.status.length > 0) parts.push(`账号状态=${STATUS_LABELS[query.status] ?? query.status}`)
  if (query.app.length > 0) parts.push(`APP类型=${APP_LABELS[query.app] ?? query.app}`)
  if (query.backType.length > 0)
    parts.push(`备份方式=${BACKUP_LABELS[query.backType] ?? query.backType}`)
  if (query.quick.length > 0)
    parts.push(
      `快捷筛选=${query.quick.map((item) => QUICK_LABELS[item as (typeof QUICK_ORDER)[number]] ?? item).join("、")}`,
    )
  if (query.region.length > 0) parts.push(`归属地=${query.region.join("、")}`)
  if (query.deviceId !== null) parts.push(`绑定设备=${labels.device}`)
  if (query.proxyId !== null) parts.push(`绑定代理=${labels.proxy}`)
  if (query.identity.length > 0) parts.push(`用户名 / UID=${query.identity}`)
  if (query.followerGT.length > 0) parts.push(`最少粉丝数=${query.followerGT}`)
  if (query.followingGT.length > 0) parts.push(`最少关注数=${query.followingGT}`)
  if (query.transferKey.length > 0) parts.push(`转移码=${query.transferKey}`)
  return parts.join("，")
}

export const ALL_ACCOUNTS_POOL_NAME = "全部账号"

export const resolveDeskPoolName = (auto: string, custom: string): string => {
  const typed = custom.trim()
  if (typed.length > 0) return typed
  return auto.length > 0 ? auto : ALL_ACCOUNTS_POOL_NAME
}

export const proxyEndpoint = (host: string, port: string | number): string =>
  `${host.includes(":") ? `[${host}]` : host}:${port}`

export type DeskAccountPreview = {
  readonly app: string
  readonly backType: string
  readonly deviceId: string | null
  readonly favorite: boolean
  readonly follower: number
  readonly following: number
  readonly hasPassword: boolean
  readonly hasTotp: boolean
  readonly id: string
  readonly online: boolean
  readonly proxyId: string | null
  readonly region: string
  readonly remark: string
  readonly status: "0" | "1" | "2" | "3" | "4"
  readonly tag: string
  readonly tagBucket: readonly string[]
  readonly transferCodes: readonly string[]
  readonly uid: string
  readonly username: string
}

const backupCode = (value: OperationAccount["backupType"]): string => {
  if (value === "local") return "2"
  if (value === "private_cloud") return "3"
  if (value === "cloud") return "4"
  if (value === "full") return "5"
  return ""
}

const statusCode = (value: OperationAccount["status"]): DeskAccountPreview["status"] => {
  if (value === "suspended") return "1"
  if (value === "expired") return "2"
  if (value === "hidden") return "3"
  if (value === "unregistered") return "4"
  return "0"
}

export const toDeskPreview = (
  item: OperationAccount,
  transferCodes: readonly string[] = [],
): DeskAccountPreview => ({
  app: item.app ?? "tiktok",
  backType: backupCode(item.backupType),
  deviceId: item.deviceId,
  favorite: (item.favorite ?? 0) > 0,
  follower: item.follower ?? 0,
  following: item.following ?? 0,
  hasPassword: item.hasPassword,
  hasTotp: item.hasTotp,
  id: item.id,
  online: item.online,
  proxyId: item.proxyId,
  region: item.region,
  remark: item.note,
  status: statusCode(item.status),
  tag: item.tags[0] ?? "",
  tagBucket: item.tags.slice(1).filter((tag) => tag.length > 0),
  transferCodes,
  uid: item.platformUid,
  username: item.identifier.length > 0 ? item.identifier : item.name,
})

export const matchesDeskQuery = (account: DeskAccountPreview, query: DeskPoolQuery): boolean => {
  if (
    query.ungrouped
      ? account.tag.trim().length > 0
      : query.tag.length > 0 && account.tag !== query.tag
  )
    return false
  if (
    query.untagged
      ? account.tagBucket.some((tag) => tag.trim().length > 0)
      : query.tagBucket.length > 0 &&
        !query.tagBucket.every((tag) => account.tagBucket.includes(tag))
  )
    return false
  const remarkParts = splitRemarks(account.remark)
  if (
    query.unremarked
      ? remarkParts.length > 0
      : query.userRemarks.length > 0
        ? !remarkMatches(account.remark, query.userRemarks)
        : query.userRemark.length > 0 && !remarkParts.includes(query.userRemark)
  )
    return false
  if (query.status.length > 0 && account.status !== query.status) return false
  if (query.app.length > 0 && account.app !== query.app) return false
  if (query.backType.length > 0 && account.backType !== query.backType) return false
  for (const item of query.quick) {
    if (item === "noUsername" && account.username.length > 0) return false
    if (item === "noPassword" && account.hasPassword) return false
    if (item === "hasPassword" && !account.hasPassword) return false
    if (item === "noTotp" && account.hasTotp) return false
    if (item === "hasTotp" && !account.hasTotp) return false
    if (item === "online" && !account.online) return false
    if (item === "offline" && account.online) return false
    if (item === "noProxy" && account.proxyId !== null) return false
    if (item === "favorite" && !account.favorite) return false
  }
  if (
    query.region.length > 0 &&
    !query.region.every((region) => account.region.trim().toLowerCase() === region.toLowerCase())
  ) {
    return false
  }
  if (query.deviceId !== null && account.deviceId !== query.deviceId) return false
  if (query.proxyId !== null && account.proxyId !== query.proxyId) return false
  if (query.identity.length > 0) {
    const tokens = query.identity.split("、")
    const username = account.username.toLowerCase()
    if (!tokens.some((token) => username === token.toLowerCase() || account.uid === token))
      return false
  }
  if (query.followerGT.length > 0 && account.follower < Number(query.followerGT)) return false
  if (query.followingGT.length > 0 && account.following < Number(query.followingGT)) return false
  if (
    query.transferKey.length > 0 &&
    !account.transferCodes.some((code) =>
      code.toLowerCase().includes(query.transferKey.toLowerCase()),
    )
  ) {
    return false
  }
  return true
}
