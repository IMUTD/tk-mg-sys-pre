import { createHash, randomBytes } from "node:crypto"

import { GroupIdSchema, type UserId } from "../../lib/authorization"
import type { SecretCipher } from "../../lib/crypto"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import { AccountDeskError, type AccountFacets, type AccountStatisticRow } from "./desk"
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
  facets(groupId: string): Promise<AccountFacets>
  statistics(groupId: string): Promise<readonly AccountStatisticRow[]>
  deleteByTag(
    actorId: UserId,
    groupId: string,
    tag: string,
    bannedOnly: boolean,
    confirm: string | undefined,
  ): Promise<number>
  resetBanned(actorId: UserId, groupId: string, tag: string): Promise<number>
  setGroup(actorId: UserId, groupId: string, ids: readonly string[], tag: string): Promise<number>
  setNote(actorId: UserId, groupId: string, ids: readonly string[], note: string): Promise<number>
  setRegion(
    actorId: UserId,
    groupId: string,
    ids: readonly string[],
    region: string,
  ): Promise<number>
  setFavorite(
    actorId: UserId,
    groupId: string,
    ids: readonly string[],
    starred: boolean,
  ): Promise<number>
  moveGroupTags(
    actorId: UserId,
    groupId: string,
    oldTags: readonly string[],
    newTag: string,
  ): Promise<number>
  listTransfers(groupId: string): Promise<
    readonly {
      readonly accountIds: readonly string[]
      readonly code: string
      readonly count: number
      readonly tags: string
    }[]
  >
  createTransfer(
    actorId: UserId,
    groupId: string,
    ids: readonly string[],
    code: string | undefined,
  ): Promise<{ readonly code: string; readonly count: number }>
  revokeTransfer(actorId: UserId, groupId: string, code: string): Promise<number>
  splitTransfer(
    actorId: UserId,
    groupId: string,
    code: string,
    size: number,
  ): Promise<{ readonly codes: readonly string[] }>
  mergeTransfers(
    actorId: UserId,
    groupId: string,
    codes: readonly string[],
    code: string | undefined,
  ): Promise<{ readonly code: string; readonly count: number }>
  redeemTransfer(actorId: UserId, groupId: string, code: string): Promise<number>
  start(
    actorId: UserId,
    groupId: string,
    accountId: string,
    deviceId: string,
    deviceInstanceId: string,
    proxyId: string | null,
  ): Promise<boolean>
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
    case "cloud":
      return "云端"
    case "full":
      return "全量"
    case null:
      return ""
  }
}

const codeHash = (code: string): string => createHash("sha256").update(code).digest("hex")

const newTransferCode = (): string => randomBytes(16).toString("hex")

const parseTransferCode = (code: string | undefined): string => {
  const next =
    code === undefined || code.trim().length === 0 ? newTransferCode() : code.trim().toLowerCase()
  if (!/^[a-f0-9]{32}$/.test(next)) throw new AccountDeskError("invalid_transfer")
  return next
}

const sealCode = (cipher: SecretCipher, code: string) => ({
  encryptedCode: cipher.encrypt(code),
  hash: codeHash(code),
})

const normalizeFilter = <
  Filter extends Omit<AccountListFilter, "groupId" | "page" | "pageSize"> & {
    readonly groupId: string
  },
