import type { Hono } from "hono"
import type { Sql } from "postgres"
import { z } from "zod"
import { Permission } from "../../lib/authorization"
import type { SecretCipher } from "../../lib/crypto"
import { PageKey } from "../../lib/pages"
import { type AuditRepository, writeAuditEvent } from "../audit/service"
import type { AuthService } from "../auth/service"
import { administratorFor } from "../business-labels"
import {
  authorizeOperationRequest,
  hasOperationAuthorizationFailure,
} from "../resources/route-authorization"
import { createDispatchRepository, type DispatchSelection } from "./repository"
import { accountRunStatus } from "./run-status"

const FilterModeSchema = z.enum(["and", "or", "nand"])

const AccountFilterSchema = z.object({
  groups: z.array(z.string().trim().min(1).max(80)).max(40),
  ids: z.array(z.string().uuid()).min(1).max(500),
  keyword: z.string().max(80).default(""),
  mode: FilterModeSchema,
  tags: z.array(z.string().trim().min(1).max(80)).max(40),
  ungrouped: z.boolean(),
})

const ProxyFilterSchema = z.object({
  groups: z.array(z.string().trim().min(1).max(80)).max(40),
  ids: z.array(z.string().uuid()).min(1).max(500),
  keyword: z.string().max(80).default(""),
  mode: FilterModeSchema,
  remarks: z.array(z.string().trim().min(1).max(80)).max(40),
})

const TextSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  keyword: z.string().max(80).default(""),
  mode: FilterModeSchema,
  sequence: z.number().int().min(0).max(99),
  stage: z.number().int().min(0).max(19).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
})

const SetSchema = z.object({
  by: z.enum(["group", "remark", "tag"]),
  name: z.string().trim().min(1).max(80),
})

const FileSchema = z.object({
  deviceId: z.string().uuid(),
  directory: z.string().trim().max(512),
  mode: z.enum(["random", "sequence"]),
  sequence: z.number().int().min(0).max(99),
  source: z.enum(["pool.backup", "pool.image", "pool.video"]),
  stage: z.number().int().min(0).max(19).optional(),
})

const FixedRepeatSchema = z
  .object({
    count: z.number().int().min(1).max(99),
    mode: z.literal("fixed").optional(),
    stage: z.number().int().min(0).max(19),
  })
  .strict()

const RangeRepeatSchema = z
  .object({
    max: z.number().int().min(1).max(99),
    min: z.number().int().min(1).max(99),
    mode: z.literal("range"),
    stage: z.number().int().min(0).max(19),
  })
  .strict()
  .refine((value) => value.min <= value.max)

const RepeatSchema = z.union([RangeRepeatSchema, FixedRepeatSchema])

