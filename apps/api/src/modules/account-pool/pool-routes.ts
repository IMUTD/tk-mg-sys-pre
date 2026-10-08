import type { Context, Hono } from "hono"
import { z } from "zod"
import { canViewPage, Permission } from "../../lib/authorization"
import { PageKey } from "../../lib/pages"
import { rejectUnlessPageDelete } from "../access/page-authorization"
import type { AuditRepository } from "../audit/service"
import type { AuthService } from "../auth/service"
import {
  authorizeOperationRequest,
  hasOperationAuthorizationFailure,
} from "../resources/route-authorization"
import {
  PoolConsumeSchema,
  PoolError,
  PoolIdSchema,
  PoolListSchema,
  PoolSourceFilterSchema,
  PoolWriteSchema,
} from "./pool-model"
import type { PoolService } from "./pool-service"

const SourcesSchema = z.object({
  filter: PoolSourceFilterSchema,
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(500).default(10),
})
const BatchSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) })
const json = async <T>(context: Context, schema: z.ZodType<T>): Promise<T | null> => {
  try {
    const result = schema.safeParse(await context.req.json())
    return result.success ? result.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}
const respond = async (context: Context, operation: () => Promise<Response>): Promise<Response> => {
  try {
    return await operation()
  } catch (error) {
    if (!(error instanceof PoolError)) throw error
    const status =
      error.code === "account_pool_not_found"
        ? 404
        : [
              "account_pool_key_conflict",
              "account_pool_consumption_conflict",
              "account_pool_in_use",
            ].includes(error.code)
          ? 409
          : error.code === "account_pool_expired"
            ? 410
            : 400
    return context.json({ error: error.code }, status)
  }
}

export const registerPoolRoutes = (
  app: Hono,
  authService: AuthService,
  auditRepository: AuditRepository,
  service: PoolService,
): void => {
  const root = "/api/groups/:groupId/operations/account-pools"
  const authorize = (context: Context, action: string, write = false) =>
    authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      action,
      write ? Permission.OperationsWrite : Permission.OperationsRead,
      PageKey.AccountPool,
    )

  app.get(root, async (context) => {
    const auth = await authorize(context, "account-pool.list")
    if (hasOperationAuthorizationFailure(auth)) return auth.response
    const input = PoolListSchema.safeParse(context.req.query())
    if (!input.success) return context.json({ error: "invalid_account_pool_request" }, 400)
    return context.json(await service.list(auth.groupId, input.data))
  })
  app.get(`${root}/devices`, async (context) => {
    const auth = await authorize(context, "account-pool.devices")
    if (hasOperationAuthorizationFailure(auth)) return auth.response
    if (!canViewPage(auth.principal.scope, PageKey.Devices))
      return context.json({ error: "permission_denied" }, 403)
    return context.json({ items: await service.devices(auth.groupId) })
  })
  // This POST performs a filtered read, not a resource purchase or allocation.
  app.post(`${root}/sources`, async (context) => {
    const auth = await authorize(context, "account-pool.sources")
    if (hasOperationAuthorizationFailure(auth)) return auth.response
    if (!canViewPage(auth.principal.scope, PageKey.Accounts))
      return context.json({ error: "permission_denied" }, 403)
    const input = await json(context, SourcesSchema)
    if (input === null) return context.json({ error: "invalid_account_pool_request" }, 400)
    return context.json(
      await service.sources(auth.groupId, input.filter, input.page, input.pageSize),
    )
  })
  app.post(root, async (context) => {
    const auth = await authorize(context, "account-pool.create", true)
    if (hasOperationAuthorizationFailure(auth)) return auth.response
    if (!canViewPage(auth.principal.scope, PageKey.Accounts))
      return context.json({ error: "permission_denied" }, 403)
    const input = await json(context, PoolWriteSchema)
    if (input === null) return context.json({ error: "invalid_account_pool_request" }, 400)
    if (input.filter.deviceId !== null && !canViewPage(auth.principal.scope, PageKey.Devices))
      return context.json({ error: "permission_denied" }, 403)
    return respond(context, async () =>
      context.json(await service.create(auth.groupId, auth.principal.userId, input), 201),
    )
  })
  app.post(`${root}/batch-delete`, async (context) => {
    const auth = await authorize(context, "account-pool.delete", true)
    if (hasOperationAuthorizationFailure(auth)) return auth.response
    const denied = await rejectUnlessPageDelete(
      context,
      auditRepository,
      auth.principal,
      "account-pool.delete",
      `group:${auth.groupId}`,
      PageKey.AccountPool,
    )
    if (denied !== null) return denied
    const input = await json(context, BatchSchema)
    if (input === null) return context.json({ error: "invalid_account_pool_request" }, 400)
    return respond(context, async () =>
      context.json({
        deleted: await service.remove(auth.groupId, auth.principal.userId, input.ids),
      }),
    )
  })
  app.get(`${root}/:poolId`, async (context) => {
    const auth = await authorize(context, "account-pool.details")
    if (hasOperationAuthorizationFailure(auth)) return auth.response
    if (!canViewPage(auth.principal.scope, PageKey.Accounts))
      return context.json({ error: "permission_denied" }, 403)
    const id = PoolIdSchema.safeParse(context.req.param("poolId"))
    if (!id.success) return context.json({ error: "invalid_account_pool_id" }, 400)
    return respond(context, async () => context.json(await service.details(auth.groupId, id.data)))
  })
  app.post(`${root}/:poolId/consumption`, async (context) => {
    const auth = await authorize(context, "account-pool.consume", true)
    if (hasOperationAuthorizationFailure(auth)) return auth.response
    if (!canViewPage(auth.principal.scope, PageKey.Accounts))
      return context.json({ error: "permission_denied" }, 403)
    const id = PoolIdSchema.safeParse(context.req.param("poolId"))
    const input = await json(context, PoolConsumeSchema)
    if (!id.success || input === null)
      return context.json({ error: "invalid_account_pool_request" }, 400)
    return respond(context, async () => {
      await service.consume(auth.groupId, auth.principal.userId, id.data, input)
      return context.body(null, 204)
    })
  })
}
