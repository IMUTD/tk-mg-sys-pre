import type { Sql } from "postgres"
import { z } from "zod"

import type { GroupId, UserId } from "../../lib/authorization"
import { type OperationAccount, OperationAccountIdSchema } from "../accounts/repository"

export const AccountLeaseIdSchema = z.string().uuid().brand<"AccountLeaseId">()
export type AccountLeaseId = z.infer<typeof AccountLeaseIdSchema>
export type AccountLease = {
  readonly accountId: string
  readonly createdAt: Date
  readonly expiresAt: Date | null
  readonly groupId: GroupId
  readonly id: AccountLeaseId
  readonly leasedByUserId: UserId
  readonly releasedAt: Date | null
}
export type AccountPoolItem = {
  readonly account: OperationAccount
  readonly activeLease: AccountLease | null
}
export interface AccountPoolRepository {
  lease(
    groupId: GroupId,
    accountId: string,
    operatorId: UserId,
    expiresAt: Date | null,
  ): Promise<AccountLease | null>
  list(groupId: GroupId): Promise<readonly AccountPoolItem[]>
  release(
    groupId: GroupId,
    accountId: string,
    operatorId: UserId,
    allowReclaim: boolean,
  ): Promise<boolean>
}

type LeaseRow = {
  readonly accountId: string
  readonly createdAt: Date
  readonly expiresAt: Date | null
  readonly groupId: string
  readonly id: string
  readonly leasedByUserId: string
  readonly releasedAt: Date | null
}
type AccountRow = {
  readonly createdAt: Date
  readonly encryptedSecret: string
  readonly groupId: string
  readonly id: string
  readonly identifier: string
  readonly name: string
  readonly note: string
  readonly status: string
  readonly tags: readonly string[]
  readonly updatedAt: Date
}
const toLease = (row: LeaseRow): AccountLease => ({
  accountId: row.accountId,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  groupId: z.string().uuid().brand<"GroupId">().parse(row.groupId),
  id: AccountLeaseIdSchema.parse(row.id),
  leasedByUserId: z.string().uuid().brand<"UserId">().parse(row.leasedByUserId),
  releasedAt: row.releasedAt,
})
const toAccount = (row: AccountRow): OperationAccount => {
  const hasPassword = row.encryptedSecret.length > 0
  return {
    app: null,
    avatar: "",
    backupKey: "",
    backupSlot: "",
    backupType: null,
    createdAt: row.createdAt,
    credentialState: hasPassword ? "configured" : "none",
    deleted: false,
    deletedAt: null,
    deviceId: null,
    deviceInstanceId: null,
    deviceName: null,
    extra: {},
    favorite: null,
    follower: null,
    following: null,
    groupId: z.string().uuid().brand<"GroupId">().parse(row.groupId),
    hasPassword,
    hasTotp: false,
    hasTransferKey: false,
    id: OperationAccountIdSchema.parse(row.id),
    identifier: row.identifier,
    instanceLabel: null,
    name: row.name,
    note: row.note,
    online: false,
    platformUid: "",
    proxyId: null,
    proxyName: null,
    region: "",
    instanceIndex: null,
    status: z.enum(["ready", "suspended", "disabled", "expired", "hidden", "unregistered"]).parse(row.status),
    tags: row.tags,
    transferred: false,
    updatedAt: row.updatedAt,
  }
}
export const createPostgresAccountPoolRepository = (client: Sql): AccountPoolRepository => ({
  lease: async (groupId, accountId, operatorId, expiresAt) =>
    client.begin(async (transaction) => {
      const account = await transaction<
        { readonly id: string }[]
      >`select id from operation_account where id = ${accountId} and group_id = ${groupId} and status = 'ready' and deleted = false for key share`
      if (account[0] === undefined) return null
      await transaction`update operation_account_lease set released_at = now() where account_id = ${accountId} and released_at is null and expires_at is not null and expires_at <= now()`
      const rows = await transaction<LeaseRow[]>`
      insert into operation_account_lease (account_id, group_id, leased_by_user_id, expires_at)
      values (${accountId}, ${groupId}, ${operatorId}, ${expiresAt})
      on conflict (account_id) where released_at is null do nothing
      returning id, account_id as "accountId", group_id as "groupId", leased_by_user_id as "leasedByUserId", created_at as "createdAt", expires_at as "expiresAt", released_at as "releasedAt"
    `
      const row = rows[0]
      return row === undefined ? null : toLease(row)
    }),
  list: async (groupId) => {
    const rows = await client<
      AccountRow[]
    >`select id, group_id as "groupId", name, identifier, encrypted_secret as "encryptedSecret", note, tags, status, created_at as "createdAt", updated_at as "updatedAt" from operation_account where group_id = ${groupId} and deleted = false order by created_at desc, id desc`
    const leases = await client<
      LeaseRow[]
    >`select id, account_id as "accountId", group_id as "groupId", leased_by_user_id as "leasedByUserId", created_at as "createdAt", expires_at as "expiresAt", released_at as "releasedAt" from operation_account_lease where group_id = ${groupId} and released_at is null and (expires_at is null or expires_at > now())`
    const byAccount = new Map(leases.map((lease) => [lease.accountId, toLease(lease)]))
    return rows.map((row) => ({
      account: toAccount(row),
      activeLease: byAccount.get(row.id) ?? null,
    }))
  },
  release: async (groupId, accountId, operatorId, allowReclaim) => {
    const rows = await client<
      { readonly id: string }[]
    >`update operation_account_lease set released_at = now() where group_id = ${groupId} and account_id = ${accountId}
      and (${allowReclaim} or leased_by_user_id = ${operatorId}) and released_at is null returning id`
    return rows.length === 1
  },
})

type InMemoryAccount = { readonly accountId: string; readonly groupId: string }
export const createInMemoryAccountPoolRepository = (
  accounts: readonly InMemoryAccount[],
): AccountPoolRepository => {
  let leases: readonly AccountLease[] = []
  return {
    lease: async (rawGroupId, accountId, operatorId, expiresAt) => {
      const groupId = z.string().uuid().brand<"GroupId">().parse(rawGroupId)
      if (
        !accounts.some(
          (account) => account.accountId === accountId && account.groupId === groupId,
        ) ||
        leases.some((lease) => lease.accountId === accountId && lease.releasedAt === null)
      )
        return null
      const lease: AccountLease = {
        accountId,
        createdAt: new Date(),
        expiresAt,
        groupId,
        id: AccountLeaseIdSchema.parse(crypto.randomUUID()),
        leasedByUserId: operatorId,
        releasedAt: null,
      }
      leases = [...leases, lease]
      return lease
    },
    list: async () => [],
    release: async (groupId, accountId, operatorId, allowReclaim) => {
      const lease = leases.find(
        (candidate) =>
          candidate.groupId === groupId &&
          candidate.accountId === accountId &&
          (allowReclaim || candidate.leasedByUserId === operatorId) &&
          candidate.releasedAt === null,
      )
      if (lease === undefined) return false
      leases = leases.map((candidate) =>
        candidate.id === lease.id ? { ...candidate, releasedAt: new Date() } : candidate,
      )
      return true
    },
  }
}
