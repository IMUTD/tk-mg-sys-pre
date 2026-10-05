import type { Context } from "hono"

import { Role } from "../../lib/authorization"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import type { AuthService, SessionPrincipal } from "../auth/service"

export type AuthorizedAdministratorRequest = { readonly principal: SessionPrincipal }
export type AdministratorAuthorizationFailure = { readonly response: Response }

const tokenFrom = (request: Request): string | null => {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .find((part) => part.trim().startsWith("tk_mg_session="))
    ?.trim()
    .slice(14)
  return token === undefined || token.length === 0 ? null : token
}

export const authorizeAdministratorRequest = async (
  context: Context,
  authService: AuthService,
  auditRepository: AuditRepository,
  action: string,
  target: string,
): Promise<AuthorizedAdministratorRequest | AdministratorAuthorizationFailure> => {
  const token = tokenFrom(context.req.raw)
  const principal = token === null ? null : await authService.session(token)
  if (principal === null)
    return { response: context.json({ error: "authentication_required" }, 401) }
  const canManageMembers =
    principal.scope.role === Role.Administrator ||
    principal.scope.pages.some((page) => page.key === "/members" && page.canView)
  if (!canManageMembers) {
    await writeAuditEvent(auditRepository, {
      action,
      actorId: principal.userId,
      outcome: "denied",
      target,
    })
    return { response: context.json({ error: "not_found" }, 404) }
  }
  return { principal }
}

export const hasAdministratorAuthorizationFailure = (
  result: AuthorizedAdministratorRequest | AdministratorAuthorizationFailure,
): result is AdministratorAuthorizationFailure => "response" in result
