import type { Context, Hono } from "hono"
import { z } from "zod"

import { Permission, type UserId } from "../../lib/authorization"
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
import { AccountDeskError } from "./desk"
import {
  AccountBindingError,
  OperationAccountAppSchema,
  OperationAccountBackupTypeSchema,
  OperationAccountIdSchema,
  OperationAccountStatusSchema,
} from "./repository"
import type { AccountService } from "./service"

const TagsSchema = z.array(z.string().trim().max(64)).max(20).default([])
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
  resourceSecrets: z.record(z.string(), z.string().max(20_000)).optional(),
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
  mode: z.enum(["add", "replace", "clear", "remove"]),
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
  ids: z.string().uuid().array().max(500).optional(),
  instanceIndex: z.coerce.number().int().min(1).max(20).optional(),
  minFollower: z.coerce.number().int().min(0).optional(),
  minFollowing: z.coerce.number().int().min(0).optional(),
  noUsername: BooleanQuery,
  note: z.string().trim().max(200).optional(),
  online: BooleanQuery,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  query: z.string().trim().max(200).optional(),
  region: z.string().trim().max(64).optional(),
  status: OperationAccountStatusSchema.optional(),
  tag: z.string().trim().min(1).max(64).optional(),
  tagMode: z.enum(["all", "any"]).optional(),
  tags: z.string().trim().min(1).max(64).array().max(20).optional(),
  transferKey: z.string().trim().max(64).optional(),
  uids: z.string().trim().min(1).max(64).array().max(200).optional(),
})
const ExportSchema = ListSchema.omit({ page: true, pageSize: true }).extend({
  ids: z.array(z.string().uuid()).max(5000).optional(),
})
const GroupBatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  tag: z.string().trim().max(64),
})
const NoteBatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  note: z.string().trim().max(200),
})
const RegionBatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  region: z
    .string()
    .trim()
    .regex(/^[A-Z]{2,3}$/),
})
const FavoriteBatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  starred: z.boolean(),
})
const MoveTagSchema = z.object({
  newTag: z.string().trim().min(1).max(64),
  oldTags: z.array(z.string().trim().max(64)).min(1).max(50),
})
const StatisticsTagSchema = z.object({
  bannedOnly: z.boolean().default(false),
  confirm: z.string().max(32).optional(),
  tag: z.string().trim().max(64),
})
const TransferCreateSchema = z.object({
  code: z.string().trim().max(64).optional(),
  ids: z.array(z.string().uuid()).min(1).max(500),
})
const TransferCodeSchema = z.object({ code: z.string().trim().min(1).max(64) })
const TransferMergeSchema = z.object({
  code: z.string().trim().max(64).optional(),
  codes: z.array(z.string().trim().min(1).max(64)).min(2).max(50),
})
const TransferSplitSchema = z.object({
  code: z.string().trim().min(1).max(64),
  size: z.number().int().positive(),
})
const StartSchema = z.object({
  deviceId: z.string().uuid(),
  deviceInstanceId: z.string().uuid(),
  proxyId: z.string().uuid().nullable(),
})
const BackupSchema = CreateSchema.extend({
  deviceId: z.string().uuid(),
  deviceInstanceId: z.string().uuid(),
})

