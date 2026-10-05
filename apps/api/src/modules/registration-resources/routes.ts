import type { Hono } from "hono"
import { z } from "zod"

import { Permission } from "../../lib/authorization"
import { PageKey } from "../../lib/pages"
import { rejectUnlessPageDelete } from "../access/page-authorization"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import type { AuthService } from "../auth/service"
import { RegistrationResourceStatusSchema } from "./repository"
import { authorizeResourceRequest, hasResourceAuthorizationFailure } from "./route-authorization"
import type { RegistrationResourceService } from "./service"

const ImportRequestSchema = z.object({
  content: z.string().min(1).max(1_000_000),
  note: z.string().max(2_000).default(""),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
})

const BatchRequestSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) })

const ListRequestSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  query: z.string().trim().max(200).optional(),
  status: RegistrationResourceStatusSchema.optional(),
  tag: z.string().trim().min(1).max(64).optional(),
})

const parseJson = async <T>(request: Request, schema: z.ZodType<T>): Promise<T | null> => {
  try {
    const parsed = schema.safeParse(await request.json())
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

export const registerRegistrationResourceRoutes = (
  app: Hono,
  authService: AuthService,
  auditRepository: AuditRepository,
  service: RegistrationResourceService,
): void => {
  app.post("/api/groups/:groupId/registration-resources/import/preview", async (context) => {
    const authorization = await authorizeResourceRequest(
      context,
      authService,
      auditRepository,
      "registration-resource.preview",
      Permission.ResourcesRead,
      PageKey.StudioRegistration,
    )
    if (hasResourceAuthorizationFailure(authorization)) {
      return authorization.response
    }
    const input = await parseJson(context.req.raw, ImportRequestSchema)
    if (input === null) {
      return context.json({ error: "invalid_import_request" }, 400)
    }
    return context.json(
      await service.preview({ content: input.content, groupId: authorization.groupId }),
    )
  })

  app.post("/api/groups/:groupId/registration-resources/imports", async (context) => {
    const authorization = await authorizeResourceRequest(
      context,
      authService,
      auditRepository,
      "registration-resource.import",
      Permission.ResourcesWrite,
      PageKey.StudioRegistration,
    )
    if (hasResourceAuthorizationFailure(authorization)) {
      return authorization.response
    }
    const input = await parseJson(context.req.raw, ImportRequestSchema)
    if (input === null) {
      return context.json({ error: "invalid_import_request" }, 400)
    }
    const result = await service.confirmImport({
      actorId: authorization.principal.userId,
      content: input.content,
      groupId: authorization.groupId,
      note: input.note,
      tags: input.tags,
    })
    return context.json(result, 201)
  })

  app.get("/api/groups/:groupId/registration-resources", async (context) => {
    const authorization = await authorizeResourceRequest(
      context,
      authService,
      auditRepository,
      "registration-resource.list",
      Permission.ResourcesRead,
      PageKey.StudioRegistration,
    )
    if (hasResourceAuthorizationFailure(authorization)) {
      return authorization.response
    }
    const query = ListRequestSchema.safeParse(context.req.query())
    if (!query.success) {
      return context.json({ error: "invalid_list_request" }, 400)
    }
    const filter = {
      groupId: authorization.groupId,
      page: query.data.page,
      pageSize: query.data.pageSize,
      ...(query.data.query === undefined ? {} : { query: query.data.query }),
      ...(query.data.status === undefined ? {} : { status: query.data.status }),
      ...(query.data.tag === undefined ? {} : { tag: query.data.tag }),
    }
    return context.json(await service.list(filter))
  })

  app.post("/api/groups/:groupId/registration-resources/batch/reset", async (context) => {
    const authorization = await authorizeResourceRequest(
      context,
      authService,
      auditRepository,
      "registration-resource.reset",
      Permission.ResourcesWrite,
      PageKey.StudioRegistration,
    )
    if (hasResourceAuthorizationFailure(authorization)) {
      return authorization.response
    }
    const input = await parseJson(context.req.raw, BatchRequestSchema)
    if (input === null) {
      return context.json({ error: "invalid_batch_request" }, 400)
    }
    return context.json(
      await service.reset({
        actorId: authorization.principal.userId,
        groupId: authorization.groupId,
        ids: input.ids,
      }),
    )
  })

  app.post("/api/groups/:groupId/registration-resources/batch/delete", async (context) => {
    const authorization = await authorizeResourceRequest(
      context,
      authService,
      auditRepository,
      "registration-resource.delete",
      Permission.ResourcesWrite,
      PageKey.StudioRegistration,
    )
    if (hasResourceAuthorizationFailure(authorization)) {
      return authorization.response
    }
    const denied = await rejectUnlessPageDelete(
      context,
      auditRepository,
      authorization.principal,
      "registration-resource.delete",
      `group:${authorization.groupId}`,
      PageKey.StudioRegistration,
    )
    if (denied !== null) return denied
    const input = await parseJson(context.req.raw, BatchRequestSchema)
    if (input === null) {
      return context.json({ error: "invalid_batch_request" }, 400)
    }
    return context.json(
      await service.delete({
        actorId: authorization.principal.userId,
        groupId: authorization.groupId,
        ids: input.ids,
      }),
    )
  })

  app.get("/api/groups/:groupId/registration-resources/export", async (context) => {
    const authorization = await authorizeResourceRequest(
      context,
      authService,
      auditRepository,
      "registration-resource.export",
      Permission.ResourcesRead,
      PageKey.StudioRegistration,
    )
    if (hasResourceAuthorizationFailure(authorization)) {
      return authorization.response
    }
    await writeAuditEvent(auditRepository, {
      action: "registration-resource.export",
      actorId: authorization.principal.userId,
      outcome: "allowed",
      target: `group:${authorization.groupId}`,
    })
    const encoder = new TextEncoder()
    const csv = service.exportMasked(authorization.groupId)
    const body = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        for await (const chunk of csv) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    })
    return context.body(body, 200, {
      "Content-Disposition": 'attachment; filename="registration-resources.csv"',
      "Content-Type": "text/csv; charset=utf-8",
    })
  })

  app.get("/api/groups/:groupId/registration-resources/statistics", async (context) => {
    const authorization = await authorizeResourceRequest(
      context,
      authService,
      auditRepository,
      "registration-resource.statistics",
      Permission.ResourcesRead,
      PageKey.StudioRegistration,
    )
    if (hasResourceAuthorizationFailure(authorization)) {
      return authorization.response
    }
    return context.json({ tags: await service.tagStatistics(authorization.groupId) })
  })
}
