import type { Hono } from "hono"
import { z } from "zod"

import { Permission } from "../../lib/authorization"
import { OperationDeleteConflictError } from "../../lib/operation-claim-guard"
import { PageKey } from "../../lib/pages"
import { rejectUnlessPageDelete } from "../access/page-authorization"
import type { AuditRepository } from "../audit/service"
import type { AuthService } from "../auth/service"
import {
  OperationResourceIdSchema,
  OperationResourceStatus,
  OperationResourceStatusSchema,
  ResourceStatusConflictError,
  ResourceTagLimitError,
} from "./repository"
import { authorizeOperationRequest, hasOperationAuthorizationFailure } from "./route-authorization"
import type { ResourceService } from "./service"

const TagsSchema = z.array(z.string().trim().min(1).max(80)).max(20).default([])
const CreateSchema = z.object({
  category: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(4000),
  note: z.string().max(2000).default(""),
  status: z
    .enum([OperationResourceStatus.Available, OperationResourceStatus.Inactive])
    .default(OperationResourceStatus.Available),
  tags: TagsSchema,
})
const UpdateSchema = z.object({
  category: z.string().trim().max(80).optional(),
  name: z.string().trim().min(1).max(4000).optional(),
  note: z.string().max(2000).optional(),
  status: z
    .enum([OperationResourceStatus.Available, OperationResourceStatus.Inactive])
    .optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
})
const BatchSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) })
const AssignSchema = BatchSchema.extend({
  tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
})
const ImportSchema = z.object({
  contents: z.array(z.string().trim().min(1).max(4000)).min(1).max(1000),
  tag: z.string().trim().min(1).max(80),
})
const DeleteScopeSchema = z.object({
  tag: z.string().trim().min(1).max(80).optional(),
})
const AllocationSchema = z.object({ accountId: z.string().uuid() })
const ListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  query: z.string().trim().max(200).optional(),
  status: OperationResourceStatusSchema.optional(),
  tag: z.string().trim().min(1).max(64).optional(),
})

