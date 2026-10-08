import type { Sql, TransactionSql } from "postgres"
import type { z } from "zod"

import {
  type GroupId,
  GroupIdSchema,
  type Role,
  RoleSchema,
  UserIdSchema,
} from "../../lib/authorization"
import type { PageAccess } from "../../lib/pages"
import type { AuditEventInput } from "../audit/service"

export const MemberIdSchema = UserIdSchema.brand<"MemberId">()
export type MemberId = z.infer<typeof MemberIdSchema>

export type MemberConflictCode =
  | "cannot_configure_administrator"
  | "cannot_delete_self"
  | "duplicate_email"
  | "duplicate_group_name"
  | "invalid_group_ids"
  | "last_administrator"
  | "member_in_use"
  | "init_tool_account"
  | "administrator_only_in_init_tool"

export class MemberConflictError extends Error {
  public readonly code: MemberConflictCode

  public constructor(code: MemberConflictCode) {
    super(code)
    this.code = code
    this.name = "MemberConflictError"
  }
}

export type AccessGroup = {
  readonly id: GroupId
  readonly name: string
}

export type Member = {
  readonly createdAt: Date
  readonly displayName: string
  readonly email: string
  readonly enabled: boolean
  readonly groupIds: readonly GroupId[]
  readonly id: MemberId
  readonly role: Role
}

export type MemberCreateInput = {
  readonly displayName: string
  readonly email: string
  readonly groupIds: readonly GroupId[]
  readonly passwordHash: string
  readonly role: Role
}

export type MemberUpdateInput = {
  readonly displayName?: string
  readonly enabled: boolean
  readonly groupIds: readonly GroupId[]
  readonly passwordHash?: string
  readonly role: Role
}

export interface MemberRepository {
  accountOrigin(memberId: MemberId): Promise<"init-tool" | "sys" | null>
  countEnabledAdministrators(exceptMemberId?: MemberId): Promise<number>
  create(input: MemberCreateInput): Promise<Member>
  createGroup(name: string): Promise<AccessGroup>
  delete(memberId: MemberId): Promise<boolean>
  get(memberId: MemberId): Promise<Member | null>
  list(): Promise<readonly Member[]>
  listDisplayNames(): Promise<readonly string[]>
  listGroups(): Promise<readonly AccessGroup[]>
  transaction?<Result>(
    callback: (workflow: MemberTransactionWorkflow) => Promise<Result>,
  ): Promise<Result>
  update(memberId: MemberId, input: MemberUpdateInput): Promise<Member | null>
}

export interface MemberTransactionWorkflow {
  appendAudit(input: AuditEventInput): Promise<void>
  countEnabledAdministrators(exceptMemberId?: MemberId): Promise<number>
  create(input: MemberCreateInput): Promise<Member>
  delete(memberId: MemberId): Promise<boolean>
  get(memberId: MemberId): Promise<Member | null>
  lockAdministratorRoster(): Promise<void>
  replacePermissions(
    memberId: MemberId,
    pages: readonly PageAccess[],
    revokeSessions: boolean,
  ): Promise<void>
  update(memberId: MemberId, input: MemberUpdateInput): Promise<Member | null>
}

type MemberRow = {
  readonly createdAt: Date
  readonly displayName: string
  readonly email: string
  readonly enabled: boolean
  readonly groupIds: readonly string[]
  readonly id: string
  readonly role: string
}

type QueryClient = Sql | TransactionSql

const AdministratorRosterLockId = 705_203_902

