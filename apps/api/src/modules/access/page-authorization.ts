import type { Context } from "hono"

import { canViewPage } from "../../lib/authorization"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import type { AuthService, SessionPrincipal } from "../auth/service"
import { requirePageDelete } from "./service"

export type AuthorizedPageRequest = { readonly principal: SessionPrincipal }
export type PageAuthorizationFailure = { readonly response: Response }

const tokenFrom = (request: Request): string | null => {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .find((part) => part.trim().startsWith("tk_mg_session="))
    ?.trim()
    .slice(14)
  return token === undefined || token.length === 0 ? null : token
}

export const authorizePageViewRequest = async (
  context: Context,
  authService: AuthService,
  auditRepository: AuditRepository,
  action: string,
  target: string,
  pageKey: string,
): Promise<AuthorizedPageRequest | PageAuthorizationFailure> => {
  const token = tokenFrom(context.req.raw)
  const principal = token === null ? null : await authService.session(token)
  if (principal === null)
    return { response: context.json({ error: "authentication_required" }, 401) }
  if (!canViewPage(principal.scope, pageKey)) {
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

export const hasPageAuthorizationFailure = (
  result: AuthorizedPageRequest | PageAuthorizationFailure,
): result is PageAuthorizationFailure => "response" in result

export const rejectUnlessPageDelete = async (
  context: Context,
  auditRepository: AuditRepository,
  principal: SessionPrincipal,
  action: string,
  target: string,
  pageKey: string,
): Promise<Response | null> => {
  if (requirePageDelete(principal.scope, pageKey).kind === "allowed") return null
  await writeAuditEvent(auditRepository, {
    action,
    actorId: principal.userId,
    outcome: "denied",
    target,
  })
  return context.json({ error: "permission_denied" }, 403)
}