const parseJson = async <T>(request: Request, schema: z.ZodType<T>): Promise<T | null> => {
  try {
    const parsed = schema.safeParse(await request.json())
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

export const registerResourceRoutes = (
  app: Hono,
  authService: AuthService,
  auditRepository: AuditRepository,
  service: ResourceService,
): void => {
  app.get("/api/groups/:groupId/operations/resources", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "resource.list",
      Permission.OperationsRead,
      PageKey.StudioTextPool,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const parsed = ListSchema.safeParse(context.req.query())
    if (!parsed.success) return context.json({ error: "invalid_list_request" }, 400)
    return context.json(await service.list({ ...parsed.data, groupId: authorization.groupId }))
  })
  app.post("/api/groups/:groupId/operations/resources", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "resource.create",
      Permission.OperationsWrite,
      PageKey.StudioTextPool,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const input = await parseJson(context.req.raw, CreateSchema)
    return input === null
      ? context.json({ error: "invalid_resource_request" }, 400)
      : context.json(
          await service.create(authorization.principal.userId, authorization.groupId, input),
          201,
        )
  })
  app.patch("/api/groups/:groupId/operations/resources/:resourceId", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "resource.update",
      Permission.OperationsWrite,
      PageKey.StudioTextPool,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const resourceId = OperationResourceIdSchema.safeParse(context.req.param("resourceId"))
    if (!resourceId.success) return context.json({ error: "invalid_resource_id" }, 400)
    const input = await parseJson(context.req.raw, UpdateSchema)
    if (input === null) return context.json({ error: "invalid_resource_request" }, 400)
    try {
      const resource = await service.update(
        authorization.principal.userId,
        authorization.groupId,
        resourceId.data,
        input,
      )
      return resource === null ? context.json({ error: "not_found" }, 404) : context.json(resource)
    } catch (error) {
      if (error instanceof ResourceStatusConflictError)
        return context.json({ error: "resource_allocation_active" }, 409)
      throw error
    }
  })
  app.post("/api/groups/:groupId/operations/resources/batch/delete", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "resource.delete",
      Permission.OperationsWrite,
      PageKey.StudioTextPool,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const denied = await rejectUnlessPageDelete(
      context,
      auditRepository,
      authorization.principal,
      "resource.delete",
      `group:${authorization.groupId}`,
      PageKey.StudioTextPool,
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
  app.post("/api/groups/:groupId/operations/resources/batch/assign", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "resource.assign",
      Permission.OperationsWrite,
      PageKey.StudioTextPool,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const input = await parseJson(context.req.raw, AssignSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    if (input.tags === undefined) return context.json({ affected: 0 })
    try {
      const affected = await service.assignTags(
        authorization.principal.userId,
        authorization.groupId,
        input.ids,
        input.tags,
      )
      return affected === 0
        ? context.json({ error: "not_found" }, 404)
        : context.json({ affected })
    } catch (error) {
      if (error instanceof ResourceTagLimitError)
        return context.json({ error: "invalid_batch_request" }, 400)
      throw error
    }
  })
  app.post("/api/groups/:groupId/operations/resources/import", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "resource.import",
      Permission.OperationsWrite,
      PageKey.StudioTextPool,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const input = await parseJson(context.req.raw, ImportSchema)
    if (input === null) return context.json({ error: "invalid_resource_request" }, 400)
    const items = await service.importTexts(authorization.principal.userId, authorization.groupId, input)
    return context.json({ imported: items.length, items }, 201)
  })
  app.post("/api/groups/:groupId/operations/resources/batch/delete-scope", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "resource.delete",
      Permission.OperationsWrite,
      PageKey.StudioTextPool,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const denied = await rejectUnlessPageDelete(
      context,
      auditRepository,
      authorization.principal,
      "resource.delete",
      `group:${authorization.groupId}`,
      PageKey.StudioTextPool,
    )
    if (denied !== null) return denied
    const input = await parseJson(context.req.raw, DeleteScopeSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    try {
      return context.json({
        affected: await service.deleteScope(
          authorization.principal.userId,
          authorization.groupId,
          input.tag,
        ),
      })
    } catch (error) {
      if (error instanceof OperationDeleteConflictError)
        return context.json({ error: "operation_entity_active" }, 409)
      throw error
    }
  })
  app.get("/api/groups/:groupId/operations/resources/:resourceId/allocations", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "resource.history",
      Permission.OperationsRead,
      PageKey.StudioTextPool,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const resourceId = OperationResourceIdSchema.safeParse(context.req.param("resourceId"))
    if (!resourceId.success) return context.json({ error: "invalid_resource_id" }, 400)
    return context.json({
      items: await service.history(authorization.groupId, resourceId.data),
    })
  })
  app.post("/api/groups/:groupId/operations/resources/:resourceId/allocations", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "resource.allocate",
      Permission.OperationsWrite,
      PageKey.StudioTextPool,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const resourceId = OperationResourceIdSchema.safeParse(context.req.param("resourceId"))
    if (!resourceId.success) return context.json({ error: "invalid_resource_id" }, 400)
    const input = await parseJson(context.req.raw, AllocationSchema)
    if (input === null) return context.json({ error: "invalid_allocation_request" }, 400)
    const allocation = await service.allocate(
      authorization.principal.userId,
      authorization.groupId,
      resourceId.data,
      input.accountId,
    )
    return allocation === null
      ? context.json({ error: "allocation_conflict" }, 409)
      : context.json(allocation, 201)
  })
  app.delete(
    "/api/groups/:groupId/operations/resources/:resourceId/allocations",
    async (context) => {
      const authorization = await authorizeOperationRequest(
        context,
        authService,
        auditRepository,
        "resource.release",
        Permission.OperationsWrite,
        PageKey.StudioTextPool,
      )
      if (hasOperationAuthorizationFailure(authorization)) return authorization.response
      const resourceId = OperationResourceIdSchema.safeParse(context.req.param("resourceId"))
      if (!resourceId.success) return context.json({ error: "invalid_resource_id" }, 400)
      return (await service.release(
        authorization.principal.userId,
        authorization.groupId,
        resourceId.data,
      ))
        ? context.body(null, 204)
        : context.json({ error: "not_found" }, 404)
    },
  )
}
