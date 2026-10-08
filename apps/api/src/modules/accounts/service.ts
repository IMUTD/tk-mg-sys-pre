import { GroupIdSchema, type UserId } from "../../lib/authorization"
import type { SecretCipher } from "../../lib/crypto"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import {
  type AccountCreateInput,
  type AccountListFilter,
  type AccountPage,
  type AccountRepository,
  type AccountTagBatchMode,
  type AccountUpdateInput,
  type OperationAccount,
  OperationAccountIdSchema,
  toPublicAccount,
} from "./repository"

type Dependencies = {
  readonly auditRepository: AuditRepository
  readonly cipher: SecretCipher
  readonly repository: AccountRepository
}

export interface AccountService {
  assignProxy(
    actorId: UserId,
    groupId: string,
    ids: readonly string[],
    proxyId: string | null,
  ): Promise<number>
  create(
    actorId: UserId,
    groupId: string,
    input: Omit<AccountCreateInput, "groupId">,
  ): Promise<OperationAccount>
  delete(actorId: UserId, groupId: string, ids: readonly string[]): Promise<number>
  exportMasked(
    filter: Omit<AccountListFilter, "groupId" | "page" | "pageSize"> & { readonly groupId: string },
  ): AsyncIterable<string>
  list(
    filter: Omit<AccountListFilter, "groupId"> & { readonly groupId: string },
  ): Promise<AccountPage>
  recycle(actorId: UserId, groupId: string, ids: readonly string[]): Promise<number>
  restore(actorId: UserId, groupId: string, ids: readonly string[]): Promise<number>
  reveal(
    actorId: UserId,
    groupId: string,
    ids: readonly string[],
  ): Promise<
    readonly {
      readonly emailPassword: string
      readonly id: string
      readonly msToken: string
      readonly password: string
      readonly pop3Password: string
      readonly totp: string
    }[]
  >
  update(
    actorId: UserId,
    groupId: string,
    accountId: string,
    input: AccountUpdateInput,
  ): Promise<OperationAccount | null>
  updateTags(
    actorId: UserId,
    groupId: string,
    ids: readonly string[],
    mode: AccountTagBatchMode,
    tags: readonly string[],
  ): Promise<number>
}

const audit = async (
  repo: AuditRepository,
  actorId: UserId,
  action: string,
  target: string,
): Promise<void> => {
  await writeAuditEvent(repo, { action, actorId, outcome: "allowed", target })
}

const parseIds = (ids: readonly string[]) => ids.map((id) => OperationAccountIdSchema.parse(id))

const encryptOptional = (cipher: SecretCipher, value: string | undefined): string =>
  value === undefined || value.length === 0 ? "" : cipher.encrypt(value)

const decryptOptional = (cipher: SecretCipher, value: string): string => {
  if (value.length === 0) return ""
  try {
    return cipher.decrypt(value)
  } catch {
    return ""
  }
}

