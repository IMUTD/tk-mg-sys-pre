import { PageKey } from "../../lib/pages"
import { splitRemarks } from "../labels/remark-list"
import { createAccountsApi, type AccountCredential, type OperationAccount } from "../accounts/api"
import { createLabelsApi, labelsChanged } from "../labels/api"
import type { TkRegResource } from "./tk-reg-resource"

const secretKeys = ["emailPassword", "msToken", "pop3Password"] as const

const text = (value: unknown): string => (typeof value === "string" ? value : "")

const resourceOf = (extra: Readonly<Record<string, unknown>>): Record<string, string> => {
  const task = extra["task_param_copy"]
  if (task === null || typeof task !== "object" || Array.isArray(task)) return {}
  const parsed = (task as { parsed_reg_resource?: unknown }).parsed_reg_resource
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {}
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

export const poolAccountWrite = (resource: TkRegResource) => {
  const data = { ...resource.data }
  const secret = data.password ?? ""
  const totp = data.twoFA ?? ""
  delete data.password
  delete data.twoFA
  const resourceSecrets: Record<string, string> = {}
  for (const key of secretKeys) {
    const value = data[key] ?? ""
    if (value.length > 0) resourceSecrets[key] = value
    delete data[key]
  }
  const tag = resource.tag.trim()
  const identifier = resource.email.trim()
  return {
    extra: {
      poolAlloc: resource.status,
      poolAssignTime: resource.assignTime,
      poolResource: resource.email,
      poolResult: resource.result,
      task_param_copy: { parsed_reg_resource: data },
    },
    identifier,
    name: identifier.length > 0 ? identifier : "未注册账号",
    note: resource.remark,
    status: "unregistered" as const,
    tags: tag.length > 0 ? [tag] : [""],
    ...(Object.keys(resourceSecrets).length > 0 ? { resourceSecrets } : {}),
    ...(secret.length > 0 ? { secret } : {}),
    ...(totp.length > 0 ? { totp } : {}),
  }
}

export const toPoolResource = (
  account: OperationAccount,
  credential: AccountCredential | undefined,
  index: number,
): TkRegResource => {
  const data = resourceOf(account.extra)
  if (credential !== undefined) {
    if (credential.password.length > 0) data.password = credential.password
    if (credential.totp.length > 0) data.twoFA = credential.totp
    if (credential.emailPassword.length > 0) data.emailPassword = credential.emailPassword
    if (credential.msToken.length > 0) data.msToken = credential.msToken
    if (credential.pop3Password.length > 0) data.pop3Password = credential.pop3Password
  }
  const assignTime = text(account.extra["poolAssignTime"])
  return {
    assignTime: assignTime.length > 0 ? assignTime : null,
    createTime: account.createdAt.toISOString().replace("T", " ").slice(0, 19),
    data,
    email: text(account.extra["poolResource"]) || account.identifier,
    id: index + 1,
    recordId: account.id,
    recycle: "0",
    remark: account.note,
    result: account.extra["poolResult"] === "1" ? "1" : "0",
    status: account.extra["poolAlloc"] === "1" ? "1" : "0",
    tag: account.tags[0] ?? "",
  }
}

export const loadPoolAccounts = async (groupId: string): Promise<TkRegResource[]> => {
  const api = createAccountsApi()
  const records: OperationAccount[] = []
  for (let page = 1; ; page += 1) {
    const result = await api.list({
      deleted: false,
      groupId,
      page,
      pageSize: 500,
      status: "unregistered",
    })
    records.push(...result.items)
    if (result.items.length === 0 || page * result.pageSize >= result.total) break
  }
  const credentials: AccountCredential[] = []
  for (let offset = 0; offset < records.length; offset += 500) {
    credentials.push(
      ...(await api.credentials(
        groupId,
        records.slice(offset, offset + 500).map((item) => item.id),
      )),
    )
  }
  const byId = new Map(credentials.map((item) => [item.id, item]))
  return records.map((item, index) => toPoolResource(item, byId.get(item.id), index))
}

const rememberLabel = (kind: "group" | "remark", name: string): void => {
  const value = name.trim()
  if (value.length === 0 || value.includes("+")) return
  void createLabelsApi()
    .create(PageKey.Accounts, kind, value)
    .then(() => labelsChanged())
    .catch(() => undefined)
}

const rememberGroup = (tag: string): void => {
  rememberLabel("group", tag)
}

const rememberRemark = (remark: string): void => {
  for (const name of splitRemarks(remark)) rememberLabel("remark", name)
}

export const importPoolAccounts = async (
  groupId: string,
  resources: readonly TkRegResource[],
): Promise<void> => {
  const api = createAccountsApi()
  for (const resource of resources) {
    rememberGroup(resource.tag)
    rememberRemark(resource.remark)
    await api.create(groupId, poolAccountWrite(resource))
  }
}

export const assignPoolGroups = async (
  groupId: string,
  ids: readonly string[],
  tag: string,
): Promise<void> => {
  rememberGroup(tag)
  await createAccountsApi().setGroup(groupId, ids, tag)
}

export const assignPoolNotes = async (
  groupId: string,
  ids: readonly string[],
  note: string,
): Promise<void> => {
  rememberRemark(note)
  await createAccountsApi().setNote(groupId, ids, note)
}

export const updatePoolAccount = async (groupId: string, resource: TkRegResource): Promise<void> => {
  if (resource.recordId === undefined) return
  rememberGroup(resource.tag)
  rememberRemark(resource.remark)
  await createAccountsApi().update(groupId, resource.recordId, poolAccountWrite(resource))
}

export const removePoolAccounts = async (groupId: string, ids: readonly string[]): Promise<void> => {
  if (ids.length === 0) return
  const api = createAccountsApi()
  await api.recycle(groupId, ids)
  await api.delete(groupId, ids)
}

export const resetPoolAccounts = async (
  groupId: string,
  resources: readonly TkRegResource[],
): Promise<void> => {
  const api = createAccountsApi()
  for (const resource of resources) {
    if (resource.recordId === undefined) continue
    await api.update(groupId, resource.recordId, poolAccountWrite({ ...resource, status: "0" }))
  }
}