const CreateSchema = z
  .object({
    accounts: AccountFilterSchema.optional(),
    boxIds: z.array(z.string().uuid()).max(100).optional(),
    boxes: SetSchema.optional(),
    chainId: z.string().uuid().optional(),
    files: z.array(FileSchema).max(100).optional(),
    media: z
      .array(
        z.object({
          boxes: z.array(z.string().uuid()).max(100).default([]),
          directories: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
          draw: z.enum(["random", "sequence"]),
          ids: z.array(z.string().uuid()).min(1).max(500),
          keyword: z.string().max(80).default(""),
          kind: z.enum(["image", "video"]),
          limit: z.number().int().min(1).max(1000).optional(),
          mode: FilterModeSchema,
          nasId: z.string().uuid().optional(),
          sequence: z.number().int().min(0).max(99),
          stage: z.number().int().min(0).max(19),
        }),
      )
      .max(100)
      .optional(),
    instances: z
      .array(
        z.object({
          deviceId: z.string().uuid(),
          index: z.number().int().min(1).max(5),
        }),
      )
      .max(500)
      .optional(),
    pitIndexes: z.array(z.number().int().min(1).max(5)).max(5).optional(),
    pitRange: z.array(z.number().int().min(1).max(5)).max(5).optional(),
    poolId: z.string().uuid().optional(),
    proxies: ProxyFilterSchema.optional(),
    proxyTag: z.string().trim().min(1).max(80).nullable().optional(),
    language: z
      .string()
      .regex(/^[a-z]{2}$/)
      .optional(),
    region: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    refreshes: z
      .array(
        z.object({
          sequence: z.number().int().min(0).max(99),
          stage: z.number().int().min(0).max(19),
        }),
      )
      .max(100)
      .optional(),
    refreshStages: z.array(z.number().int().min(0).max(19)).max(20).optional(),
    repeats: z.array(RepeatSchema).max(20).optional(),
    retries: z
      .array(
        z.object({
          auto: z.boolean(),
          limit: z.number().int().min(0).max(9).optional(),
          stage: z.number().int().min(0).max(19),
        }),
      )
      .max(20)
      .optional(),
    chances: z
      .array(
        z.object({
          sequence: z.number().int().min(0).max(99),
          stage: z.number().int().min(0).max(19),
          value: z.number().int().min(0).max(100),
        }),
      )
      .max(100)
      .optional(),
    taskChainId: z.string().uuid().optional(),
    texts: z.array(TextSchema).max(100).optional(),
  })
  .refine((value) => (value.chainId === undefined) !== (value.taskChainId === undefined))
  .refine((value) => {
    if (value.instances !== undefined || value.pitRange !== undefined) return true
    return value.poolId !== undefined || value.accounts !== undefined
  })
  .superRefine((value, context) => {
    const stages = (value.repeats ?? []).map((item) => item.stage)
    if (new Set(stages).size !== stages.length) {
      context.addIssue({ code: "custom", path: ["repeats"] })
    }
    const retryStages = (value.retries ?? []).map((item) => item.stage)
    if (new Set(retryStages).size !== retryStages.length) {
      context.addIssue({ code: "custom", path: ["retries"] })
    }
    for (const retry of value.retries ?? []) {
      const limit = retry.limit ?? 0
      if (retry.auto ? limit < 1 || limit > 9 : limit !== 0) {
        context.addIssue({ code: "custom", path: ["retries"] })
      }
    }
    const chanceKeys = (value.chances ?? []).map((item) => `${item.stage}:${item.sequence}`)
    if (new Set(chanceKeys).size !== chanceKeys.length) {
      context.addIssue({ code: "custom", path: ["chances"] })
    }
    const refreshKeys = (value.refreshes ?? []).map((item) => `${item.stage}:${item.sequence}`)
    if (new Set(refreshKeys).size !== refreshKeys.length) {
      context.addIssue({ code: "custom", path: ["refreshes"] })
    }
    const refreshStages = value.refreshStages ?? []
    if (new Set(refreshStages).size !== refreshStages.length) {
      context.addIssue({ code: "custom", path: ["refreshStages"] })
    }
  })

const StartSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
})

const ClearSchema = z
  .object({
    deviceIds: z.array(z.string().uuid()).max(100).optional(),
    dispatchIds: z.array(z.string().uuid()).min(1).max(50).optional(),
    unassigned: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    const byDispatch = value.dispatchIds !== undefined
    const byDevice = (value.deviceIds?.length ?? 0) > 0 || value.unassigned === true
    if (byDispatch === byDevice) context.addIssue({ code: "custom" })
  })

