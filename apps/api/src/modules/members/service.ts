import { z } from "zod"

import { type GroupId, GroupIdSchema, Role, RoleSchema, type UserId } from "../../lib/authorization"
import { mergePageAccess, type PAGE_CATALOG, type PageAccess } from "../../lib/pages"
import type { AuditEventInput, AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import { pickMemberDisplayName } from "./display-names"
import type { PagePermissionRepository } from "./page-permission-repository"
import {
  type AccessGroup,
  type Member,
  MemberConflictError,
  type MemberId,
  MemberIdSchema,
  type MemberRepository,
  type MemberUpdateInput,
} from "./repository"

export { MemberConflictError } from "./repository"

const sharesGroup = (left: readonly GroupId[], right: readonly GroupId[]): boolean =>
  left.some((groupId) => right.includes(groupId))

const groupsForUpdate = (
  actor: Member | null,
  existing: Member,
  requested: readonly GroupId[] | undefined,
  role: Member["role"],
): readonly GroupId[] | null => {
  if (role === Role.Administrator && existing.role !== Role.Administrator) {
    throw new MemberConflictError("administrator_only_in_init_tool")
  }
  if (actor !== null && actor.role !== Role.Administrator) {
    if (role === Role.Administrator)
      throw new MemberConflictError("administrator_only_in_init_tool")
    if (!sharesGroup(actor.groupIds, existing.groupIds)) return null
    return actor.groupIds
  }
  return requested === undefined ? existing.groupIds : uniqueGroupIds(requested)
}

const assertNotInitToolAccount = async (
  repository: MemberRepository,
  memberId: MemberId,
): Promise<void> => {
  if ((await repository.accountOrigin(memberId)) === "init-tool") {
    throw new MemberConflictError("init_tool_account")
  }
}

export const MemberCreateSchema = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  email: z.string().trim().email(),
  groupIds: z.array(GroupIdSchema).max(100).default([]),
  password: z.string(),
  role: RoleSchema,
})
export const MemberUpdateSchema = z.object({
  enabled: z.boolean(),
  groupIds: z.array(GroupIdSchema).max(100).optional(),
  password: z.string().optional(),
  role: RoleSchema,
})
export const AccessGroupCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
})
export const MemberPermissionUpdateSchema = z.object({
  pages: z
    .array(
      z.object({
        canDelete: z.boolean(),
        canView: z.boolean(),
        key: z.string().min(1),
      }),
    )
    .min(1)
    .max(200),
})
export type MemberCreate = z.infer<typeof MemberCreateSchema>
export type MemberUpdate = z.infer<typeof MemberUpdateSchema>
export type AccessGroupCreate = z.infer<typeof AccessGroupCreateSchema>
export type MemberPermissionUpdate = z.infer<typeof MemberPermissionUpdateSchema>

export type PublicMember = Member

const uniqueGroupIds = (groupIds: readonly GroupId[]): readonly GroupId[] => [...new Set(groupIds)]

export interface MemberService {
  create(actorId: UserId, input: MemberCreate): Promise<PublicMember>
  createGroup(actorId: UserId, input: AccessGroupCreate): Promise<AccessGroup>
  delete(actorId: UserId, memberId: MemberId): Promise<"deleted" | "not_found">
  list(): Promise<readonly PublicMember[]>
  listCatalog(): typeof PAGE_CATALOG
  listGroups(): Promise<readonly AccessGroup[]>
  listMemberPermissions(memberId: MemberId): Promise<readonly PageAccess[] | null>
  suggestDisplayName(exclude?: readonly string[]): Promise<string>
  replaceMemberPermissions(
    actorId: UserId,
    memberId: MemberId,
    input: MemberPermissionUpdate,
  ): Promise<readonly PageAccess[] | null>
  update(actorId: UserId, memberId: MemberId, input: MemberUpdate): Promise<PublicMember | null>
}

type Dependencies = {
  readonly auditRepository: AuditRepository
  readonly pagePermissions: PagePermissionRepository
  readonly repository: MemberRepository
}

const writeMemberAuditEvents = async (
  auditRepository: AuditRepository,
  action:
    | "member.create"
    | "member.update"
    | "member.delete"
    | "member.group.create"
    | "member.permissions.update",
  actorId: UserId,
  target: string,
  groupIds: readonly string[] = [],
): Promise<void> => {
  const joined = groupIds.join(",")
  const auditedGroups = groupIds.length === 0 ? [null] : groupIds
  for (const groupId of auditedGroups)
    await writeAuditEvent(auditRepository, {
      action,
      actorId,
      metadata: groupId === null ? { groupIds: joined } : { groupId, groupIds: joined },
      outcome: "allowed",
      target,
    })
}

