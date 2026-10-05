import type { Context } from "hono"

import { GroupIdSchema, type Permission } from "../../lib/authorization"
import { requireGroupAccess, requirePageView, requirePermission } from "../access/service"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import type { AuthService, SessionPrincipal } from "../auth/service"

export type AuthorizedOperationRequest = {
  readonly groupId: string
  readonly principal: SessionPrincipal
}
export type OperationAuthorizationFailure = { readonly response: Response }

const tokenFrom = (request: Request): string | null => {
  const cookies = request.headers.get("cookie")
  const token = cookies
    ?.split(";")
    .find((part) => part.trim().startsWith("tk_mg_session="))
    ?.trim()
    .slice(14)
  return token === undefined || token.length === 0 ? null : token
}

export const authorizeOperationRequest = async (
  context: Context,
  authService: AuthService,
  auditRepository: AuditRepository,
  action: string,
  permission: Permission,
  pageKey: string,
): Promise<AuthorizedOperationRequest | OperationAuthorizationFailure> => {
  const token = tokenFrom(context.req.raw)
  const principal = token === null ? null : await authService.session(token)
  if (principal === null)
    return { response: context.json({ error: "authentication_required" }, 401) }
  const rawGroupId = context.req.param("groupId")
  const denied =
    requirePermission(principal.scope, permission).kind === "denied" ||
    requirePageView(principal.scope, pageKey).kind === "denied"
  const group = GroupIdSchema.safeParse(rawGroupId)
  const hidden =
    !group.success ||
    (group.success && requireGroupAccess(principal.scope, group.data).kind === "hidden")
  if (denied || hidden) {
    await writeAuditEvent(auditRepository, {
      action,
      actorId: principal.userId,
      outcome: "denied",
      target: `group:${rawGroupId}`,
    })
    return {
      response: context.json(
        { error: denied ? "permission_denied" : "not_found" },
        denied ? 403 : 404,
      ),
    }
  }
  return { groupId: group.data, principal }
}

export const hasOperationAuthorizationFailure = (
  result: AuthorizedOperationRequest | OperationAuthorizationFailure,
): result is OperationAuthorizationFailure => "response" in result
