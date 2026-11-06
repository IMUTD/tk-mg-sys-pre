import type { Context, Hono } from "hono"

import { canViewPage } from "../../lib/authorization"
import { PageKey } from "../../lib/pages"
import { authorizePageViewRequest, hasPageAuthorizationFailure } from "../access/page-authorization"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import type { AuthService, SessionPrincipal } from "../auth/service"
import {
  StorageConfigurationInvalidError,
  StorageConfigurationUpdateSchema,
  StorageSecretRequiredError,
  type StorageService,
} from "./service"

const tokenFrom = (request: Request): string | null => {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .find((part) => part.trim().startsWith("tk_mg_session="))
    ?.trim()
    .slice(14)
  return token === undefined || token.length === 0 ? null : token
}

const authorizeStorageStatus = async (
  context: Context,
  authService: AuthService,
  auditRepository: AuditRepository,
): Promise<SessionPrincipal | Response> => {
  const token = tokenFrom(context.req.raw)
  const principal = token === null ? null : await authService.session(token)
  if (principal === null) return context.json({ error: "authentication_required" }, 401)
  if (canViewPage(principal.scope, PageKey.Storage)) return principal
  await writeAuditEvent(auditRepository, {
    action: "storage.status.read",
    actorId: principal.userId,
    outcome: "denied",
    target: "storage:private-cloud",
  })
  return context.json({ error: "permission_denied" }, 403)
}

const isResponse = (value: SessionPrincipal | Response): value is Response =>
  value instanceof Response

const parseUpdate = async (request: Request) => {
  try {
    const parsed = StorageConfigurationUpdateSchema.safeParse(await request.json())
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

export const registerStorageRoutes = (
  app: Hono,
  authService: AuthService,
  auditRepository: AuditRepository,
  service: StorageService,
): void => {
  app.get("/api/storage/status", async (context) => {
    const authorization = await authorizeStorageStatus(context, authService, auditRepository)
    return isResponse(authorization)
      ? authorization
      : context.json(await service.getStatus(authorization.userId))
  })
  app.get("/api/storage/configuration", async (context) => {
    const authorization = await authorizePageViewRequest(
      context,
      authService,
      auditRepository,
      "storage.configuration.read",
      "storage:private-cloud",
      PageKey.Storage,
    )
    return hasPageAuthorizationFailure(authorization)
      ? authorization.response
      : context.json(await service.getStatus(authorization.principal.userId))
  })
  app.patch("/api/storage/configuration", async (context) => {
    const authorization = await authorizePageViewRequest(
      context,
      authService,
      auditRepository,
      "storage.configuration.update",
      "storage:private-cloud",
      PageKey.Storage,
    )
    if (hasPageAuthorizationFailure(authorization)) return authorization.response
    const input = await parseUpdate(context.req.raw)
    if (input === null) {
      return context.json({ error: "invalid_storage_configuration" }, 400)
    }
    try {
      return context.json(await service.update(authorization.principal.userId, input))
    } catch (error) {
      if (error instanceof StorageSecretRequiredError || error instanceof StorageConfigurationInvalidError) {
        return context.json({ error: "invalid_storage_configuration" }, 400)
      }
      throw error
    }
  })
}