>(
  filter: Filter,
) => {
  const { transferKey, ...rest } = filter
  const key = transferKey?.trim().toLowerCase() ?? ""
  return {
    ...rest,
    groupId: GroupIdSchema.parse(filter.groupId),
    ...(key.length === 0 ? {} : { transferKeyHash: codeHash(key) }),
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
    for await (const account of dependencies.repository.iterate(normalizeFilter(filter))) {
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
  list: async (filter) => dependencies.repository.list(normalizeFilter(filter)),
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
  facets: (groupId) => dependencies.repository.facets(GroupIdSchema.parse(groupId)),
  statistics: (groupId) => dependencies.repository.statistics(GroupIdSchema.parse(groupId)),
  deleteByTag: async (actorId, rawGroupId, tag, bannedOnly, confirm) => {
    if (!bannedOnly && confirm !== "确认全部删除") throw new AccountDeskError("confirm_required")
    const groupId = GroupIdSchema.parse(rawGroupId)
    const ids = await dependencies.repository.deleteByTag(groupId, tag, bannedOnly)
    const count = await dependencies.repository.recycle(groupId, parseIds(ids))
    await audit(
      dependencies.auditRepository,
      actorId,
      "account.statistics.delete",
      `group:${rawGroupId}`,
    )
    return count
  },
  resetBanned: async (actorId, rawGroupId, tag) => {
    const count = await dependencies.repository.resetBanned(GroupIdSchema.parse(rawGroupId), tag)
    await audit(
      dependencies.auditRepository,
      actorId,
      "account.statistics.reset",
      `group:${rawGroupId}`,
    )
    return count
  },
  setGroup: async (actorId, rawGroupId, ids, tag) => {
    const count = await dependencies.repository.setGroupTag(
      GroupIdSchema.parse(rawGroupId),
      ids,
      tag,
    )
    await audit(dependencies.auditRepository, actorId, "account.group", `group:${rawGroupId}`)
    return count
  },
  setNote: async (actorId, rawGroupId, ids, note) => {
    const count = await dependencies.repository.setNote(GroupIdSchema.parse(rawGroupId), ids, note)
    await audit(dependencies.auditRepository, actorId, "account.note", `group:${rawGroupId}`)
    return count
  },
  setRegion: async (actorId, rawGroupId, ids, region) => {
    const count = await dependencies.repository.setRegion(
      GroupIdSchema.parse(rawGroupId),
      ids,
      region,
    )
    await audit(dependencies.auditRepository, actorId, "account.region", `group:${rawGroupId}`)
    return count
  },
  setFavorite: async (actorId, rawGroupId, ids, starred) => {
    const count = await dependencies.repository.setFavorite(
      GroupIdSchema.parse(rawGroupId),
      ids,
      starred,
    )
    await audit(dependencies.auditRepository, actorId, "account.favorite", `group:${rawGroupId}`)
    return count
  },
  moveGroupTags: async (actorId, rawGroupId, oldTags, newTag) => {
    const count = await dependencies.repository.moveGroupTags(
      GroupIdSchema.parse(rawGroupId),
      oldTags,
      newTag,
    )
    await audit(dependencies.auditRepository, actorId, "account.group.move", `group:${rawGroupId}`)
    return count
  },
  listTransfers: async (groupId) => {
    const rows = await dependencies.repository.listTransfers(GroupIdSchema.parse(groupId))
    return rows.flatMap((row) => {
      const code = decryptOptional(dependencies.cipher, row.encryptedCode)
      return code.length === 0
        ? []
        : [{ accountIds: row.accountIds, code, count: row.count, tags: row.tags.join("|") }]
    })
  },
  createTransfer: async (actorId, rawGroupId, ids, code) => {
    const next = parseTransferCode(code)
    const count = await dependencies.repository.assignTransfer(
      GroupIdSchema.parse(rawGroupId),
      actorId,
      ids,
      sealCode(dependencies.cipher, next),
    )
    await audit(
      dependencies.auditRepository,
      actorId,
      "account.transfer.create",
      `group:${rawGroupId}`,
    )
    return { code: next, count }
  },
  revokeTransfer: async (actorId, rawGroupId, code) => {
    const count = await dependencies.repository.revokeTransfer(
      GroupIdSchema.parse(rawGroupId),
      codeHash(parseTransferCode(code)),
    )
    await audit(
      dependencies.auditRepository,
      actorId,
      "account.transfer.revoke",
      `group:${rawGroupId}`,
    )
    return count
  },
  splitTransfer: async (actorId, rawGroupId, code, size) => {
    const parsed = parseTransferCode(code)
    const chunks = Math.max(1, size)
    const existing = await dependencies.repository.listTransfers(GroupIdSchema.parse(rawGroupId))
    const match = existing.find(
      (row) => decryptOptional(dependencies.cipher, row.encryptedCode) === parsed,
    )
    if (match === undefined || chunks >= match.count) throw new AccountDeskError("invalid_transfer")
    const pieceCount = Math.ceil(match.count / chunks)
    const codes = Array.from({ length: pieceCount }, () => newTransferCode())
    await dependencies.repository.splitTransfer(
      GroupIdSchema.parse(rawGroupId),
      actorId,
      codeHash(parsed),
      chunks,
      codes.map((item) => sealCode(dependencies.cipher, item)),
    )
    await audit(
      dependencies.auditRepository,
      actorId,
      "account.transfer.split",
      `group:${rawGroupId}`,
    )
    return { codes }
  },
  mergeTransfers: async (actorId, rawGroupId, codes, code) => {
    const next = parseTransferCode(code)
    const hashes = codes.map((item) => codeHash(parseTransferCode(item)))
    const count = await dependencies.repository.mergeTransfers(
      GroupIdSchema.parse(rawGroupId),
      actorId,
      hashes,
      sealCode(dependencies.cipher, next),
    )
    await audit(
      dependencies.auditRepository,
      actorId,
      "account.transfer.merge",
      `group:${rawGroupId}`,
    )
    return { code: next, count }
  },
  redeemTransfer: async (actorId, rawGroupId, code) => {
    const count = await dependencies.repository.redeemTransfer(
      GroupIdSchema.parse(rawGroupId),
      codeHash(parseTransferCode(code)),
    )
    await audit(
      dependencies.auditRepository,
      actorId,
      "account.transfer.redeem",
      `group:${rawGroupId}`,
    )
    return count
  },
  start: async (actorId, rawGroupId, accountId, deviceId, deviceInstanceId, proxyId) => {
    const updated = await dependencies.repository.startAccount(
      GroupIdSchema.parse(rawGroupId),
      OperationAccountIdSchema.parse(accountId),
      deviceId,
      deviceInstanceId,
      proxyId,
    )
    await audit(dependencies.auditRepository, actorId, "account.start", `account:${accountId}`)
    return updated
  },
})
