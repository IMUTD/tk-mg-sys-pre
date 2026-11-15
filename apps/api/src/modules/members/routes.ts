import type { Hono } from "hono"
import type { z } from "zod"

import { isPlatformScope, Role } from "../../lib/authorization"

import {
  authorizeAdministratorRequest,
  hasAdministratorAuthorizationFailure,
} from "../access/administrator-authorization"
import type { AuditRepository } from "../audit/service"
import type { AuthService, SessionPrincipal } from "../auth/service"
import { type Member, MemberIdSchema } from "./repository"
import {
  AccessGroupCreateSchema,
  MemberConflictError,
  MemberCreateSchema,
  MemberPermissionUpdateSchema,
  type MemberService,
  MemberUpdateSchema,
} from "./service"

const parseJson = async <T>(request: Request, schema: z.ZodType<T>): Promise<T | null> => {
  try {
    const parsed = schema.safeParse(await request.json())
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

const conflictStatus = (code: string): 400 | 403 | 409 =>
  code === "invalid_group_ids" ? 400 : code === "secondary_cannot_create" ? 403 : 409

const LEGACY_SYSTEM_ACTOR_ID = "99999999-9999-4999-8999-999999999999"

/** 部署和执行审计用的内部账号：停用的管理员、邮箱在 .internal 域，不是真实用户。 */
const isSystemAccount = (member: Member): boolean =>
  member.id === LEGACY_SYSTEM_ACTOR_ID ||
  (member.role === Role.Administrator && !member.enabled && /@[^@]+\.internal$/.test(member.email))

/** 平台方 → 一级用户（初始化工具建的管理员）→ 二级用户（一级在本系统建的成员）。 */
const memberLevel = (member: Member): "platform" | "primary" | "secondary" =>
  member.isPlatform === true
    ? "platform"
    : member.role === Role.Administrator
      ? "primary"
      : "secondary"

const handleConflict = (error: unknown): error is MemberConflictError =>
  error instanceof MemberConflictError

export const registerMemberRoutes = (
  app: Hono,
  authService: AuthService,
  auditRepository: AuditRepository,
  service: MemberService,
): void => {
  const visibleMember = async (principal: SessionPrincipal, memberId: string): Promise<boolean> => {
    if (isPlatformScope(principal.scope)) return true
    const member = (await service.list()).find((item) => item.id === memberId)
    return (
      member !== undefined &&
      (member.id === principal.userId ||
        member.groupIds.some((groupId) => principal.scope.groupIds.includes(groupId)))
    )
  }
  app.get("/api/members/pages", async (context) => {
    const authorization = await authorizeAdministratorRequest(
      context,
      authService,
      auditRepository,
      "member.pages",
      "member:pages",
    )
    return hasAdministratorAuthorizationFailure(authorization)
      ? authorization.response
      : context.json({ items: service.listCatalog() })
  })
  app.get("/api/members/display-name", async (context) => {
    const authorization = await authorizeAdministratorRequest(
      context,
      authService,
      auditRepository,
      "member.display-name",
      "member:display-name",
    )
    if (hasAdministratorAuthorizationFailure(authorization)) return authorization.response
    const exclude = (context.req.query("exclude") ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
    return context.json({ displayName: await service.suggestDisplayName(exclude) })
  })
  app.get("/api/members/:memberId/permissions", async (context) => {
    const authorization = await authorizeAdministratorRequest(
      context,
      authService,
      auditRepository,
      "member.permissions.read",
      `member:${context.req.param("memberId")}`,
    )
    if (hasAdministratorAuthorizationFailure(authorization)) return authorization.response
    const memberId = MemberIdSchema.safeParse(context.req.param("memberId"))
    if (!memberId.success) return context.json({ error: "invalid_member_id" }, 400)
    if (!(await visibleMember(authorization.principal, memberId.data)))
      return context.json({ error: "not_found" }, 404)
    const items = await service.listMemberPermissions(memberId.data)
    return items === null ? context.json({ error: "not_found" }, 404) : context.json({ items })
  })
  app.put("/api/members/:memberId/permissions", async (context) => {
    const authorization = await authorizeAdministratorRequest(
      context,
      authService,
      auditRepository,
      "member.permissions.update",
      `member:${context.req.param("memberId")}`,
    )
    if (hasAdministratorAuthorizationFailure(authorization)) return authorization.response
    const memberId = MemberIdSchema.safeParse(context.req.param("memberId"))
    if (!memberId.success) return context.json({ error: "invalid_member_id" }, 400)
    if (!(await visibleMember(authorization.principal, memberId.data)))
      return context.json({ error: "not_found" }, 404)
    const input = await parseJson(context.req.raw, MemberPermissionUpdateSchema)
    if (input === null) return context.json({ error: "invalid_member_permissions" }, 400)
    try {
      const items = await service.replaceMemberPermissions(
        authorization.principal.userId,
        memberId.data,
        input,
      )
      return items === null ? context.json({ error: "not_found" }, 404) : context.json({ items })
    } catch (error) {
      if (handleConflict(error))
        return context.json({ error: error.code }, conflictStatus(error.code))
      throw error
    }
  })
  app.get("/api/members/groups", async (context) => {
    const authorization = await authorizeAdministratorRequest(
      context,
      authService,
      auditRepository,
      "member.groups.list",
      "member:groups",
    )
    if (hasAdministratorAuthorizationFailure(authorization)) return authorization.response
    const items = await service.listGroups()
    const mine = new Set(authorization.principal.scope.groupIds)
    return context.json({ items: items.filter((item) => mine.has(item.id)) })
  })
  app.post("/api/members/groups", async (context) => {
    const authorization = await authorizeAdministratorRequest(
      context,
      authService,
      auditRepository,
      "member.groups.create",
      "member:groups",
    )
    if (hasAdministratorAuthorizationFailure(authorization)) return authorization.response
    const input = await parseJson(context.req.raw, AccessGroupCreateSchema)
    if (input === null) return context.json({ error: "invalid_group_request" }, 400)
    try {
      return context.json(await service.createGroup(authorization.principal.userId, input), 201)
    } catch (error) {
      if (handleConflict(error))
        return context.json({ error: error.code }, conflictStatus(error.code))
      throw error
    }
  })
  app.get("/api/members", async (context) => {
    const authorization = await authorizeAdministratorRequest(
      context,
      authService,
      auditRepository,
      "member.list",
      "member:all",
    )
    if (hasAdministratorAuthorizationFailure(authorization)) return authorization.response
    const [items, groups] = await Promise.all([service.list(), service.listGroups()])
    const mine = new Set(authorization.principal.scope.groupIds)
    const selfId = authorization.principal.userId
    const platform = isPlatformScope(authorization.principal.scope)
    const groupNames = new Map(groups.map((group) => [group.id, group.name]))
    return context.json({
      items: items
        .filter((item) => {
          if (isSystemAccount(item)) return false
          // 平台方能看到所有用户，包括初始化工具建的一级用户和各客户的二级用户。
          if (platform) return true
          if (item.id === selfId) return true
          if (item.role === Role.Administrator) return false
          return item.groupIds.some((groupId) => mine.has(groupId))
        })
        .map((item) => ({
          ...item,
          groups: item.groupIds.flatMap((groupId) => {
            const name = groupNames.get(groupId)
            return name === undefined ? [] : [{ id: groupId, name }]
          }),
          level: memberLevel(item),
        })),
    })
  })
  app.post("/api/members", async (context) => {
    const authorization = await authorizeAdministratorRequest(
      context,
      authService,
      auditRepository,
      "member.create",
      "member:all",
    )
    if (hasAdministratorAuthorizationFailure(authorization)) return authorization.response
    const input = await parseJson(context.req.raw, MemberCreateSchema)
    if (input === null) return context.json({ error: "invalid_member_request" }, 400)
    try {
      return context.json(await service.create(authorization.principal.userId, input), 201)
    } catch (error) {
      if (handleConflict(error))
        return context.json({ error: error.code }, conflictStatus(error.code))
      throw error
    }
  })
  app.patch("/api/members/:memberId", async (context) => {
    const authorization = await authorizeAdministratorRequest(
      context,
      authService,
      auditRepository,
      "member.update",
      `member:${context.req.param("memberId")}`,
    )
    if (hasAdministratorAuthorizationFailure(authorization)) return authorization.response
    const memberId = MemberIdSchema.safeParse(context.req.param("memberId"))
    if (!memberId.success) return context.json({ error: "invalid_member_id" }, 400)
    if (!(await visibleMember(authorization.principal, memberId.data)))
      return context.json({ error: "not_found" }, 404)
    const input = await parseJson(context.req.raw, MemberUpdateSchema)
    if (input === null) return context.json({ error: "invalid_member_request" }, 400)
    if (
      authorization.principal.scope.restrictGroups &&
      input.groupIds?.some((groupId) => !authorization.principal.scope.groupIds.includes(groupId))
    )
      return context.json({ error: "not_found" }, 404)
    try {
      const member = await service.update(authorization.principal.userId, memberId.data, input)
      return member === null ? context.json({ error: "not_found" }, 404) : context.json(member)
    } catch (error) {
      if (handleConflict(error))
        return context.json({ error: error.code }, conflictStatus(error.code))
      throw error
    }
  })
  app.delete("/api/members/:memberId", async (context) => {
    const authorization = await authorizeAdministratorRequest(
      context,
      authService,
      auditRepository,
      "member.delete",
      `member:${context.req.param("memberId")}`,
    )
    if (hasAdministratorAuthorizationFailure(authorization)) return authorization.response
    const memberId = MemberIdSchema.safeParse(context.req.param("memberId"))
    if (!memberId.success) return context.json({ error: "invalid_member_id" }, 400)
    if (!(await visibleMember(authorization.principal, memberId.data)))
      return context.json({ error: "not_found" }, 404)
    try {
      const result = await service.delete(authorization.principal.userId, memberId.data)
      return result === "not_found"
        ? context.json({ error: "not_found" }, 404)
        : context.body(null, 204)
    } catch (error) {
      if (handleConflict(error))
        return context.json({ error: error.code }, conflictStatus(error.code))
      throw error
    }
  })
}
