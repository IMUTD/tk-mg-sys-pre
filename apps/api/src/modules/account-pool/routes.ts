import type { Hono } from "hono"
import { z } from "zod"
import { Permission, Role } from "../../lib/authorization"
import { PageKey } from "../../lib/pages"
import { OperationAccountIdSchema } from "../accounts/repository"
import type { AuditRepository } from "../audit/service"
import type { AuthService } from "../auth/service"
import {
  authorizeOperationRequest,
  hasOperationAuthorizationFailure,
} from "../resources/route-authorization"
import type { AccountPoolService } from "./service"

const LeaseSchema = z.object({ expiresAt: z.coerce.date().optional() })
const parseJson = async <T>(request: Request, schema: z.ZodType<T>): Promise<T | null> => {
  try {
    const parsed = schema.safeParse(await request.json())
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}
export const registerAccountPoolRoutes = (
  app: Hono,
  authService: AuthService,
  auditRepository: AuditRepository,
  service: AccountPoolService,
): void => {
  app.get("/api/groups/:groupId/operations/account-pool", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "account-pool.list",
      Permission.OperationsRead,
      PageKey.AccountPool,
    )
    return hasOperationAuthorizationFailure(authorization)
      ? authorization.response
      : context.json({ items: await service.list(authorization.groupId) })
  })
  app.post("/api/groups/:groupId/operations/account-pool/:accountId/leases", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "account.lease",
      Permission.OperationsWrite,
      PageKey.AccountPool,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const accountId = OperationAccountIdSchema.safeParse(context.req.param("accountId"))
    if (!accountId.success) return context.json({ error: "invalid_account_id" }, 400)
    const input = await parseJson(context.req.raw, LeaseSchema)
    if (input === null) return context.json({ error: "invalid_lease_request" }, 400)
    const result = await service.lease({
      accountId: accountId.data,
      ...input,
      groupId: authorization.groupId,
      operatorId: authorization.principal.userId,
    })
    return result.kind === "conflict"
      ? context.json({ error: "account_lease_conflict" }, 409)
      : context.json(result.lease, 201)
  })
  app.delete("/api/groups/:groupId/operations/account-pool/:accountId/leases", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "account.lease.release",
      Permission.OperationsWrite,
      PageKey.AccountPool,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const accountId = OperationAccountIdSchema.safeParse(context.req.param("accountId"))
    if (!accountId.success) return context.json({ error: "invalid_account_id" }, 400)
    return (await service.release({
      accountId: accountId.data,
      allowReclaim: authorization.principal.scope.role === Role.Administrator,
      groupId: authorization.groupId,
      operatorId: authorization.principal.userId,
    }))
      ? context.body(null, 204)
      : context.json({ error: "not_found" }, 404)
  })
}
