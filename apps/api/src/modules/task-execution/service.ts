import { createHash } from "node:crypto"
import {
  type ExecutionTaskRepository,
  parseExecutableCommand,
  type ReconciliationOutcome,
  type SystemActorMetadata,
  type TaskRecord,
  type TaskSubmission,
} from "@tk-mg/task-execution"
import { z } from "zod"

import { GroupIdSchema, UserIdSchema } from "../../lib/authorization"
import type { DeviceRepository } from "../devices/repository"

const StepInputSchema = z.record(z.string(), z.unknown()).and(
  z.object({
    type: z.string(),
    target: z.strictObject({
      deviceId: z.string().uuid(),
      instanceId: z.string().uuid().optional(),
    }),
  }),
)

export class InvalidTaskRequestError extends Error {
  override readonly name = "InvalidTaskRequestError"

  constructor() {
    super("Invalid task request")
  }
}

export const SubmitTaskSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  executorKey: z.literal("device-command"),
  parameters: z.strictObject({}).default({}),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  steps: z.array(StepInputSchema).min(1).max(100),
})
export type SubmitTaskInput = z.infer<typeof SubmitTaskSchema>
export const ReconcileTaskSchema = z.strictObject({
  resolution: z.enum(["succeeded", "failed", "cancelled"]),
  evidenceRef: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine((value) => !value.includes("\n")),
})
export type ReconcileTaskInput = z.infer<typeof ReconcileTaskSchema>

export type SafeTaskStep = {
  readonly stepId: string
  readonly ordinal: number
  readonly kind: string
  readonly state: string
  readonly attempt: number
  readonly target: { readonly deviceId: string; readonly instanceId?: string | undefined }
}

export type SafeTask = {
  readonly taskId: string
  readonly state: string
  readonly attempt: number
  readonly maxAttempts: number
  readonly target: { readonly deviceId: string; readonly instanceId?: string | undefined }
  readonly steps: readonly SafeTaskStep[]
  readonly createdAt: number
  readonly updatedAt: number
}

export type TaskPage = {
  readonly items: readonly SafeTask[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
}

type SubmitContext = {
  readonly actorId: string
  readonly groupId: string
  readonly requestId: string
  readonly idempotencyKey: string
}

type Dependencies = {
  readonly deviceRepository: DeviceRepository
  readonly repository: Pick<
    ExecutionTaskRepository,
    "submit" | "get" | "list" | "requestCancel" | "reconcile"
  >
}

const fingerprint = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")

const safeTarget = (target: {
  readonly deviceId: string
  readonly instanceId?: string | undefined
}) => ({
  deviceId: target.deviceId,
  ...(target.instanceId === undefined ? {} : { instanceId: target.instanceId }),
})

const safeTask = (task: TaskRecord): SafeTask => ({
  taskId: task.taskId,
  state: task.state,
  attempt: task.attempt,
  maxAttempts: task.maxAttempts,
  target: safeTarget(task.target),
  steps: task.steps.map((step) => ({
    stepId: step.stepId,
    ordinal: step.ordinal,
    kind: step.command.type,
    state: step.state,
    attempt: step.attempt,
    target: safeTarget(step.command.target),
  })),
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
})

export interface TaskExecutionService {
  reconcile(
    context: Pick<SubmitContext, "actorId" | "groupId" | "requestId">,
    taskId: string,
    input: ReconcileTaskInput,
  ): Promise<ReconciliationOutcome>
  submit(
    context: SubmitContext,
    input: SubmitTaskInput,
  ): Promise<{ readonly task: SafeTask; readonly created: boolean } | null>
  get(groupId: string, taskId: string): Promise<SafeTask | null>
  list(groupId: string, page: number, pageSize: number): Promise<TaskPage>
  cancel(
    context: Pick<SubmitContext, "actorId" | "groupId" | "requestId">,
    taskId: string,
  ): Promise<SafeTask | null>
}

export const createTaskExecutionService = (dependencies: Dependencies): TaskExecutionService => ({
  reconcile: async (context, taskId, input) => {
    if (!z.uuid().safeParse(taskId).success) return "not_found"
    return dependencies.repository.reconcile({
      taskId,
      groupId: context.groupId,
      resolution: input.resolution,
      evidenceHash: createHash("sha256").update(input.evidenceRef).digest("hex"),
      actor: { actorId: context.actorId, actorType: "user", requestId: context.requestId },
      now: Date.now(),
    })
  },
  submit: async (context, input) => {
    const groupId = GroupIdSchema.parse(context.groupId)
    const requesterId = UserIdSchema.parse(context.actorId)
    const commands = input.steps.map((step, index) => {
      const command = parseExecutableCommand({
        ...step,
        commandId: crypto.randomUUID(),
        idempotencyKey: `${context.idempotencyKey}:${index}`,
        timeoutMs: 5_000,
      })
      return { command, sequence: index }
    })
    const first = commands[0]
    if (first === undefined) return null
    const deviceId = first.command.target.deviceId
    const device = await dependencies.deviceRepository.findDevice(groupId, deviceId)
    if (device === null) return null
    const expectedInstanceId = first.command.target.instanceId
    for (const item of commands) {
      if (
        item.command.target.deviceId !== deviceId ||
        item.command.target.instanceId !== expectedInstanceId
      )
        throw new InvalidTaskRequestError()
      const instanceId = item.command.target.instanceId
      if (
        instanceId !== undefined &&
        !device.instances.some((instance) => instance.id === instanceId)
      )
        throw new InvalidTaskRequestError()
    }
    const submission: TaskSubmission = {
      taskId: crypto.randomUUID(),
      groupId,
      requesterId,
      deviceId,
      idempotencyKey: context.idempotencyKey,
      fingerprint: fingerprint(input),
      name: input.name,
      executorKey: input.executorKey,
      parameters: {},
      maxAttempts: input.maxAttempts,
      steps: commands.map((item) => ({
        stepId: crypto.randomUUID(),
        sequence: item.sequence,
        command: item.command,
        fingerprint: fingerprint(item.command),
      })),
    }
    const actor: SystemActorMetadata = {
      actorId: requesterId,
      actorType: "user",
      requestId: context.requestId,
    }
    const result = await dependencies.repository.submit(submission, actor)
    return { task: safeTask(result.task), created: result.created }
  },
  get: async (groupId, taskId) => {
    if (!GroupIdSchema.safeParse(groupId).success || !z.uuid().safeParse(taskId).success)
      return null
    const task = await dependencies.repository.get(groupId, taskId)
    return task === null ? null : safeTask(task)
  },
  list: async (groupId, page, pageSize) => {
    const result = await dependencies.repository.list(GroupIdSchema.parse(groupId), page, pageSize)
    return { ...result, items: result.items.map(safeTask) }
  },
  cancel: async (context, taskId) => {
    if (!z.uuid().safeParse(taskId).success) return null
    const actor: SystemActorMetadata = {
      actorId: UserIdSchema.parse(context.actorId),
      actorType: "user",
      requestId: context.requestId,
    }
    const changed = await dependencies.repository.requestCancel(
      context.groupId,
      taskId,
      actor,
      Date.now(),
    )
    if (!changed)
      return dependencies.repository
        .get(context.groupId, taskId)
        .then((task) => (task === null ? null : safeTask(task)))
    const task = await dependencies.repository.get(context.groupId, taskId)
    return task === null ? null : safeTask(task)
  },
})