const deskError = (
  error: unknown,
):
  | "confirm_required"
  | "invalid_account_binding"
  | "invalid_transfer"
  | "transfer_conflict"
  | null => {
  if (error instanceof AccountBindingError) return "invalid_account_binding"
  if (!(error instanceof AccountDeskError)) return null
  if (error.reason === "invalid_binding") return "invalid_account_binding"
  if (error.reason === "confirm_required") return "confirm_required"
  if (error.reason === "transfer_conflict") return "transfer_conflict"
  return "invalid_transfer"
}

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
  const writeDesk = async (
    context: Context,
    action: string,
    permission: typeof Permission.OperationsRead | typeof Permission.OperationsWrite,
    run: (authorization: {
      readonly groupId: string
      readonly principal: { readonly userId: UserId }
    }) => Promise<unknown>,
  ) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      action,
      permission,
      PageKey.Accounts,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    try {
      return context.json(
        await run({
          groupId: authorization.groupId,
          principal: authorization.principal,
        }),
      )
    } catch (error) {
      if (error instanceof OperationDeleteConflictError)
        return context.json({ error: "operation_entity_active" }, 409)
      if (error instanceof AccountDeskError && error.reason === "not_found")
        return context.json({ error: "not_found" }, 404)
      const reason = deskError(error)
      if (reason === "transfer_conflict") return context.json({ error: reason }, 409)
      if (reason !== null) return context.json({ error: reason }, 400)
      throw error
    }
  }
  app.get("/api/groups/:groupId/operations/accounts/facets", (context) =>
    writeDesk(context, "account.facets", Permission.OperationsRead, async (authorization) =>
      service.facets(authorization.groupId),
    ),
  )
  app.get("/api/groups/:groupId/operations/accounts/statistics", (context) =>
    writeDesk(context, "account.statistics", Permission.OperationsRead, async (authorization) =>
      service.statistics(authorization.groupId),
    ),
  )
  app.get("/api/groups/:groupId/operations/accounts/transfers", (context) =>
    writeDesk(context, "account.transfer.list", Permission.OperationsRead, async (authorization) =>
      service.listTransfers(authorization.groupId),
    ),
  )
  app.post("/api/groups/:groupId/operations/accounts/export", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "account.export",
      Permission.OperationsRead,
      PageKey.Accounts,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const input = await parseJson(context.req.raw, ExportSchema)
    if (input === null) return context.json({ error: "invalid_list_request" }, 400)
    const encoder = new TextEncoder()
    const csv = service.exportMasked({ ...input, groupId: authorization.groupId })
    const body = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        for await (const chunk of csv) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    })
    return context.body(body, 200, {
      "Content-Disposition": 'attachment; filename="operation-accounts.csv"',
      "Content-Type": "text/csv; charset=utf-8",
    })
  })
  app.post("/api/groups/:groupId/operations/accounts/statistics/delete", async (context) => {
    const input = await parseJson(context.req.raw, StatisticsTagSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    return writeDesk(
      context,
      "account.statistics.delete",
      Permission.OperationsWrite,
      (authorization) =>
        service
          .deleteByTag(
            authorization.principal.userId,
            authorization.groupId,
            input.tag,
            input.bannedOnly,
            input.confirm,
          )
          .then((affected) => ({ affected })),
    )
  })
  app.post("/api/groups/:groupId/operations/accounts/statistics/reset-banned", async (context) => {
    const input = await parseJson(context.req.raw, StatisticsTagSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    return writeDesk(
      context,
      "account.statistics.reset",
      Permission.OperationsWrite,
      (authorization) =>
        service
          .resetBanned(authorization.principal.userId, authorization.groupId, input.tag)
          .then((affected) => ({ affected })),
    )
  })
  app.post("/api/groups/:groupId/operations/accounts/batch/group", async (context) => {
    const input = await parseJson(context.req.raw, GroupBatchSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    return writeDesk(context, "account.group", Permission.OperationsWrite, (authorization) =>
      service
        .setGroup(authorization.principal.userId, authorization.groupId, input.ids, input.tag)
        .then((affected) => ({ affected })),
    )
  })
  app.post("/api/groups/:groupId/operations/accounts/batch/note", async (context) => {
    const input = await parseJson(context.req.raw, NoteBatchSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    return writeDesk(context, "account.note", Permission.OperationsWrite, (authorization) =>
      service
        .setNote(authorization.principal.userId, authorization.groupId, input.ids, input.note)
        .then((affected) => ({ affected })),
    )
  })
  app.post("/api/groups/:groupId/operations/accounts/batch/region", async (context) => {
    const input = await parseJson(context.req.raw, RegionBatchSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    return writeDesk(context, "account.region", Permission.OperationsWrite, (authorization) =>
      service
        .setRegion(authorization.principal.userId, authorization.groupId, input.ids, input.region)
        .then((affected) => ({ affected })),
    )
  })
  app.post("/api/groups/:groupId/operations/accounts/batch/favorite", async (context) => {
    const input = await parseJson(context.req.raw, FavoriteBatchSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    return writeDesk(context, "account.favorite", Permission.OperationsWrite, (authorization) =>
      service
        .setFavorite(
          authorization.principal.userId,
          authorization.groupId,
          input.ids,
          input.starred,
        )
        .then((affected) => ({ affected })),
    )
  })
  app.post("/api/groups/:groupId/operations/accounts/batch/tags/move", async (context) => {
    const input = await parseJson(context.req.raw, MoveTagSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    return writeDesk(context, "account.group.move", Permission.OperationsWrite, (authorization) =>
      service
        .moveGroupTags(
          authorization.principal.userId,
          authorization.groupId,
          input.oldTags,
          input.newTag,
        )
        .then((affected) => ({ affected })),
    )
  })
  app.post("/api/groups/:groupId/operations/accounts/transfers", async (context) => {
    const input = await parseJson(context.req.raw, TransferCreateSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    return writeDesk(
      context,
      "account.transfer.create",
      Permission.OperationsWrite,
      (authorization) =>
        service.createTransfer(
          authorization.principal.userId,
          authorization.groupId,
          input.ids,
          input.code,
        ),
    )
  })
  app.post("/api/groups/:groupId/operations/accounts/transfers/revoke", async (context) => {
    const input = await parseJson(context.req.raw, TransferCodeSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    return writeDesk(
      context,
      "account.transfer.revoke",
      Permission.OperationsWrite,
      (authorization) =>
        service
          .revokeTransfer(authorization.principal.userId, authorization.groupId, input.code)
          .then((affected) => ({ affected })),
    )
  })
  app.post("/api/groups/:groupId/operations/accounts/transfers/split", async (context) => {
    const input = await parseJson(context.req.raw, TransferSplitSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    return writeDesk(
      context,
      "account.transfer.split",
      Permission.OperationsWrite,
      (authorization) =>
        service.splitTransfer(
          authorization.principal.userId,
          authorization.groupId,
          input.code,
          input.size,
        ),
    )
  })
  app.post("/api/groups/:groupId/operations/accounts/transfers/merge", async (context) => {
    const input = await parseJson(context.req.raw, TransferMergeSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    return writeDesk(
      context,
      "account.transfer.merge",
      Permission.OperationsWrite,
      (authorization) =>
        service.mergeTransfers(
          authorization.principal.userId,
          authorization.groupId,
          input.codes,
          input.code,
        ),
    )
  })
  app.post("/api/groups/:groupId/operations/accounts/transfers/redeem", async (context) => {
    const input = await parseJson(context.req.raw, TransferCodeSchema)
    if (input === null) return context.json({ error: "invalid_batch_request" }, 400)
    return writeDesk(
      context,
      "account.transfer.redeem",
      Permission.OperationsWrite,
      (authorization) =>
        service
          .redeemTransfer(authorization.principal.userId, authorization.groupId, input.code)
          .then((affected) => ({ affected })),
    )
  })
  app.post("/api/groups/:groupId/operations/accounts/backups", async (context) => {
    const input = await parseJson(context.req.raw, BackupSchema)
    if (input === null) return context.json({ error: "invalid_account_request" }, 400)
    return writeDesk(
      context,
      "account.backup",
      Permission.OperationsWrite,
      async (authorization) => {
        const account = await service.create(
          authorization.principal.userId,
          authorization.groupId,
          {
            ...input,
            name: displayName(input),
          },
        )
        return account
      },
    )
  })
  app.post("/api/groups/:groupId/operations/accounts/:accountId/start", async (context) => {
    const accountId = OperationAccountIdSchema.safeParse(context.req.param("accountId"))
    if (!accountId.success) return context.json({ error: "invalid_account_id" }, 400)
    const input = await parseJson(context.req.raw, StartSchema)
    if (input === null) return context.json({ error: "invalid_account_binding" }, 400)
    return writeDesk(
      context,
      "account.start",
      Permission.OperationsWrite,
      async (authorization) => {
        const updated = await service.start(
          authorization.principal.userId,
          authorization.groupId,
          accountId.data,
          input.deviceId,
          input.deviceInstanceId,
          input.proxyId,
        )
        if (!updated) throw new AccountDeskError("not_found")
        return { updated: true }
      },
    )
  })
}
