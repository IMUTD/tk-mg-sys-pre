import type { Hono } from "hono"
import { z } from "zod"

import { Permission } from "../../lib/authorization"
import { OperationDeleteConflictError } from "../../lib/operation-claim-guard"
import { PageKey } from "../../lib/pages"
import { rejectUnlessPageDelete } from "../access/page-authorization"
import type { AuditRepository } from "../audit/service"
import type { AuthService } from "../auth/service"
import {
  authorizeOperationRequest,
  hasOperationAuthorizationFailure,
} from "../resources/route-authorization"
import { ProxyIdSchema, ProxyStatusSchema } from "./repository"
import type { ProxyService } from "./service"

const TagsSchema = z.array(z.string().trim().min(1).max(64)).max(20).default([])
const CreateSchema = z.object({
  credentials: z.string().min(1).max(20_000),
  endpoint: z.string().trim().min(3).max(320),
  name: z.string().trim().min(1).max(160),
  note: z.string().max(2000).default(""),
  status: ProxyStatusSchema.default("ready"),
  tags: TagsSchema,
})
const UpdateSchema = z.object({
  credentials: z.string().min(1).max(20_000).optional(),
  endpoint: z.string().trim().min(3).max(320).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  note: z.string().max(2000).optional(),
  status: ProxyStatusSchema.optional(),
  tags: TagsSchema.optional(),
})
const ListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  query: z.string().trim().max(200).optional(),
  status: ProxyStatusSchema.optional(),
  tag: z.string().trim().min(1).max(64).optional(),
})
const BatchSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) })
const parseJson = async <T>(request: Request, schema: z.ZodType<T>): Promise<T | null> => {
  try {
    const parsed = schema.safeParse(await request.json())
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}
export const registerProxyRoutes = (
  app: Hono,
  authService: AuthService,
  auditRepository: AuditRepository,
  service: ProxyService,
): void => {
  app.get("/api/groups/:groupId/operations/proxies", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "proxy.list",
      Permission.OperationsRead,
      PageKey.Proxies,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const filter = ListSchema.safeParse(context.req.query())
    return !filter.success
      ? context.json({ error: "invalid_list_request" }, 400)
      : context.json(await service.list({ ...filter.data, groupId: authorization.groupId }))
  })
  app.post("/api/groups/:groupId/operations/proxies", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "proxy.create",
      Permission.OperationsWrite,
      PageKey.Proxies,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const input = await parseJson(context.req.raw, CreateSchema)
    return input === null
      ? context.json({ error: "invalid_proxy_request" }, 400)
      : context.json(
          await service.create(authorization.principal.userId, authorization.groupId, input),
          201,
        )
  })
  app.patch("/api/groups/:groupId/operations/proxies/:proxyId", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "proxy.update",
      Permission.OperationsWrite,
      PageKey.Proxies,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const proxyId = ProxyIdSchema.safeParse(context.req.param("proxyId"))
    if (!proxyId.success) return context.json({ error: "invalid_proxy_id" }, 400)
    const input = await parseJson(context.req.raw, UpdateSchema)
    if (input === null) return context.json({ error: "invalid_proxy_request" }, 400)
    const proxy = await service.update(
      authorization.principal.userId,
      authorization.groupId,
      proxyId.data,
      input,
    )
    return proxy === null ? context.json({ error: "not_found" }, 404) : context.json(proxy)
  })
  app.post("/api/groups/:groupId/operations/proxies/batch/delete", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "proxy.delete",
      Permission.OperationsWrite,
      PageKey.Proxies,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const denied = await rejectUnlessPageDelete(
      context,
      auditRepository,
      authorization.principal,
      "proxy.delete",
      `group:${authorization.groupId}`,
      PageKey.Proxies,
    )
    if (denied !== null) return denied
    const input = await parseJson(context.req.raw, BatchSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    try {
      return context.json({
        affected: await service.delete(
          authorization.principal.userId,
          authorization.groupId,
          input.ids,
        ),
      })
    } catch (error) {
      if (error instanceof OperationDeleteConflictError)
        return context.json({ error: "operation_entity_active" }, 409)
      throw error
    }
  })
}
