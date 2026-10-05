import type { Context } from "hono"

import { GroupIdSchema, type Permission } from "../../lib/authorization"
import { requireGroupAccess, requirePageView, requirePermission } from "../access/service"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import type { AuthService, SessionPrincipal } from "../auth/service"

const SessionCookieName = "tk_mg_session"

export type AuthorizedResourceRequest = {
  readonly groupId: string
  readonly principal: SessionPrincipal
}

export type ResourceAuthorizationFailure = { readonly response: Response }

const resolvePrincipal = async (
  request: Request,
  authService: AuthService,
): Promise<SessionPrincipal | null> => {
  const cookieHeader = request.headers.get("cookie")
  if (cookieHeader === null) {
    return null
  }
  const tokenPart = cookieHeader
    .split(";")
    .find((part) => part.trim().startsWith(`${SessionCookieName}=`))
  if (tokenPart === undefined) {
    return null
  }
  const [, token] = tokenPart.trim().split("=")
  if (token === undefined || token.length === 0) {
    return null
  }
  return authService.session(token)
}

const auditDenied = async (
  auditRepository: AuditRepository,
  actorId: string,
  action: string,
  target: string,
): Promise<void> => {
  await writeAuditEvent(auditRepository, { action, actorId, outcome: "denied", target })
}

export const authorizeResourceRequest = async (
  context: Context,
  authService: AuthService,
  auditRepository: AuditRepository,
  action: string,
  permission: Permission,
  pageKey: string,
): Promise<AuthorizedResourceRequest | ResourceAuthorizationFailure> => {
  const principal = await resolvePrincipal(context.req.raw, authService)
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
  const parsedGroupId = GroupIdSchema.safeParse(rawGroupId)
  if (
    !parsedGroupId.success ||
    requireGroupAccess(principal.scope, parsedGroupId.data).kind === "hidden"
  ) {
    await auditDenied(auditRepository, principal.userId, action, `group:${rawGroupId}`)
    return { response: context.json({ error: "not_found" }, 404) }
  }
  return { groupId: parsedGroupId.data, principal }
}

export const hasResourceAuthorizationFailure = (
  result: AuthorizedResourceRequest | ResourceAuthorizationFailure,
): result is ResourceAuthorizationFailure => "response" in result
