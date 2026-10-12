import type { Hono } from "hono"
import type { Sql } from "postgres"
import { z } from "zod"

import type { SecretCipher } from "../../lib/crypto"
import { Permission } from "../../lib/authorization"
import { PageKey } from "../../lib/pages"
import { writeAuditEvent, type AuditRepository } from "../audit/service"
import type { AuthService } from "../auth/service"
import { administratorFor } from "../business-labels"
import {
  authorizeOperationRequest,
  hasOperationAuthorizationFailure,
} from "../resources/route-authorization"
import { createDispatchRepository, type DispatchSelection } from "./repository"

const TextSchema = z.object({
  mode: z.enum(["random", "sequence", "tag"]),
  sequence: z.number().int().min(0).max(99),
  tag: z.string().trim().min(1).max(80).optional(),
})

const CreateSchema = z
  .object({
    accountIds: z.array(z.string().uuid()).max(500).optional(),
    accountNote: z.string().trim().max(200).optional(),
    boxIds: z.array(z.string().uuid()).max(100).optional(),
    chainId: z.string().uuid(),
    pitIndexes: z.array(z.number().int().min(1).max(5)).max(5).optional(),
    proxyTag: z.string().trim().min(1).max(80).nullable().optional(),
    texts: z.array(TextSchema).max(100).optional(),
  })
  .refine(
    (value) =>
      (value.accountIds?.length ?? 0) > 0 || (value.accountNote?.trim().length ?? 0) > 0,
  )

const StartSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
})

const ClearSchema = z
  .object({
    deviceIds: z.array(z.string().uuid()).max(100),
    unassigned: z.boolean().optional(),
  })
  .refine((value) => value.deviceIds.length > 0 || value.unassigned === true)

const selectionFrom = (input: z.infer<typeof CreateSchema>): DispatchSelection => ({
  accountIds: input.accountIds ?? [],
  accountNote: input.accountNote?.trim() ?? "",
  boxIds: input.boxIds ?? [],
  pitIndexes: input.pitIndexes ?? [],
  proxyTag: input.proxyTag ?? null,
  texts: input.texts ?? [],
})

