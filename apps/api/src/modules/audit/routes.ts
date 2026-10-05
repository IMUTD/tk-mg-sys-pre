import type { Hono } from "hono"
import { z } from "zod"

import { PageKey } from "../../lib/pages"
import { authorizePageViewRequest, hasPageAuthorizationFailure } from "../access/page-authorization"
import type { AuthService } from "../auth/service"
import type { AuditExplorerRepository, AuditRepository } from "./service"

const AuditQuerySchema = z.object({
  action: z.string().trim().min(1).max(160).optional(),
  actorId: z.string().uuid().optional(),
  createdAfter: z.coerce.date().optional(),
  createdBefore: z.coerce.date().optional(),
  groupId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  target: z.string().trim().min(1).max(320).optional(),
})

export const registerAuditRoutes = (
  app: Hono,
  authService: AuthService,
  auditRepository: AuditRepository,
  explorerRepository: AuditExplorerRepository,
): void => {
  app.get("/api/audit", async (context) => {
    const authorization = await authorizePageViewRequest(
      context,
      authService,
      auditRepository,
      "audit.list",
      "audit:all",
      PageKey.WorkLogs,
    )
    if (hasPageAuthorizationFailure(authorization)) return authorization.response
    const query = AuditQuerySchema.safeParse(context.req.query())
    return query.success
      ? context.json(await explorerRepository.list(query.data))
      : context.json({ error: "invalid_audit_filter" }, 400)
  })
}
