import type { Hono } from "hono"

import { PageKey } from "../../lib/pages"
import { authorizePageViewRequest, hasPageAuthorizationFailure } from "../access/page-authorization"
import type { AuditRepository } from "../audit/service"
import type { AuthService } from "../auth/service"
import { type SettingsService, SystemSettingsUpdateSchema } from "./service"

const parseUpdate = async (request: Request) => {
  try {
    const parsed = SystemSettingsUpdateSchema.safeParse(await request.json())
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

export const registerSettingsRoutes = (
  app: Hono,
  authService: AuthService,
  auditRepository: AuditRepository,
  service: SettingsService,
): void => {
  app.get("/api/settings/system", async (context) => {
    const authorization = await authorizePageViewRequest(
      context,
      authService,
      auditRepository,
      "settings.read",
      "settings:system",
      PageKey.Configuration,
    )
    return hasPageAuthorizationFailure(authorization)
      ? authorization.response
      : context.json(await service.get())
  })
  app.patch("/api/settings/system", async (context) => {
    const authorization = await authorizePageViewRequest(
      context,
      authService,
      auditRepository,
      "settings.update",
      "settings:system",
      PageKey.Configuration,
    )
    if (hasPageAuthorizationFailure(authorization)) return authorization.response
    const input = await parseUpdate(context.req.raw)
    return input === null
      ? context.json({ error: "invalid_system_settings" }, 400)
      : context.json(await service.update(authorization.principal.userId, input))
  })
}
