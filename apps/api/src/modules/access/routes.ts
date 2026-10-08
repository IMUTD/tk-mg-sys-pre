import type { Hono } from "hono"

import { GroupIdSchema, Permission, Role } from "../../lib/authorization"
import { PageKey } from "../../lib/pages"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import type { AuthService, SessionPrincipal } from "../auth/service"
import type { AccessGroup } from "../members/repository"
import { requireGroupAccess, requirePageView, requirePermission } from "./service"

const authenticationRequired = { error: "authentication_required" } as const

const resolvePrincipal = async (
  request: Request,
  authService: AuthService,
): Promise<SessionPrincipal | null> => {
  const cookieHeader = request.headers.get("cookie")
  if (cookieHeader === null) {
    return null
  }

  const tokenPart = cookieHeader.split(";").find((part) => part.trim().startsWith("tk_mg_session="))
  if (tokenPart === undefined) {
    return null
  }

  const [, token] = tokenPart.trim().split("=")
  if (token === undefined || token.length === 0) {
    return null
  }
  return authService.session(token)
}

const writeDeniedAuditEvent = async (
  auditRepository: AuditRepository,
  actorId: string,
  action: string,
  target: string,
): Promise<void> => {
  await writeAuditEvent(auditRepository, {
    action,
    actorId,
    outcome: "denied",
    target,
  })
}

export const registerFoundationAccessRoutes = (
  app: Hono,
  authService: AuthService,
  auditRepository: AuditRepository,
  groups?: { readonly listGroups: () => Promise<readonly AccessGroup[]> },
): void => {
  if (groups !== undefined) {
    app.get("/api/access/groups", async (context) => {
      const principal = await resolvePrincipal(context.req.raw, authService)
      if (principal === null) {
        return context.json(authenticationRequired, 401)
      }
      const permission = requirePermission(principal.scope, Permission.DevicesRead)
      const page = requirePageView(principal.scope, PageKey.Devices)
      if (permission.kind === "denied" || page.kind === "denied") {
        await writeDeniedAuditEvent(
          auditRepository,
          principal.userId,
          "access.groups.list",
          "group:all",
        )
        return context.json({ error: "permission_denied" }, 403)
      }
      const allGroups = await groups.listGroups()
      const visibleGroups =
        principal.scope.role === Role.Administrator && !principal.scope.restrictGroups
          ? allGroups
          : allGroups.filter((group) => principal.scope.groupIds.includes(group.id))
      return context.json({ items: visibleGroups })
    })
  }

  app.get("/api/groups/:groupId/resources", async (context) => {
    const principal = await resolvePrincipal(context.req.raw, authService)
    if (principal === null) {
      return context.json(authenticationRequired, 401)
    }

    const permission = requirePermission(principal.scope, Permission.ResourcesRead)
    if (permission.kind === "denied") {
      await writeDeniedAuditEvent(
        auditRepository,
        principal.userId,
        "resource.export",
        `group:${context.req.param("groupId")}`,
      )
      return context.json({ error: "permission_denied" }, 403)
    }

    if (requirePageView(principal.scope, PageKey.StudioTextPool).kind === "denied") {
      await writeDeniedAuditEvent(
        auditRepository,
        principal.userId,
        "resource.export",
        `group:${context.req.param("groupId")}`,
      )
      return context.json({ error: "permission_denied" }, 403)
    }

    const groupId = GroupIdSchema.safeParse(context.req.param("groupId"))
    if (!groupId.success || requireGroupAccess(principal.scope, groupId.data).kind === "hidden") {
      await writeDeniedAuditEvent(
        auditRepository,
        principal.userId,
        "resource.export",
        `group:${context.req.param("groupId")}`,
      )
      return context.json({ error: "not_found" }, 404)
    }

    return context.json({ groupId: groupId.data, resources: [] })
  })

  app.get("/api/foundation/configuration", async (context) => {
    const principal = await resolvePrincipal(context.req.raw, authService)
    if (principal === null) {
      return context.json(authenticationRequired, 401)
    }

    const permission = requirePermission(principal.scope, Permission.ConfigurationWrite)
    const page = requirePageView(principal.scope, PageKey.Configuration)
    if (permission.kind === "denied" || page.kind === "denied") {
      await writeDeniedAuditEvent(
        auditRepository,
        principal.userId,
        "configuration.write",
        "foundation:configuration",
      )
      return context.json({ error: "permission_denied" }, 403)
    }

    return context.json({ status: "authorized" })
  })
}