const assertNotLastAdministrator = async (
  countEnabledAdministrators: (exceptMemberId?: MemberId) => Promise<number>,
  member: Member,
  next?: Pick<MemberUpdate, "enabled" | "role">,
): Promise<void> => {
  if (member.role !== "administrator" || !member.enabled) return
  const demoting = next === undefined || next.role !== "administrator" || next.enabled === false
  if (!demoting) return
  const remaining = await countEnabledAdministrators(member.id)
  if (remaining === 0) throw new MemberConflictError("last_administrator")
}

const memberAuditInputs = (
  action:
    | "member.create"
    | "member.update"
    | "member.delete"
    | "member.group.create"
    | "member.permissions.update",
  actorId: UserId,
  target: string,
  groupIds: readonly string[] = [],
): readonly AuditEventInput[] => {
  const joined = groupIds.join(",")
  const auditedGroups = groupIds.length === 0 ? [null] : groupIds
  return auditedGroups.map((groupId) => ({
    action,
    actorId,
    metadata: groupId === null ? { groupIds: joined } : { groupId, groupIds: joined },
    outcome: "allowed" as const,
    target,
  }))
}

export const createMemberService = (dependencies: Dependencies): MemberService => ({
  create: async (actorId, input) => {
    const actor = await dependencies.repository.get(MemberIdSchema.parse(actorId))
    const requestedGroups = uniqueGroupIds(input.groupIds)
    let groupIds =
      requestedGroups.length > 0
        ? requestedGroups
        : (await dependencies.repository.listGroups()).map((group) => group.id)
    if (input.role === Role.Administrator) {
      throw new MemberConflictError("administrator_only_in_init_tool")
    }
    if (actor !== null) {
      if (actor.groupIds.length === 0) throw new MemberConflictError("invalid_group_ids")
      groupIds = actor.groupIds
    }
    const taken = await dependencies.repository.listDisplayNames()
    const displayName =
      input.displayName !== undefined && !taken.includes(input.displayName)
        ? input.displayName
        : pickMemberDisplayName(taken)
    const passwordHash = await Bun.password.hash(input.password)
    const transaction = dependencies.repository.transaction
    if (transaction !== undefined) {
      return transaction(async (workflow) => {
        const member = await workflow.create({
          displayName,
          email: input.email,
          groupIds,
          passwordHash,
          role: input.role,
        })
        await workflow.replacePermissions(member.id, mergePageAccess(member.role, []), false)
        for (const event of memberAuditInputs(
          "member.create",
          actorId,
          `member:${member.id}`,
          member.groupIds,
        ))
          await workflow.appendAudit(event)
        return member
      })
    }
    const member = await dependencies.repository.create({
      displayName,
      email: input.email,
      groupIds,
      passwordHash,
      role: input.role,
    })
    await dependencies.pagePermissions.seedForUser(member.id, member.role)
    await writeMemberAuditEvents(
      dependencies.auditRepository,
      "member.create",
      actorId,
      `member:${member.id}`,
      member.groupIds,
    )
    return member
  },
  createGroup: async (actorId, input) => {
    const actor = await dependencies.repository.get(MemberIdSchema.parse(actorId))
    if (actor !== null && actor.role !== Role.Administrator) {
      throw new MemberConflictError("administrator_only_in_init_tool")
    }
    const group = await dependencies.repository.createGroup(input.name)
    await writeMemberAuditEvents(
      dependencies.auditRepository,
      "member.group.create",
      actorId,
      `group:${group.id}`,
      [group.id],
    )
    return group
  },
  delete: async (actorId, memberId) => {
    if ((actorId as string) === (memberId as string))
      throw new MemberConflictError("cannot_delete_self")
    await assertNotInitToolAccount(dependencies.repository, memberId)
    const transaction = dependencies.repository.transaction
    if (transaction !== undefined) {
      return transaction(async (workflow) => {
        await workflow.lockAdministratorRoster()
        const existing = await workflow.get(memberId)
        if (existing === null) return "not_found"
        const actor = await workflow.get(MemberIdSchema.parse(actorId))
        if (
          actor !== null &&
          actor.role !== Role.Administrator &&
          !sharesGroup(actor.groupIds, existing.groupIds)
        ) {
          return "not_found"
        }
        await assertNotLastAdministrator(workflow.countEnabledAdministrators, existing)
        if (!(await workflow.delete(memberId))) return "not_found"
        for (const event of memberAuditInputs(
          "member.delete",
          actorId,
          `member:${memberId}`,
          existing.groupIds,
        ))
          await workflow.appendAudit(event)
        return "deleted"
      })
    }
    const existing = await dependencies.repository.get(memberId)
    if (existing === null) return "not_found"
    const actor = await dependencies.repository.get(MemberIdSchema.parse(actorId))
    if (
      actor !== null &&
      actor.role !== Role.Administrator &&
      !sharesGroup(actor.groupIds, existing.groupIds)
    ) {
      return "not_found"
    }
    await assertNotLastAdministrator(dependencies.repository.countEnabledAdministrators, existing)
    const deleted = await dependencies.repository.delete(memberId)
    if (!deleted) return "not_found"
    await writeMemberAuditEvents(
      dependencies.auditRepository,
      "member.delete",
      actorId,
      `member:${memberId}`,
      existing.groupIds,
    )
    return "deleted"
  },
  list: async () => dependencies.repository.list(),
  listCatalog: () => dependencies.pagePermissions.listCatalog(),
  listGroups: async () => dependencies.repository.listGroups(),
  listMemberPermissions: async (memberId) => {
    const member = await dependencies.repository.get(memberId)
    if (member === null) return null
    return dependencies.pagePermissions.listForUser(memberId, member.role)
  },
  suggestDisplayName: async (exclude = []) =>
    pickMemberDisplayName([...(await dependencies.repository.listDisplayNames()), ...exclude]),
  replaceMemberPermissions: async (actorId, memberId, input) => {
    await assertNotInitToolAccount(dependencies.repository, memberId)
    const transaction = dependencies.repository.transaction
    if (transaction !== undefined) {
      const member = await transaction(async (workflow) => {
        const lockedMember = await workflow.get(memberId)
        if (lockedMember === null) return null
        if (lockedMember.role === "administrator")
          throw new MemberConflictError("cannot_configure_administrator")
        const sanitized = mergePageAccess(lockedMember.role, input.pages)
        await workflow.replacePermissions(memberId, sanitized, true)
        for (const event of memberAuditInputs(
          "member.permissions.update",
          actorId,
          `member:${memberId}`,
        ))
          await workflow.appendAudit(event)
        return lockedMember
      })
      if (member === null) return null
      return dependencies.pagePermissions.listForUser(memberId, member.role)
    }
    const member = await dependencies.repository.get(memberId)
    if (member === null) return null
    if (member.role === "administrator")
      throw new MemberConflictError("cannot_configure_administrator")
    const sanitized = mergePageAccess(member.role, input.pages)
    const pages = await dependencies.pagePermissions.replaceForUser(
      memberId,
      member.role,
      sanitized,
    )
    await writeMemberAuditEvents(
      dependencies.auditRepository,
      "member.permissions.update",
      actorId,
      `member:${memberId}`,
    )
    return pages
  },
  update: async (actorId, memberId, input) => {
    await assertNotInitToolAccount(dependencies.repository, memberId)
    const passwordHash =
      input.password === undefined ? undefined : await Bun.password.hash(input.password)
    const transaction = dependencies.repository.transaction
    if (transaction !== undefined) {
      return transaction(async (workflow) => {
        await workflow.lockAdministratorRoster()
        const existing = await workflow.get(memberId)
        if (existing === null) return null
        const actor = await workflow.get(MemberIdSchema.parse(actorId))
        const groupIds = groupsForUpdate(actor, existing, input.groupIds, input.role)
        if (groupIds === null) return null
        await assertNotLastAdministrator(workflow.countEnabledAdministrators, existing, input)
        const updateInput: MemberUpdateInput = {
          enabled: input.enabled,
          groupIds,
          role: input.role,
        }
        const member = await workflow.update(
          memberId,
          passwordHash === undefined ? updateInput : { ...updateInput, passwordHash },
        )
        if (member === null) return null
        if (existing.role !== input.role) {
          await workflow.replacePermissions(member.id, mergePageAccess(input.role, []), true)
        }
        for (const event of memberAuditInputs(
          "member.update",
          actorId,
          `member:${member.id}`,
          member.groupIds,
        ))
          await workflow.appendAudit(event)
        return member
      })
    }
    const existing = await dependencies.repository.get(memberId)
    if (existing === null) return null
    const actor = await dependencies.repository.get(MemberIdSchema.parse(actorId))
    const groupIds = groupsForUpdate(actor, existing, input.groupIds, input.role)
    if (groupIds === null) return null
    const updateInput: MemberUpdateInput = {
      enabled: input.enabled,
      groupIds,
      role: input.role,
    }
    await assertNotLastAdministrator(
      dependencies.repository.countEnabledAdministrators,
      existing,
      input,
    )
    const member = await dependencies.repository.update(
      memberId,
      passwordHash === undefined ? updateInput : { ...updateInput, passwordHash },
    )
    if (member === null) return null
    if (existing.role !== input.role) {
      await dependencies.pagePermissions.seedForUser(member.id, input.role)
    }
    await writeMemberAuditEvents(
      dependencies.auditRepository,
      "member.update",
      actorId,
      `member:${member.id}`,
      member.groupIds,
    )
    return member
  },
})
