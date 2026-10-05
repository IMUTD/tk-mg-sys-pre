import type { Context } from "hono"

import { GroupIdSchema, type Permission } from "../../lib/authorization"
import { requireGroupAccess, requirePageView, requirePermission } from "../access/service"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import type { AuthService, SessionPrincipal } from "../auth/service"

const sessionCookieName = "tk_mg_session"

export type AuthorizedDeviceRequest = {
  readonly groupId: string
  readonly principal: SessionPrincipal
}

export type DeviceAuthorizationFailure = { readonly response: Response }

const sessionTokenFrom = (request: Request): string | null => {
  const cookieHeader = request.headers.get("cookie")
  if (cookieHeader === null) {
    return null
  }
  const token = cookieHeader
    .split(";")
    .find((part) => part.trim().startsWith(`${sessionCookieName}=`))
    ?.trim()
    .slice(`${sessionCookieName}=`.length)
  return token === undefined || token.length === 0 ? null : token
}

const auditDenied = async (
  auditRepository: AuditRepository,
  actorId: string,
  action: string,
  target: string,
): Promise<void> => {
  await writeAuditEvent(auditRepository, { action, actorId, outcome: "denied", target })
}

export const authorizeDeviceRequest = async (
  context: Context,
  authService: AuthService,
  auditRepository: AuditRepository,
  action: string,
  permission: Permission,
  pageKey: string,
): Promise<AuthorizedDeviceRequest | DeviceAuthorizationFailure> => {
  const sessionToken = sessionTokenFrom(context.req.raw)
  const principal = sessionToken === null ? null : await authService.session(sessionToken)
  if (principal === null) {
    return { response: context.json({ error: "authentication_required" }, 401) }
  }
  const rawGroupId = context.req.param("groupId")
  if (
    requirePermission(principal.scope, permission).kind === "denied" ||
    requirePageView(principal.scope, pageKey).kind === "denied"
  ) {
    await auditDenied(auditRepository, principal.userId, action, `group:${rawGroupId}`)
    return { response: context.json({ error: "permission_denied" }, 403) }
  }
  const groupId = GroupIdSchema.safeParse(rawGroupId)
  if (!groupId.success || requireGroupAccess(principal.scope, groupId.data).kind === "hidden") {
    await auditDenied(auditRepository, principal.userId, action, `group:${rawGroupId}`)
    return { response: context.json({ error: "not_found" }, 404) }
  }
  return { groupId: groupId.data, principal }
}

export const hasDeviceAuthorizationFailure = (
  result: AuthorizedDeviceRequest | DeviceAuthorizationFailure,
): result is DeviceAuthorizationFailure => "response" in result