const decryptJson = (cipher: SecretCipher, value: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(decryptOptional(cipher, value))
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const textField = (record: Record<string, unknown>, key: string): string =>
  typeof record[key] === "string" ? record[key] : ""

const sealResource = (
  cipher: SecretCipher,
  extra: Readonly<Record<string, unknown>> | undefined,
  secrets: Readonly<Record<string, string>>,
): Record<string, unknown> => {
  const next = { ...(extra ?? {}) }
  const task = next["task_param_copy"]
  const parsed =
    task !== null &&
    typeof task === "object" &&
    !Array.isArray(task) &&
    "parsed_reg_resource" in task
      ? { ...(task.parsed_reg_resource as Record<string, unknown>) }
      : {}
  for (const key of Object.keys(secrets)) delete parsed[key]
  next["task_param_copy"] = { parsed_reg_resource: parsed }
  next["sealed"] = cipher.encrypt(JSON.stringify(secrets))
  return next
}

const csvValue = (value: string): string => `"${value.replaceAll('"', '""')}"`

const backupTypeLabel = (value: OperationAccount["backupType"]): string => {
  switch (value) {
    case "local":
      return "本地"
    case "private_cloud":
      return "私有云"
    case null:
      return ""
  }
}

export const createAccountService = (dependencies: Dependencies): AccountService => ({
  assignProxy: async (actorId, rawGroupId, ids, proxyId) => {
    const count = await dependencies.repository.assignProxy(
      GroupIdSchema.parse(rawGroupId),
      parseIds(ids),
      proxyId,
    )
    await audit(dependencies.auditRepository, actorId, "account.proxy", `group:${rawGroupId}`)
    return count
  },
  create: async (actorId, rawGroupId, input) => {
    const { resourceSecrets, ...rest } = input
    const account = await dependencies.repository.create({
      ...rest,
      ...(resourceSecrets === undefined
        ? {}
        : {
            extra: sealResource(dependencies.cipher, rest.extra, resourceSecrets),
          }),
      encryptedSecret: encryptOptional(dependencies.cipher, input.secret),
      encryptedTotp: encryptOptional(dependencies.cipher, input.totp),
      groupId: GroupIdSchema.parse(rawGroupId),
    })
    await audit(dependencies.auditRepository, actorId, "account.create", `account:${account.id}`)
    return toPublicAccount(account)
  },
  delete: async (actorId, rawGroupId, ids) => {
    const count = await dependencies.repository.delete(
      GroupIdSchema.parse(rawGroupId),
      parseIds(ids),
    )
    await audit(dependencies.auditRepository, actorId, "account.delete", `group:${rawGroupId}`)
    return count
  },
  exportMasked: async function* (filter) {
    yield "id,identifier,platformUid,app,status,tags,note,region,follower,following,online,deviceName,instanceLabel,proxyName,backupType,hasPassword,hasTotp\n"
    for await (const account of dependencies.repository.iterate({
      ...filter,
      groupId: GroupIdSchema.parse(filter.groupId),
    })) {
      yield [
        account.id,
        account.identifier,
        account.platformUid,
        account.app ?? "",
        account.status,
        account.tags.join("|"),
        account.note,
        account.region,
        account.follower === null ? "" : `${account.follower}`,
        account.following === null ? "" : `${account.following}`,
        account.online ? "在线" : "离线",
        account.deviceName ?? "",
        account.instanceLabel ?? "",
        account.proxyName ?? "",
        backupTypeLabel(account.backupType),
        account.hasPassword ? "已配置" : "无",
        account.hasTotp ? "已配置" : "无",
      ]
        .map(csvValue)
        .join(",")
      yield "\n"
    }
  },
  list: async (filter) =>
    dependencies.repository.list({ ...filter, groupId: GroupIdSchema.parse(filter.groupId) }),
  recycle: async (actorId, rawGroupId, ids) => {
    const count = await dependencies.repository.recycle(
      GroupIdSchema.parse(rawGroupId),
      parseIds(ids),
    )
    await audit(dependencies.auditRepository, actorId, "account.recycle", `group:${rawGroupId}`)
    return count
  },
  restore: async (actorId, rawGroupId, ids) => {
    const count = await dependencies.repository.restore(
      GroupIdSchema.parse(rawGroupId),
      parseIds(ids),
    )
    await audit(dependencies.auditRepository, actorId, "account.restore", `group:${rawGroupId}`)
    return count
  },
  reveal: async (actorId, rawGroupId, ids) => {
    const groupId = GroupIdSchema.parse(rawGroupId)
    const rows = []
    for (const id of parseIds(ids)) {
      const stored = await dependencies.repository.find(groupId, id)
      if (stored === null) continue
      const sealed =
        typeof stored.extra["sealed"] === "string" && stored.extra["sealed"].length > 0
          ? decryptJson(dependencies.cipher, stored.extra["sealed"])
          : {}
      rows.push({
        emailPassword: textField(sealed, "emailPassword"),
        id: stored.id,
        msToken: textField(sealed, "msToken"),
        password: decryptOptional(dependencies.cipher, stored.encryptedSecret),
        pop3Password: textField(sealed, "pop3Password"),
        totp: decryptOptional(dependencies.cipher, stored.encryptedTotp),
      })
    }
    await audit(dependencies.auditRepository, actorId, "account.reveal", `group:${rawGroupId}`)
    return rows
  },
  update: async (actorId, rawGroupId, rawAccountId, input) => {
    const encryptedSecret =
      input.secret === undefined || input.secret.length === 0
        ? {}
        : { encryptedSecret: dependencies.cipher.encrypt(input.secret) }
    const encryptedTotp =
      input.totp === undefined || input.totp.length === 0
        ? {}
        : { encryptedTotp: dependencies.cipher.encrypt(input.totp) }
    const { resourceSecrets, ...rest } = input
    const stored = await dependencies.repository.find(
      GroupIdSchema.parse(rawGroupId),
      OperationAccountIdSchema.parse(rawAccountId),
    )
    if (stored === null) return null
    const oldSealed =
      typeof stored.extra["sealed"] === "string" ? { sealed: stored.extra["sealed"] } : {}
    const extra =
      resourceSecrets === undefined
        ? rest.extra === undefined
          ? undefined
          : { ...rest.extra, ...oldSealed }
        : sealResource(
            dependencies.cipher,
            { ...stored.extra, ...rest.extra },
            {
              ...Object.fromEntries(
                Object.entries(decryptJson(dependencies.cipher, oldSealed.sealed ?? "")).filter(
                  (item): item is [string, string] => typeof item[1] === "string",
                ),
              ),
              ...resourceSecrets,
            },
          )
    const account = await dependencies.repository.update(
      GroupIdSchema.parse(rawGroupId),
      OperationAccountIdSchema.parse(rawAccountId),
      { ...rest, ...(extra === undefined ? {} : { extra }), ...encryptedSecret, ...encryptedTotp },
    )
    if (account !== null)
      await audit(dependencies.auditRepository, actorId, "account.update", `account:${account.id}`)
    return account === null ? null : toPublicAccount(account)
  },
  updateTags: async (actorId, rawGroupId, ids, mode, tags) => {
    const count = await dependencies.repository.updateTags(
      GroupIdSchema.parse(rawGroupId),
      parseIds(ids),
      mode,
      tags,
    )
    await audit(dependencies.auditRepository, actorId, "account.tags", `group:${rawGroupId}`)
    return count
  },
})
