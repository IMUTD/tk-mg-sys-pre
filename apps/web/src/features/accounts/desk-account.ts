import type { AccountCredential, OperationAccount } from "./api"
import {
  type AccountExtra,
  type AccountStatus,
  emptyExtra,
  type MytAccount,
  nowText,
} from "./myt-account"

const text = (value: unknown): string => (typeof value === "string" ? value : "")

const resourceOf = (extra: Readonly<Record<string, unknown>>): Record<string, string> => {
  const task = extra["task_param_copy"]
  if (task === null || typeof task !== "object" || Array.isArray(task)) return {}
  const parsed = (task as { parsed_reg_resource?: unknown }).parsed_reg_resource
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {}
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  )
}

const deskExtra = (item: OperationAccount): AccountExtra => {
  const source = item.extra
  const base = emptyExtra()
  return {
    ...base,
    avatar: text(source["avatar"]) || item.avatar,
    nickname: text(source["nickname"]) || item.name,
    proxyLabel: text(source["proxyLabel"]),
    region: item.region,
    task_param_copy: { parsed_reg_resource: resourceOf(source) },
  }
}

const deskStatus = (status: OperationAccount["status"]): AccountStatus => {
  if (status === "suspended") return "1"
  if (status === "expired") return "2"
  if (status === "hidden") return "3"
  if (status === "unregistered") return "4"
  return "0"
}

const deskBackup = (backupType: OperationAccount["backupType"]): MytAccount["backType"] => {
  if (backupType === "local") return "2"
  if (backupType === "private_cloud") return "3"
  if (backupType === "cloud") return "4"
  if (backupType === "full") return "5"
  return ""
}

export const toDeskAccount = (item: OperationAccount, index: number): MytAccount => ({
  app: item.app ?? "tiktok",
  backKey: item.backupKey,
  backupName: item.backupName,
  backType: deskBackup(item.backupType),
  createTime: item.createdAt.toISOString().replace("T", " ").slice(0, 19),
  deleted: item.deleted,
  deleteTime:
    item.deletedAt === null ? null : item.deletedAt.toISOString().replace("T", " ").slice(0, 19),
  deviceId: null,
  deviceSeq: item.instanceIndex,
  recordDeviceId: item.deviceId ?? undefined,
  recordInstanceId: item.deviceInstanceId ?? undefined,
  recordProxyId: item.proxyId ?? undefined,
  enable: item.status !== "disabled",
  extra: deskExtra(item),
  favorite: (item.favorite ?? 0) > 0,
  follower: item.follower ?? 0,
  following: item.following ?? 0,
  id: index + 1,
  online: item.online,
  password: "",
  proxyId: null,
  recordId: item.id,
  region: item.region,
  remark: item.note,
  status: deskStatus(item.status),
  tag: item.tags[0] ?? "",
  tagBucket: item.tags.slice(1),
  totp: "",
  transferKey: "",
  transferred: item.transferred,
  uid: item.platformUid,
  updateTime: item.updatedAt.toISOString().replace("T", " ").slice(0, 19),
  username: item.identifier.length > 0 ? item.identifier : item.name,
})

export const applyCredential = (account: MytAccount, credential: AccountCredential): MytAccount => {
  const resource = { ...account.extra.task_param_copy.parsed_reg_resource }
  if (credential.emailPassword.length > 0) resource["emailPassword"] = credential.emailPassword
  if (credential.msToken.length > 0) resource["msToken"] = credential.msToken
  if (credential.pop3Password.length > 0) resource["pop3Password"] = credential.pop3Password
  return {
    ...account,
    extra: { ...account.extra, task_param_copy: { parsed_reg_resource: resource } },
    password: credential.password,
    totp: credential.totp,
    updateTime: account.updateTime || nowText(),
  }
}

const secretKeys = ["emailPassword", "msToken", "pop3Password"] as const

export const accountWrite = (account: MytAccount) => {
  const resource = { ...account.extra.task_param_copy.parsed_reg_resource }
  const resourceSecrets: Record<string, string> = {}
  for (const key of secretKeys) {
    const value = resource[key] ?? ""
    if (value.length > 0) resourceSecrets[key] = value
    delete resource[key]
  }
  const group = account.tag.trim()
  const bucket = account.tagBucket.map((item) => item.trim()).filter((item) => item.length > 0)
  const tags = group.length > 0 ? [group, ...bucket] : bucket.length > 0 ? ["", ...bucket] : []
  return {
    app: (account.app || "tiktok") as "tiktok",
    extra: {
      avatar: account.extra.avatar,
      nickname: account.extra.nickname,
      proxyLabel: account.extra.proxyLabel ?? "",
      task_param_copy: { parsed_reg_resource: resource },
    },
    follower: account.follower,
    following: account.following,
    identifier: account.username,
    name: account.extra.nickname.length > 0 ? account.extra.nickname : account.username,
    note: account.remark,
    platformUid: account.uid,
    region: account.region,
    ...(Object.keys(resourceSecrets).length > 0 ? { resourceSecrets } : {}),
    ...(account.password.length > 0 ? { secret: account.password } : {}),
    backupType:
      account.backType === "3"
        ? ("private_cloud" as const)
        : account.backType === "4"
          ? ("cloud" as const)
          : account.backType === "5"
            ? ("full" as const)
            : account.backType === "2"
              ? ("local" as const)
              : null,
    status: !account.enable
      ? ("disabled" as const)
      : account.status === "1"
        ? ("suspended" as const)
        : account.status === "2"
          ? ("expired" as const)
          : account.status === "3"
            ? ("hidden" as const)
            : account.status === "4"
              ? ("unregistered" as const)
              : ("ready" as const),
    tags,
    ...(account.totp.length > 0 ? { totp: account.totp } : {}),
  }
}