const selectionFrom = (input: z.infer<typeof CreateSchema>): DispatchSelection => ({
  accountIds: [],
  accountNote: "",
  accounts: input.accounts ?? null,
  boxIds: input.boxIds ?? [],
  boxes: input.boxes ?? null,
  files: (input.files ?? []).map((item) => ({
    deviceId: item.deviceId,
    directory: item.directory,
    mode: item.mode,
    sequence: item.sequence,
    source: item.source,
    ...(item.stage === undefined ? {} : { stage: item.stage }),
  })),
  media: (input.media ?? []).map((item) => ({
    boxes: item.boxes,
    directories: item.directories,
    draw: item.draw,
    ids: item.ids,
    keyword: item.keyword,
    kind: item.kind,
    limit: item.limit ?? 1,
    mode: item.mode,
    sequence: item.sequence,
    stage: item.stage,
    ...(item.nasId === undefined ? {} : { nasId: item.nasId }),
  })),
  instances: [
    ...new Map(
      (input.instances ?? []).map((item) => [`${item.deviceId}#${item.index}`, item] as const),
    ).values(),
  ],
  pitIndexes: input.pitIndexes ?? [],
  pitRange: [...new Set(input.pitRange ?? [])],
  poolId: input.poolId ?? "",
  proxies: input.proxies ?? null,
  proxyIds: [],
  proxyTag: input.proxyTag ?? null,
  language: input.language ?? "",
  region: input.region ?? "",
  repeats: (input.repeats ?? []).map((item) =>
    item.mode === "range"
      ? { max: item.max, min: item.min, mode: "range" as const, stage: item.stage }
      : { count: item.count, mode: "fixed" as const, stage: item.stage },
  ),
  chances: (input.chances ?? []).map((item) => ({
    sequence: item.sequence,
    stage: item.stage,
    value: item.value,
  })),
  texts: (input.texts ?? []).map((item) => ({
    ids: item.ids,
    keyword: item.keyword,
    mode: item.mode,
    sequence: item.sequence,
    tags: item.tags,
    ...(item.stage === undefined ? {} : { stage: item.stage }),
  })),
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
    readonly instanceIndex: number | null
    readonly itemId: string
    readonly itemStatus: string
    readonly name: string
    readonly parameters: Record<string, string>
    readonly queuePriority: number
    readonly repeatCount: number
    readonly repeatIndex: number
    readonly sequence: number
    readonly skill: string
    readonly stageName: string
    readonly stagePosition: number
    readonly stepStatus: string
    readonly taskId: string
    readonly taskStatus: string
    readonly attempt: number
    readonly autoRetry?: boolean
    readonly autoRetryLimit?: number
    readonly autoUsed?: number
    readonly refreshExternal?: boolean
    readonly replayActive?: boolean
    readonly replayOrigin?: string
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
  type Step = {
    attempt: number
    autoRetry: boolean
    autoRetryLimit: number
    autoUsed: number
    linked: boolean
    parameters: Record<string, string>
    queuePriority: number
    refreshExternal: boolean
    repeatCount: number
    repeatIndex: number
    replayActive: boolean
    replayOrigin: string
    sequence: number
    skill: string
    stageName: string
    stagePosition: number
    status: string
    taskId: string
    taskStatus: string
  }
  type Task = {
    account: string
    id: string
    name: string
    runStatus: string
    started: boolean
    status: string
    steps: Step[]
  }
  const boxes = new Map<string, { id: string; name: string; tasks: Map<string, Task> }>()
  const boxFor = (id: string | null, name: string, host: string) => {
    const key = id ?? ""
    const current = boxes.get(key)
    if (current !== undefined) return current
    const created = {
      id: key,
      name:
        key.length === 0
          ? "未分配盒子"
          : name.length > 0 && name !== host
            ? `${name} ${host}`
            : host,
      tasks: new Map<string, Task>(),
    }
    boxes.set(key, created)
    return created
  }
  for (const row of dispatchRows) {
    const box = boxFor(row.deviceId, row.deviceName, row.deviceHost)
    const task = box.tasks.get(row.itemId) ?? {
      account:
        row.account.length > 0
          ? row.account
          : `${row.deviceName || row.deviceHost || "云机"}${row.instanceIndex === null ? "" : ` · 坑位 ${row.instanceIndex}`}`,
      id: row.itemId,
      name: row.name,
      runStatus: "",
      started: row.itemStatus === "started",
      status: row.itemStatus,
      steps: [],
    }
    task.steps.push({
      attempt: row.attempt,
      autoRetry: row.autoRetry === true,
      autoRetryLimit: row.autoRetryLimit ?? 0,
      autoUsed: row.autoUsed ?? 0,
      linked: true,
      parameters: row.parameters,
      queuePriority: row.queuePriority ?? 0,
      refreshExternal: row.refreshExternal === true,
      repeatCount: row.repeatCount,
      repeatIndex: row.repeatIndex,
      replayActive: row.replayActive === true,
      replayOrigin: row.replayOrigin ?? "",
      sequence: row.sequence,
      skill: row.skill,
      stageName: row.stageName,
      stagePosition: row.stagePosition,
      status: row.stepStatus,
      taskId: row.taskId,
      taskStatus: row.taskStatus,
    })
    box.tasks.set(row.itemId, task)
  }
  for (const row of legacy) {
    const box = boxFor(row.deviceId, row.deviceName, row.deviceHost)
    const task = box.tasks.get(row.taskId) ?? {
      account: row.account,
      id: row.taskId,
      name: row.name,
      runStatus: "",
      started: true,
      status: row.status,
      steps: [],
    }
    task.steps.push({
      attempt: 1,
      autoRetry: false,
      autoRetryLimit: 0,
      autoUsed: 0,
      linked: false,
      parameters: row.parameters,
      queuePriority: 0,
      refreshExternal: false,
      repeatCount: 1,
      repeatIndex: 0,
      replayActive: false,
      replayOrigin: "",
      sequence: row.sequence,
      skill: row.skill,
      stageName: "",
      stagePosition: 0,
      status: row.stepStatus,
      taskId: row.taskId,
      taskStatus: row.status,
    })
    box.tasks.set(row.taskId, task)
  }
  return {
    boxes: [...boxes.values()].map((box) => ({
      id: box.id,
      name: box.name,
      tasks: [...box.tasks.values()].map((task) => {
        const attempts = new Map<
          string,
          { attempt: number; priority: number; repeat: number; stage: number; status: string }
        >()
        for (const step of task.steps) {
          if (step.taskId.length === 0) continue
          const key = `${step.stagePosition}:${step.repeatIndex}`
          const current = attempts.get(key)
          if (current !== undefined && current.attempt > step.attempt) continue
          attempts.set(key, {
            attempt: step.attempt,
            priority: step.queuePriority,
            repeat: step.repeatIndex,
            stage: step.stagePosition,
            status: step.taskStatus,
          })
        }
        return {
          ...task,
          runStatus: task.started ? accountRunStatus([...attempts.values()]) : "",
          steps: task.steps.map((step, index) => ({ ...step, sequence: index })),
        }
      }),
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
  app.get("/api/groups/:groupId/dispatches/media-files", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "dispatch.media-files",
      Permission.OperationsRead,
      PageKey.Tasks,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const kind = context.req.query("kind") ?? ""
    const deviceId = context.req.query("deviceId")
    const nasId = context.req.query("nasId")
    const deviceOk = deviceId !== undefined && /^[0-9a-f-]{36}$/i.test(deviceId)
    const nasOk = nasId !== undefined && /^[0-9a-f-]{36}$/i.test(nasId)
    if ((kind !== "image" && kind !== "video") || deviceOk === nasOk) {
      return context.json({ error: "invalid_dispatch_request" }, 400)
    }
    const administratorId = await administratorFor(sql, authorization.principal.userId)
    return context.json({
      files: await repository.mediaFiles(authorization.groupId, administratorId, kind, {
        ...(deviceOk && deviceId !== undefined ? { deviceId } : {}),
        ...(nasOk && nasId !== undefined ? { nasId } : {}),
      }),
    })
  })
  app.get("/api/groups/:groupId/dispatches/directories", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "dispatch.directories",
      Permission.OperationsRead,
      PageKey.Tasks,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const deviceId = context.req.query("deviceId") ?? ""
    const source = context.req.query("source") ?? ""
    if (
      !/^[0-9a-f-]{36}$/i.test(deviceId) ||
      (source !== "pool.video" && source !== "pool.image" && source !== "pool.backup")
    ) {
      return context.json({ error: "invalid_dispatch_request" }, 400)
    }
    const administratorId = await administratorFor(sql, authorization.principal.userId)
    return context.json({
      directories: await repository.directories(
        authorization.groupId,
        administratorId,
        deviceId,
        source,
      ),
    })
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
  app.get("/api/groups/:groupId/dispatches/:dispatchId/items/:itemId/steps", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "dispatch.steps",
      Permission.OperationsRead,
      PageKey.Tasks,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    const dispatchId = context.req.param("dispatchId")
    const itemId = context.req.param("itemId")
    if (!/^[0-9a-f-]{36}$/i.test(dispatchId) || !/^[0-9a-f-]{36}$/i.test(itemId)) {
      return context.json({ error: "invalid_dispatch_request" }, 400)
    }
    const steps = await repository.itemSteps(authorization.groupId, dispatchId, itemId)
    if (steps === null) return context.json({ error: "not_found" }, 404)
    return context.json(steps)
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
      { chainId: input.chainId ?? null, taskChainId: input.taskChainId ?? null },
      selectionFrom(input),
      {
        refreshes: input.refreshes ?? [],
        refreshStages: input.refreshStages ?? [],
        retries: (input.retries ?? []).map((item) => ({
          auto: item.auto,
          limit: item.auto ? (item.limit ?? 0) : 0,
          stage: item.stage,
        })),
      },
    )
    if (created.kind === "invalid") return context.json({ error: "invalid_dispatch_request" }, 400)
    if (created.kind === "missing_chain") return context.json({ error: "not_found" }, 404)
    if (created.kind === "missing_pool") return context.json({ error: "pool_not_found" }, 404)
    if (created.kind === "no_accounts") return context.json({ error: "no_accounts" }, 400)
    if (created.kind === "account_required") return context.json({ error: "account_required" }, 400)
    if (created.kind === "account_not_allowed") {
      return context.json({ error: "account_not_allowed" }, 400)
    }
    if (created.kind === "region_required") return context.json({ error: "region_required" }, 400)
    if (created.kind === "region_not_allowed") {
      return context.json({ error: "region_not_allowed" }, 400)
    }
    if (created.kind === "language_required")
      return context.json({ error: "language_required" }, 400)
    if (created.kind === "language_not_allowed") {
      return context.json({ error: "language_not_allowed" }, 400)
    }
    if (created.kind === "instances_required")
      return context.json({ error: "instances_required" }, 400)
    if (created.kind === "instance_out_of_range") {
      return context.json({ error: "instance_out_of_range" }, 400)
    }
    if (created.kind === "instance_not_found")
      return context.json({ error: "instance_not_found" }, 400)
    if (created.kind === "chance_required") return context.json({ error: "chance_required" }, 400)
    if (created.kind === "chance_not_allowed") {
      return context.json({ error: "chance_not_allowed" }, 400)
    }
    if (created.kind === "text_required") return context.json({ error: "text_required" }, 400)
    if (created.kind === "text_not_allowed") return context.json({ error: "text_not_allowed" }, 400)
    if (created.kind === "text_empty") return context.json({ error: "text_empty" }, 400)
    if (created.kind === "media_required" || created.kind === "media_empty") {
      return context.json({ error: created.kind, mediaKind: created.mediaKind }, 400)
    }
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
  app.get("/api/groups/:groupId/dispatch-records/:taskId/replay-options", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "dispatch.replay",
      Permission.OperationsWrite,
      PageKey.TaskRecords,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    return context.json({ error: "manual_replay_disabled" }, 403)
  })
  app.post("/api/groups/:groupId/dispatch-records/:taskId/replay", async (context) => {
    const authorization = await authorizeOperationRequest(
      context,
      authService,
      auditRepository,
      "dispatch.replay",
      Permission.OperationsWrite,
      PageKey.TaskRecords,
    )
    if (hasOperationAuthorizationFailure(authorization)) return authorization.response
    return context.json({ error: "manual_replay_disabled" }, 403)
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
      input.deviceIds ?? [],
      input.unassigned === true,
      input.dispatchIds ?? [],
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