const isPgError = (error: unknown, code: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  Object.getOwnPropertyDescriptor(error, "code")?.value === code

const columns = (client: QueryClient) => client`
  app_user.id,
  app_user.email,
  app_user.display_name as "displayName",
  app_user.role,
  app_user.enabled,
  app_user.created_at as "createdAt",
  coalesce(array_agg(user_group.group_id) filter (where user_group.group_id is not null), '{}') as "groupIds"
`

const toMember = (row: MemberRow): Member => ({
  createdAt: row.createdAt,
  displayName: row.displayName,
  email: row.email,
  enabled: row.enabled,
  groupIds: row.groupIds.map((groupId) => GroupIdSchema.parse(groupId)),
  id: MemberIdSchema.parse(row.id),
  role: RoleSchema.parse(row.role),
})

const uniqueGroupIds = (groupIds: readonly GroupId[]): readonly GroupId[] => [...new Set(groupIds)]

const memberById = async (client: QueryClient, memberId: MemberId): Promise<Member | null> => {
  const rows = await client<MemberRow[]>`
    select ${columns(client)}
    from app_user
    left join user_group on user_group.user_id = app_user.id
    where app_user.id = ${memberId}
    group by app_user.id, app_user.email, app_user.display_name, app_user.role, app_user.enabled, app_user.created_at
  `
  const row = rows[0]
  return row === undefined ? null : toMember(row)
}

const lockMember = async (client: QueryClient, memberId: MemberId): Promise<boolean> => {
  const rows = await client<{ readonly id: string }[]>`
    select id from app_user where id = ${memberId} for update
  `
  return rows[0] !== undefined
}

const hasSameGroupIds = (left: readonly GroupId[], right: readonly GroupId[]): boolean =>
  left.length === right.length && left.every((groupId) => right.includes(groupId))

const assertGroupsExist = async (
  client: QueryClient,
  groupIds: readonly GroupId[],
): Promise<void> => {
  const unique = uniqueGroupIds(groupIds)
  if (unique.length === 0) return
  const rows = await client<{ readonly id: string }[]>`
    select id from access_group where id = any(${unique}::uuid[])
  `
  if (rows.length !== unique.length) throw new MemberConflictError("invalid_group_ids")
}

const insertGroups = async (
  client: QueryClient,
  memberId: MemberId,
  groupIds: readonly GroupId[],
): Promise<void> => {
  const unique = uniqueGroupIds(groupIds)
  if (unique.length === 0) return
  await client`
    insert into user_group (user_id, group_id)
    select ${memberId}, unnest(${unique}::uuid[])
  `
}

const insertUserPages = async (
  client: QueryClient,
  memberId: MemberId,
  pages: readonly PageAccess[],
): Promise<void> => {
  if (pages.length === 0) return
  await client`
    insert into user_page_permission (user_id, page_key, can_view, can_delete)
    select
      ${memberId}::uuid,
      t.page_key,
      t.can_view,
      t.can_delete
    from jsonb_to_recordset(${client.json(
      pages.map((page) => ({
        can_delete: page.canDelete,
        can_view: page.canView,
        page_key: page.key,
      })),
    )}) as t(page_key text, can_view boolean, can_delete boolean)
  `
}

const appendAudit = async (client: QueryClient, input: AuditEventInput): Promise<void> => {
  await client`
    insert into audit_event (id, actor_id, action, outcome, target, metadata)
    values (
      ${crypto.randomUUID()},
      ${input.actorId},
      ${input.action},
      ${input.outcome},
      ${input.target},
      ${client.json(input.metadata ?? {})}
    )
  `
}

const countEnabledAdministrators = async (
  client: QueryClient,
  exceptMemberId?: MemberId,
): Promise<number> => {
  const rows =
    exceptMemberId === undefined
      ? await client<{ readonly count: number }[]>`
          select count(*)::int as count
          from app_user
          where role = 'administrator' and enabled = true
        `
      : await client<{ readonly count: number }[]>`
          select count(*)::int as count
          from app_user
          where role = 'administrator' and enabled = true and id <> ${exceptMemberId}
        `
  return rows[0]?.count ?? 0
}

const createMember = async (client: QueryClient, input: MemberCreateInput): Promise<Member> => {
  const memberId = MemberIdSchema.parse(crypto.randomUUID())
  const groupIds = uniqueGroupIds(input.groupIds)
  await assertGroupsExist(client, groupIds)
  await client`
    insert into app_user (id, email, display_name, password_hash, role, enabled)
    values (
      ${memberId},
      ${input.email.toLowerCase()},
      ${input.displayName},
      ${input.passwordHash},
      ${input.role},
      true
    )
  `
  await insertGroups(client, memberId, groupIds)
  const member = await memberById(client, memberId)
  if (member === null) throw new MemberPersistenceError()
  return member
}

const assertMutableAccount = async (client: QueryClient, memberId: MemberId): Promise<void> => {
  const rows = await client<{ provisionedBy: string }[]>`
    select provisioned_by as "provisionedBy" from app_user where id = ${memberId}
  `
  if (rows[0]?.provisionedBy === "init-tool") throw new MemberConflictError("init_tool_account")
}

const updateMember = async (
  client: QueryClient,
  memberId: MemberId,
  input: MemberUpdateInput,
): Promise<Member | null> => {
  await assertMutableAccount(client, memberId)
  if (!(await lockMember(client, memberId))) return null
  const existing = await memberById(client, memberId)
  if (existing === null) throw new MemberPersistenceError()
  const groupIds = uniqueGroupIds(input.groupIds)
  await assertGroupsExist(client, groupIds)
  const mustRevokeSessions =
    existing.enabled !== input.enabled ||
    existing.role !== input.role ||
    input.passwordHash !== undefined ||
    !hasSameGroupIds(existing.groupIds, groupIds)
  if (input.passwordHash === undefined) {
    await client`
      update app_user
      set role = ${input.role}, enabled = ${input.enabled}, display_name = ${input.displayName ?? existing.displayName}
      where id = ${memberId}
    `
  } else {
    await client`
      update app_user
      set
        role = ${input.role},
        enabled = ${input.enabled},
        display_name = ${input.displayName ?? existing.displayName},
        password_hash = ${input.passwordHash}
      where id = ${memberId}
    `
  }
  await client`delete from user_group where user_id = ${memberId}`
  await insertGroups(client, memberId, groupIds)
  if (mustRevokeSessions)
    await client`
      update app_session
      set revoked_at = now()
      where user_id = ${memberId} and revoked_at is null
    `
  const member = await memberById(client, memberId)
  if (member === null) throw new MemberPersistenceError()
  return member
}

const deleteMember = async (client: QueryClient, memberId: MemberId): Promise<boolean> => {
  await assertMutableAccount(client, memberId)
  if (!(await lockMember(client, memberId))) return false
  if (await memberIsReferenced(client, memberId)) {
    throw new MemberConflictError("member_in_use")
  }
  await client`delete from app_session where user_id = ${memberId}`
  await client`delete from app_user where id = ${memberId}`
  return true
}

const memberIsReferenced = async (client: QueryClient, memberId: MemberId): Promise<boolean> => {
  const rows = await client<{ readonly blocked: boolean }[]>`
    select (
      exists(select 1 from audit_event where actor_id = ${memberId})
      or exists(select 1 from system_setting where updated_by = ${memberId})
      or exists(select 1 from storage_setting where updated_by = ${memberId})
      or exists(select 1 from operation_account_lease where leased_by_user_id = ${memberId})
      or exists(select 1 from operation_resource_allocation where allocated_by_user_id = ${memberId})
    ) as blocked
  `
  return rows[0]?.blocked === true
}

export const createPostgresMemberRepository = (client: Sql): MemberRepository => ({
  accountOrigin: async (memberId) => {
    const rows = await client<{ provisionedBy: string }[]>`
      select provisioned_by as "provisionedBy" from app_user where id = ${memberId}
    `
    const origin = rows[0]?.provisionedBy
    return origin === "init-tool" || origin === "sys" ? origin : null
  },
  countEnabledAdministrators: async (exceptMemberId) =>
    countEnabledAdministrators(client, exceptMemberId),
  create: async (input) => {
    try {
      return await client.begin((transaction) => createMember(transaction, input))
    } catch (error) {
      if (error instanceof MemberConflictError) throw error
      if (isPgError(error, "23505")) throw new MemberConflictError("duplicate_email")
      throw error
    }
  },
  createGroup: async (name) => {
    try {
      const rows = await client<AccessGroup[]>`
        insert into access_group (name)
        values (${name})
        returning id, name
      `
      const group = rows[0]
      if (group === undefined) throw new MemberPersistenceError()
      return { id: GroupIdSchema.parse(group.id), name: group.name }
    } catch (error) {
      if (isPgError(error, "23505")) throw new MemberConflictError("duplicate_group_name")
      throw error
    }
  },
  delete: async (memberId) => client.begin((transaction) => deleteMember(transaction, memberId)),
  get: async (memberId) => memberById(client, memberId),
  list: async () => {
    const rows = await client<MemberRow[]>`
      select ${columns(client)}
      from app_user
      left join user_group on user_group.user_id = app_user.id
      group by app_user.id, app_user.email, app_user.display_name, app_user.role, app_user.enabled, app_user.created_at
      order by app_user.created_at desc, app_user.id desc
    `
    return rows.map(toMember)
  },
  listGroups: async () => {
    const rows = await client<{ readonly id: string; readonly name: string }[]>`
      select id, name from access_group
      where id <> '00000000-0000-4000-8000-000000000001'::uuid
      order by name asc, id asc
    `
    return rows.map((row) => ({ id: GroupIdSchema.parse(row.id), name: row.name }))
  },
  listDisplayNames: async () => {
    const rows = await client<{ readonly displayName: string }[]>`
      select display_name as "displayName" from app_user
    `
    return rows.map((row) => row.displayName)
  },
  transaction: async (callback) => {
    try {
      const result = await client.begin(async (transaction) => ({
        value: await callback({
          appendAudit: (input) => appendAudit(transaction, input),
          countEnabledAdministrators: (exceptMemberId) =>
            countEnabledAdministrators(transaction, exceptMemberId),
          create: (input) => createMember(transaction, input),
          delete: (memberId) => deleteMember(transaction, memberId),
          get: async (memberId) => {
            if (!(await lockMember(transaction, memberId))) return null
            const member = await memberById(transaction, memberId)
            if (member === null) throw new MemberPersistenceError()
            return member
          },
          lockAdministratorRoster: async () => {
            await transaction`select pg_advisory_xact_lock(${AdministratorRosterLockId})`
          },
          replacePermissions: async (memberId, pages, revokeSessions) => {
            await transaction`delete from user_page_permission where user_id = ${memberId}`
            await insertUserPages(transaction, memberId, pages)
            if (revokeSessions)
              await transaction`
                update app_session
                set revoked_at = now()
                where user_id = ${memberId} and revoked_at is null
              `
          },
          update: (memberId, input) => updateMember(transaction, memberId, input),
        }),
      }))
      return result.value
    } catch (error) {
      if (error instanceof MemberConflictError) throw error
      if (isPgError(error, "23505")) throw new MemberConflictError("duplicate_email")
      throw error
    }
  },
  update: async (memberId, input) =>
    client.begin((transaction) => updateMember(transaction, memberId, input)),
})

export const createInMemoryMemberRepository = (): MemberRepository => {
  const members = new Map<MemberId, Member>()
  const groups = new Map<string, AccessGroup>()
  return {
    accountOrigin: async (memberId) => (members.has(memberId) ? "sys" : null),
    countEnabledAdministrators: async (exceptMemberId) =>
      [...members.values()].filter(
        (member) =>
          member.role === "administrator" && member.enabled && member.id !== exceptMemberId,
      ).length,
    create: async (input) => {
      const email = input.email.toLowerCase()
      if ([...members.values()].some((member) => member.email === email)) {
        throw new MemberConflictError("duplicate_email")
      }
      const groupIds = uniqueGroupIds(input.groupIds)
      const member: Member = {
        createdAt: new Date(),
        displayName: input.displayName,
        email,
        enabled: true,
        groupIds,
        id: MemberIdSchema.parse(crypto.randomUUID()),
        role: input.role,
      }
      members.set(member.id, member)
      return member
    },
    createGroup: async (name) => {
      if ([...groups.values()].some((group) => group.name === name)) {
        throw new MemberConflictError("duplicate_group_name")
      }
      const group: AccessGroup = { id: GroupIdSchema.parse(crypto.randomUUID()), name }
      groups.set(group.id, group)
      return group
    },
    delete: async (memberId) => {
      if (!members.has(memberId)) return false
      members.delete(memberId)
      return true
    },
    get: async (memberId) => members.get(memberId) ?? null,
    list: async () => [...members.values()],
    listDisplayNames: async () => [...members.values()].map((member) => member.displayName),
    listGroups: async () => [...groups.values()],
    update: async (memberId, input) => {
      const existing = members.get(memberId)
      if (existing === undefined) return null
      const groupIds = uniqueGroupIds(input.groupIds)
      const next: Member = {
        ...existing,
        displayName: input.displayName ?? existing.displayName,
        enabled: input.enabled,
        groupIds,
        role: input.role,
      }
      members.set(memberId, next)
      return next
    },
  }
}

class MemberPersistenceError extends Error {
  public constructor() {
    super("Member persistence did not return a record")
    this.name = "MemberPersistenceError"
  }
}
