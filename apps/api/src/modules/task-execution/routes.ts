import { ForbiddenInputTextError, TaskIdempotencyConflictError } from "@tk-mg/task-execution"
import type { Context, Hono } from "hono"
import { z } from "zod"
import { GroupIdSchema, Permission, Role } from "../../lib/authorization"
import { PageKey } from "../../lib/pages"
import { requireGroupAccess, requirePageView, requirePermission } from "../access/service"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import type { AuthService, SessionPrincipal } from "../auth/service"
import {
  InvalidTaskRequestError,
  ReconcileTaskSchema,
  SubmitTaskSchema,
  type TaskExecutionService,
} from "./service"

type Authorized = { readonly groupId: string; readonly principal: SessionPrincipal }
type Failure = { readonly response: Response }

const page = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const tokenFrom = (request: Request): string | null => {
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .find((part) => part.trim().startsWith("tk_mg_session="))
  const token = value?.trim().slice("tk_mg_session=".length)
  return token === undefined || token.length === 0 ? null : token
}

const authorize = async (
  context: Context,
  auth: AuthService,
  audit: AuditRepository,
  action: string,
  write = false,
): Promise<Authorized | Failure> => {
  const token = tokenFrom(context.req.raw)
  const principal = token === null ? null : await auth.session(token)
  if (principal === null)
    return { response: context.json({ error: "authentication_required" }, 401) }
  const rawGroupId = context.req.param("groupId")
  const groupId = GroupIdSchema.safeParse(rawGroupId)
  const permission = write ? Permission.OperationsWrite : Permission.OperationsRead
  if (requirePermission(principal.scope, permission).kind === "denied") {
    await writeAuditEvent(audit, {
      action,
      actorId: principal.userId,
      outcome: "denied",
      target: `group:${rawGroupId}`,
    })
    return { response: context.json({ error: "permission_denied" }, 403) }
  }
  if (!groupId.success || requireGroupAccess(principal.scope, groupId.data).kind === "hidden") {
    await writeAuditEvent(audit, {
      action,
      actorId: principal.userId,
      outcome: "denied",
      target: `group:${rawGroupId}`,
    })
    return { response: context.json({ error: "not_found" }, 404) }
  }
  if (requirePageView(principal.scope, PageKey.Tasks).kind === "denied") {
    await writeAuditEvent(audit, {
      action,
      actorId: principal.userId,
      outcome: "denied",
      target: `group:${rawGroupId}`,
    })
    return { response: context.json({ error: "permission_denied" }, 403) }
  }
  return { groupId: groupId.data, principal }
}

const failure = (value: Authorized | Failure): value is Failure => "response" in value

export const registerTaskExecutionRoutes = (
  app: Hono,
  auth: AuthService,
  audit: AuditRepository,
  service: TaskExecutionService,
): void => {
  app.post("/api/groups/:groupId/tasks/:taskId/reconcile", async (context) => {
    const action = "execution.task.reconcile"
    const access = await authorize(context, auth, audit, action, true)
    if (failure(access)) return access.response
    const deny = async (status: 400 | 403 | 404) => {
      await writeAuditEvent(audit, {
        action,
        actorId: access.principal.userId,
        outcome: "denied",
        target: `group:${access.groupId}`,
      })
      return context.json(
        {
          error:
            status === 400
              ? "invalid_reconciliation"
              : status === 404
                ? "not_found"
                : "permission_denied",
        },
        status,
      )
    }
    const scope = access.principal.scope
    if (
      scope.role !== Role.Administrator ||
      !scope.permissions.includes(Permission.OperationsWrite) ||
      !scope.pages.some((item) => item.key === PageKey.Tasks && item.canView)
    )
      return deny(403)
    if (!scope.groupIds.some((groupId) => groupId === access.groupId)) return deny(404)
    let raw: unknown
    try {
      raw = await context.req.json()
    } catch (error) {
      if (error instanceof SyntaxError) return deny(400)
      throw error
    }
    const parsed = ReconcileTaskSchema.safeParse(raw)
    if (!parsed.success) return deny(400)
    const taskId = context.req.param("taskId")
    const result = await service.reconcile(
      {
        actorId: access.principal.userId,
        groupId: access.groupId,
        requestId: context.req.header("X-Request-Id") ?? crypto.randomUUID(),
      },
      taskId,
      parsed.data,
    )
    switch (result) {
      case "resolved":
      case "duplicate":
        return context.json({ taskId, state: parsed.data.resolution })
      case "conflict":
        return context.json({ error: "reconciliation_conflict" }, 409)
      case "not_found":
        return deny(404)
      default: {
        const exhaustive: never = result
        return exhaustive
      }
    }
  })
  app.post("/api/groups/:groupId/tasks", async (context) => {
    const access = await authorize(context, auth, audit, "execution.task.submit", true)
    if (failure(access)) return access.response
    const key = context.req.header("Idempotency-Key")
    if (key === undefined || key.length === 0)
      return context.json({ error: "idempotency_key_required" }, 400)
    let raw: unknown
    try {
      raw = await context.req.json()
    } catch (error) {
      if (error instanceof SyntaxError) return context.json({ error: "invalid_task_request" }, 400)
      throw error
    }
    const parsed = SubmitTaskSchema.safeParse(raw)
    if (!parsed.success) return context.json({ error: "invalid_task_request" }, 400)
    try {
      const result = await service.submit(
        {
          actorId: access.principal.userId,
          groupId: access.groupId,
          requestId: context.req.header("X-Request-Id") ?? crypto.randomUUID(),
          idempotencyKey: key,
        },
        parsed.data,
      )
      if (result === null) return context.json({ error: "not_found" }, 404)
      return context.json(result.task, result.created ? 202 : 200)
    } catch (error) {
      if (error instanceof TaskIdempotencyConflictError)
        return context.json({ error: error.code }, 409)
      if (error instanceof ForbiddenInputTextError)
        return context.json({ error: "invalid_task_request" }, 400)
      if (error instanceof InvalidTaskRequestError)
        return context.json({ error: "invalid_task_request" }, 400)
      if (error instanceof SyntaxError || error instanceof z.ZodError)
        return context.json({ error: "invalid_task_request" }, 400)
      throw error
    }
  })
  app.get("/api/groups/:groupId/tasks", async (context) => {
    const access = await authorize(context, auth, audit, "execution.task.list")
    if (failure(access)) return access.response
    const parsed = page.safeParse(context.req.query())
    if (!parsed.success) return context.json({ error: "invalid_page" }, 400)
    return context.json(await service.list(access.groupId, parsed.data.page, parsed.data.pageSize))
  })
  app.get("/api/groups/:groupId/tasks/:taskId", async (context) => {
    const access = await authorize(context, auth, audit, "execution.task.detail")
    if (failure(access)) return access.response
    const task = await service.get(access.groupId, context.req.param("taskId"))
    return task === null ? context.json({ error: "not_found" }, 404) : context.json(task)
  })
  app.post("/api/groups/:groupId/tasks/:taskId/cancel", async (context) => {
    const access = await authorize(context, auth, audit, "execution.task.cancel", true)
    if (failure(access)) return access.response
    const task = await service.cancel(
      {
        actorId: access.principal.userId,
        groupId: access.groupId,
        requestId: context.req.header("X-Request-Id") ?? crypto.randomUUID(),
      },
      context.req.param("taskId"),
    )
    return task === null ? context.json({ error: "not_found" }, 404) : context.json(task)
  })
}
