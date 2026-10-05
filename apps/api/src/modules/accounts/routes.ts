import type { Hono } from "hono"
import { z } from "zod"

import { Permission } from "../../lib/authorization"
import { OperationDeleteConflictError } from "../../lib/operation-claim-guard"
import { PageKey } from "../../lib/pages"
import { rejectUnlessPageDelete } from "../access/page-authorization"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import type { AuthService } from "../auth/service"
import {
  authorizeOperationRequest,
  hasOperationAuthorizationFailure,
} from "../resources/route-authorization"
import {
  AccountBindingError,
  OperationAccountAppSchema,
  OperationAccountBackupTypeSchema,
  OperationAccountIdSchema,
  OperationAccountStatusSchema,
} from "./repository"
import type { AccountService } from "./service"

const TagsSchema = z.array(z.string().trim().min(1).max(64)).max(20).default([])
const OptionalUuid = z.string().uuid().nullable().optional()
const BooleanQuery = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "true"))

const CreateSchema = z.object({
  app: OperationAccountAppSchema.nullable().optional(),
  backupType: OperationAccountBackupTypeSchema.nullable().optional(),
  deviceId: OptionalUuid,
  deviceInstanceId: OptionalUuid,
  identifier: z.string().trim().max(320).default(""),
  name: z.string().trim().max(160).optional(),
  avatar: z.string().max(2000).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
  favorite: z.number().int().nullable().optional(),
  follower: z.number().int().nullable().optional(),
  following: z.number().int().nullable().optional(),
  note: z.string().max(2000).default(""),
  platformUid: z.string().trim().max(64).optional(),
  proxyId: OptionalUuid,
  region: z.string().trim().max(64).default(""),
  secret: z.string().max(20_000).default(""),
  status: OperationAccountStatusSchema.default("ready"),
  tags: TagsSchema,
  totp: z.string().max(20_000).default(""),
})
const UpdateSchema = z.object({
  app: OperationAccountAppSchema.nullable().optional(),
  backupType: OperationAccountBackupTypeSchema.nullable().optional(),
  deviceId: OptionalUuid,
  deviceInstanceId: OptionalUuid,
  identifier: z.string().trim().max(320).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  avatar: z.string().max(2000).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
  favorite: z.number().int().nullable().optional(),
  follower: z.number().int().nullable().optional(),
  following: z.number().int().nullable().optional(),
  note: z.string().max(2000).optional(),
  platformUid: z.string().trim().max(64).optional(),
  proxyId: OptionalUuid,
  region: z.string().trim().max(64).optional(),
  resourceSecrets: z.record(z.string(), z.string().max(20_000)).optional(),
  secret: z.string().max(20_000).optional(),
  status: OperationAccountStatusSchema.optional(),
  tags: TagsSchema.optional(),
  totp: z.string().max(20_000).optional(),
})
const BatchSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) })
const TagBatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  mode: z.enum(["add", "replace", "clear"]),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
})
const ProxyBatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  proxyId: z.string().uuid().nullable(),
})
const ListSchema = z.object({
  app: OperationAccountAppSchema.optional(),
  backupType: OperationAccountBackupTypeSchema.optional(),
  deleted: BooleanQuery,
  deviceId: z.string().uuid().optional(),
  favorite: BooleanQuery,
  hasPassword: BooleanQuery,
  hasProxy: BooleanQuery,
  hasTotp: BooleanQuery,
  noUsername: BooleanQuery,
  online: BooleanQuery,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  query: z.string().trim().max(200).optional(),
  status: OperationAccountStatusSchema.optional(),
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

const displayName = (input: {
  readonly identifier: string
  readonly name?: string | undefined
}): string => {
  const name = input.name?.trim() ?? ""
  if (name.length > 0) return name
  if (input.identifier.length > 0) return input.identifier
  return "未命名账号"
}

export const registerAccountRoutes = (
  app: Hono,
  authService: AuthService,
  auditRepository: AuditRepository,
  service: AccountService,
): void => {
  app.get("/api/groups/:groupId/operations/accounts", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "account.list",
      Permission.OperationsRead,
      PageKey.Accounts,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const filter = ListSchema.safeParse(context.req.query())
    return !filter.success
      ? context.json({ error: "invalid_list_request" }, 400)
      : context.json(await service.list({ ...filter.data, groupId: authorization.groupId }))
  })
  app.get("/api/groups/:groupId/operations/accounts/export", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "account.export",
      Permission.OperationsRead,
      PageKey.Accounts,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const filter = ListSchema.safeParse(context.req.query())
    if (!filter.success) return context.json({ error: "invalid_list_request" }, 400)
    await writeAuditEvent(auditRepository, {
      action: "account.export",
      actorId: authorization.principal.userId,
      outcome: "allowed",
      target: `group:${authorization.groupId}`,
    })
    const { page: _page, pageSize: _pageSize, ...exportFilter } = filter.data
    const encoder = new TextEncoder()
    const csv = service.exportMasked({ ...exportFilter, groupId: authorization.groupId })
    const body = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        for await (const chunk of csv) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    })
    return context.body(body, 200, {
      "Content-Disposition": 'attachment; filename="operation-accounts.csv"',
      "Content-Type": "text/csv; charset=utf-8",
    })
  })
  app.post("/api/groups/:groupId/operations/accounts/credentials", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "account.reveal",
      Permission.OperationsRead,
      PageKey.Accounts,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const input = await parseJson(context.req.raw, BatchSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    return context.json(
      await service.reveal(authorization.principal.userId, authorization.groupId, input.ids),
    )
  })
  app.post("/api/groups/:groupId/operations/accounts", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "account.create",
      Permission.OperationsWrite,
      PageKey.Accounts,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const input = await parseJson(context.req.raw, CreateSchema)
    if (input === null) return context.json({ error: "invalid_account_request" }, 400)
    try {
      return context.json(
        await service.create(authorization.principal.userId, authorization.groupId, {
          ...input,
          name: displayName(input),
        }),
        201,
      )
    } catch (error) {
      if (error instanceof AccountBindingError)
        return context.json({ error: "invalid_account_binding" }, 400)
      throw error
    }
  })
  app.patch("/api/groups/:groupId/operations/accounts/:accountId", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "account.update",
      Permission.OperationsWrite,
      PageKey.Accounts,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const accountId = OperationAccountIdSchema.safeParse(context.req.param("accountId"))
    if (!accountId.success) return context.json({ error: "invalid_account_id" }, 400)
    const input = await parseJson(context.req.raw, UpdateSchema)
    if (input === null) return context.json({ error: "invalid_account_request" }, 400)
    try {
      const account = await service.update(
        authorization.principal.userId,
        authorization.groupId,
        accountId.data,
        input,
      )
      return account === null ? context.json({ error: "not_found" }, 404) : context.json(account)
    } catch (error) {
      if (error instanceof AccountBindingError)
        return context.json({ error: "invalid_account_binding" }, 400)
      throw error
    }
  })
  app.post("/api/groups/:groupId/operations/accounts/recycle", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "account.recycle",
      Permission.OperationsWrite,
      PageKey.Accounts,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const input = await parseJson(context.req.raw, BatchSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    try {
      return context.json({
        affected: await service.recycle(
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
  app.post("/api/groups/:groupId/operations/accounts/restore", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "account.restore",
      Permission.OperationsWrite,
      PageKey.Accounts,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const input = await parseJson(context.req.raw, BatchSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    return context.json({
      affected: await service.restore(
        authorization.principal.userId,
        authorization.groupId,
        input.ids,
      ),
    })
  })
  app.post("/api/groups/:groupId/operations/accounts/batch/tags", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "account.tags",
      Permission.OperationsWrite,
      PageKey.Accounts,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const input = await parseJson(context.req.raw, TagBatchSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    return context.json({
      affected: await service.updateTags(
        authorization.principal.userId,
        authorization.groupId,
        input.ids,
        input.mode,
        input.tags,
      ),
    })
  })
  app.post("/api/groups/:groupId/operations/accounts/batch/proxy", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "account.proxy",
      Permission.OperationsWrite,
      PageKey.Accounts,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const input = await parseJson(context.req.raw, ProxyBatchSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    try {
      return context.json({
        affected: await service.assignProxy(
          authorization.principal.userId,
          authorization.groupId,
          input.ids,
          input.proxyId,
        ),
      })
    } catch (error) {
      if (error instanceof AccountBindingError)
        return context.json({ error: "invalid_account_binding" }, 400)
      throw error
    }
  })
  app.post("/api/groups/:groupId/operations/accounts/batch/delete", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "account.delete",
      Permission.OperationsWrite,
      PageKey.Accounts,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const denied = await rejectUnlessPageDelete(
      context,
      auditRepository,
      authorization.principal,
      "account.delete",
      `group:${authorization.groupId}`,
      PageKey.Accounts,
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