const readJson = async <T>(request: Request, schema: z.ZodType<T>): Promise<T | null> => {
  try {
    const parsed = schema.safeParse(await request.json())
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

const groupRecords = (
  dispatchRows: readonly {
    readonly account: string
    readonly deviceHost: string
    readonly deviceId: string | null
    readonly deviceName: string
    readonly itemId: string
    readonly itemStatus: string
    readonly name: string
    readonly parameters: Record<string, string>
    readonly sequence: number
    readonly skill: string
    readonly stepStatus: string
  }[],
  legacy: readonly {
    readonly account: string
    readonly deviceHost: string
    readonly deviceId: string
    readonly deviceName: string
    readonly name: string
    readonly parameters: Record<string, string>
    readonly sequence: number
    readonly skill: string
    readonly status: string
    readonly stepStatus: string
    readonly taskId: string
  }[],
) => {
  type Step = { parameters: Record<string, string>; sequence: number; skill: string; status: string }
  type Task = { account: string; id: string; name: string; started: boolean; status: string; steps: Step[] }
  const boxes = new Map<string, { id: string; name: string; tasks: Map<string, Task> }>()
  const boxFor = (id: string | null, name: string, host: string) => {
    const key = id ?? ""
    const current = boxes.get(key)
    if (current !== undefined) return current
    const created = {
      id: key,
      name: key.length === 0 ? "未分配盒子" : name.length > 0 && name !== host ? `${name} ${host}` : host,
      tasks: new Map<string, Task>(),
    }
    boxes.set(key, created)
    return created
  }
  for (const row of dispatchRows) {
    const box = boxFor(row.deviceId, row.deviceName, row.deviceHost)
    const task = box.tasks.get(row.itemId) ?? {
      account: row.account,
      id: row.itemId,
      name: row.name,
      started: row.itemStatus === "started",
      status: row.itemStatus,
      steps: [],
    }
    task.steps.push({
      parameters: row.parameters,
      sequence: row.sequence,
      skill: row.skill,
      status: row.stepStatus,
    })
    box.tasks.set(row.itemId, task)
  }
  for (const row of legacy) {
    const box = boxFor(row.deviceId, row.deviceName, row.deviceHost)
    const task = box.tasks.get(row.taskId) ?? {
      account: row.account,
      id: row.taskId,
      name: row.name,
      started: true,
      status: row.status,
      steps: [],
    }
    task.steps.push({
      parameters: row.parameters,
      sequence: row.sequence,
      skill: row.skill,
      status: row.stepStatus,
    })
    box.tasks.set(row.taskId, task)
  }
  return {
    boxes: [...boxes.values()].map((box) => ({
      id: box.id,
      name: box.name,
      tasks: [...box.tasks.values()],
    })),
  }
}

export const registerDispatchRoutes = (
  app: Hono,
  sql: Sql,
  cipher: SecretCipher,
  authService: AuthService,
  auditRepository: AuditRepository,
): void => {
  const repository = createDispatchRepository(sql, cipher)
  app.get("/api/groups/:groupId/dispatches/options", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "dispatch.options",
      Permission.OperationsRead,
      PageKey.Tasks,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const administratorId = await administratorFor(sql, authorization.principal.userId)
    return context.json(await repository.options(authorization.groupId, administratorId))
  })
  app.get("/api/groups/:groupId/dispatches", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "dispatch.list",
      Permission.OperationsRead,
      PageKey.Tasks,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    return context.json({ items: await repository.list(authorization.groupId) })
  })
  app.post("/api/groups/:groupId/dispatches", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "dispatch.create",
      Permission.OperationsWrite,
      PageKey.Tasks,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const input = await readJson(context.req.raw, CreateSchema)
    if (input === null) return context.json({ error: "invalid_dispatch_request" }, 400)
    const administratorId = await administratorFor(sql, authorization.principal.userId)
    if (administratorId === null) return context.json({ error: "not_found" }, 404)
    const created = await repository.create(
      authorization.groupId,
      authorization.principal.userId,
      administratorId,
      input.chainId,
      selectionFrom(input),
    )
    if (created.kind === "missing_chain") return context.json({ error: "not_found" }, 404)
    if (created.kind === "no_accounts") return context.json({ error: "no_accounts" }, 400)
    await writeAuditEvent(auditRepository, {
      action: "dispatch.create",
      actorId: authorization.principal.userId,
      outcome: "allowed",
      target: `dispatch:${created.id}`,
    })
    return context.json(
      {
        id: created.id,
        items: created.items.map((item) => ({
          identifier: item.identifier,
          instanceIndex: item.instanceIndex,
          missing: item.missing,
          proxyName: item.proxyName,
          status: item.status,
        })),
        name: created.name,
        status: created.status,
      },
      201,
    )
  })
  app.post("/api/groups/:groupId/dispatches/start", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "dispatch.start",
      Permission.OperationsWrite,
      PageKey.Tasks,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const input = await readJson(context.req.raw, StartSchema)
    if (input === null) return context.json({ error: "invalid_dispatch_request" }, 400)
    const started = await repository.start(
      authorization.groupId,
      authorization.principal.userId,
      input.ids,
    )
    if (started.kind === "missing") return context.json({ error: "not_found" }, 404)
    if (started.kind === "incomplete") {
      return context.json({ error: "dispatch_incomplete", items: started.gaps }, 409)
    }
    await repository.notify(started.devices)
    await writeAuditEvent(auditRepository, {
      action: "dispatch.start",
      actorId: authorization.principal.userId,
      outcome: "allowed",
      target: `group:${authorization.groupId}`,
    })
    return context.json({ started: input.ids.length })
  })
  app.get("/api/groups/:groupId/dispatch-records", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "dispatch.records",
      Permission.OperationsRead,
      PageKey.TaskRecords,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const rows = await repository.records(authorization.groupId)
    return context.json(groupRecords(rows.dispatchRows, rows.legacy))
  })
  app.post("/api/groups/:groupId/dispatch-records/clear", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "dispatch.records.clear",
      Permission.OperationsWrite,
      PageKey.TaskRecords,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const input = await readJson(context.req.raw, ClearSchema)
    if (input === null) return context.json({ error: "invalid_dispatch_request" }, 400)
    const removed = await repository.clearRecords(
      authorization.groupId,
      input.deviceIds,
      input.unassigned === true,
    )
    await writeAuditEvent(auditRepository, {
      action: "dispatch.records.clear",
      actorId: authorization.principal.userId,
      outcome: "allowed",
      target: `group:${authorization.groupId}`,
    })
    return context.json({ removed })
  })
}
