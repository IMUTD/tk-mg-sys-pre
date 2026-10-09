import {
  type DeviceAdapter,
  type DeviceCommandResult,
  DeviceTargetSchema,
} from "@tk-mg/device-adapter"
import type { Sql } from "postgres"
import { parseExecutableCommand } from "./commands"
import {
  canTransitionTask,
  decideStaleRecovery,
  type PersistedStepState,
  parsePersistedStepState,
  parsePersistedTaskState,
  transitionTask,
} from "./lifecycle"
import type {
  ExecutionLease,
  OutboxMessage,
  SystemActorMetadata,
  TaskRecord,
  TaskState,
  TaskStepRecord,
} from "./models"
import { canPersistTaskTransition } from "./persisted-transition"
import { DEFAULT_RETRY_POLICY, EXECUTION_LIMITS, type RetryPolicy, retryDeadline } from "./policy"
import {
  markSubmitStarted,
  quarantineTask,
  rejectInvalidPersistedTask,
  type SubmitBoundary,
} from "./provider-boundary"
import { confirmProviderStep } from "./provider-recovery"
import { safeExecutionError, safeExecutionResult } from "./redaction"
import type { DeviceLeaseInput, OutboxRepository, TaskClaim } from "./repositories"
import { terminalProjection } from "./terminal-projection"

type OutboxRow = {
  readonly id: string
  readonly taskId: string
  readonly eventType: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly availableAt: Date
  readonly claimedAt: Date | null
  readonly claimedBy: string | null
  readonly attemptCount: number
}

export type WorkerRepository = OutboxRepository & {
  readonly markSubmitStarted: (input: SubmitBoundary) => Promise<boolean>
  readonly quarantineOwned: (input: SubmitBoundary) => Promise<boolean>
  readonly claimTask: (
    owner: string,
    now: number,
    leaseMs: number,
    taskId?: string,
  ) => Promise<TaskClaim | null>
  readonly renewTask: (
    taskId: string,
    runId: string,
    claimToken: string,
    now: number,
    leaseMs: number,
  ) => Promise<boolean>
  readonly getOwnedTask: (
    taskId: string,
    runId: string,
    owner: string,
    claimToken: string,
  ) => Promise<TaskClaim | null>
  readonly claimNext: (
    taskId: string,
    runId: string,
    owner: string,
    claimToken: string,
    now: number,
  ) => Promise<TaskStepRecord | null>
  readonly finishStep: (
    taskId: string,
    runId: string,
    owner: string,
    claimToken: string,
    stepId: string,
    status: "succeeded" | "failed" | "timed_out" | "cancelled",
    result: DeviceCommandResult | undefined,
    errorCode: string | undefined,
    errorMessage: string | undefined,
    now: number,
  ) => Promise<boolean>
  readonly retryStep: (
    taskId: string,
    runId: string,
    owner: string,
    claimToken: string,
    stepId: string,
    errorCode: string,
    errorMessage: string,
    now: number,
  ) => Promise<boolean>
  readonly finishOwned: (
    taskId: string,
    runId: string,
    claimToken: string,
    expectedState: TaskClaim["state"],
    nextState: "succeeded" | "failed" | "cancelled" | "timed_out" | "retry_waiting",
    now: number,
    nextRetryAt?: number,
  ) => Promise<boolean>
  readonly acquireDeviceLease: (input: DeviceLeaseInput) => Promise<boolean>
  readonly renewDeviceLease: (
    leaseId: string,
    leaseToken: string,
    expiresAt: number,
    heartbeatAt: number,
  ) => Promise<boolean>
  readonly releaseDeviceLease: (
    leaseId: string,
    leaseToken: string,
    reason: string,
  ) => Promise<boolean>
  readonly recoverStale: (now: number, limit: number) => Promise<readonly ExecutionLease[]>
  readonly checkReadiness: () => Promise<void>
}

type ExecutionTaskRow = {
  readonly id: string
  readonly groupId: string
  readonly deviceId: string
  readonly status: TaskRecord["state"]
  readonly retryCount: number
  readonly maxAttempts: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

type ExecutionStepRow = {
  readonly id: string
  readonly taskId: string
  readonly sequence: number
  readonly commandId: string
  readonly commandIdempotencyKey: string
  readonly kind: string
  readonly target: unknown
  readonly parameters: Readonly<Record<string, unknown>>
  readonly status: string
}

type WorkerRepositoryOptions = {
  readonly getResult?: DeviceAdapter["getResult"]
  readonly outboxLeaseMs?: number
  readonly systemActor?: SystemActorMetadata
  readonly minimumRetryDelayMs?: number
  readonly retryPolicy?: RetryPolicy
  readonly random?: () => number
}

export const checkSystemActorReadiness = async (db: Sql, actorId: string): Promise<void> => {
  const rows = await db<{ readonly id: string }[]>`
    select id from app_user
    where id = ${actorId} and role = 'administrator' and enabled = false
  `
  if (rows.length !== 1) {
    throw new Error("Configured system actor must be an existing disabled administrator")
  }
}

const toMessages = (rows: readonly OutboxRow[]): readonly OutboxMessage[] =>
  rows.map((row) => ({
    outboxId: row.id,
    aggregateId: row.taskId,
    eventType: row.eventType,
    payload: row.payload,
    availableAt: row.availableAt.getTime(),
    ...(row.claimedAt === null ? {} : { claimedAt: row.claimedAt.getTime() }),
    ...(row.claimedBy === null ? {} : { claimOwner: row.claimedBy }),
    claimAttempt: row.attemptCount,
  }))

const readClaim = async (
  db: import("postgres").Sql | import("postgres").TransactionSql,
  task: ExecutionTaskRow,
  runId: string,
  claimToken: string,
  leaseExpiresAt: number,
  actor: SystemActorMetadata,
): Promise<TaskClaim> => {
  const rows = await db<ExecutionStepRow[]>`select id, task_id as "taskId", sequence,
    command_id as "commandId", command_idempotency_key as "commandIdempotencyKey", kind, target,
    parameters, status from execution_task_step where task_id = ${task.id} order by sequence`
  const steps = rows.map(
    (row): TaskStepRecord => ({
      stepId: row.id,
      taskId: row.taskId,
      ordinal: row.sequence,
      command: parseExecutableCommand({
        ...row.parameters,
        commandId: row.commandId,
        idempotencyKey: row.commandIdempotencyKey,
        target: DeviceTargetSchema.parse(row.target),
        type: row.kind,
      }),
      state: parsePersistedStepState(row.status),
      attempt: 0,
    }),
  )
  const record: TaskRecord = {
    taskId: task.id,
    groupId: task.groupId,
    target: steps[0]?.command.target ?? DeviceTargetSchema.parse({ deviceId: task.deviceId }),
    state: parsePersistedTaskState(task.status),
    attempt: task.retryCount,
    maxAttempts: task.maxAttempts,
    steps,
    actor,
    createdAt: task.createdAt.getTime(),
    updatedAt: task.updatedAt.getTime(),
  }
  return { ...record, runId, claimToken, leaseExpiresAt }
}

const appendTransition = async (
  db: import("postgres").TransactionSql,
  taskId: string,
  groupId: string,
  fromStatus: string,
  toStatus: string,
  actor: SystemActorMetadata,
  now: number,
  source = "recovery",
  reason = "lease_expired",
  availableAt = now,
): Promise<void> => {
  const eventId = crypto.randomUUID()
  await db`insert into execution_task_event
    (id, task_id, group_id, from_status, to_status, source, reason, actor_id)
    values (${eventId}, ${taskId}, ${groupId}, ${fromStatus}, ${toStatus}, ${source}, ${reason}, ${actor.actorId})`
  await db`insert into execution_task_outbox
    (event_id, task_id, group_id, event_type, payload, available_at)
    values (${eventId}, ${taskId}, ${groupId}, 'execution_task.status_changed',
       ${db.json({ taskId, fromStatus, toStatus, source, reason, occurredAt: now })}, ${new Date(availableAt)})`
}

export const createPostgresWorkerRepository = (
  db: Sql,
  options: WorkerRepositoryOptions = {},
): WorkerRepository => ({
  markSubmitStarted: (input) => markSubmitStarted(db, input),
  quarantineOwned: (input) =>
    db.begin(async (tx) => {
      const owned = await tx`select id from execution_task_run where id = ${input.runId}
      and task_id = ${input.taskId} and step_id = ${input.stepId} and claim_token = ${input.claimToken}
      and worker_id = ${input.owner} and status = 'running'
      and claim_expires_at > ${new Date(input.now)} for update`
      if (owned.length === 0) return false
      const actor = options.systemActor
      if (actor === undefined) throw new Error("Worker system actor is required")
      return quarantineTask(tx, input, actor)
    }),
  claimTask: async (owner, now, leaseMs, requestedTaskId) =>
    db.begin(async (tx) => {
      const rows = await tx<
        ExecutionTaskRow[]
      >`select id, group_id as "groupId", device_id as "deviceId",
        status, retry_count as "retryCount", max_attempts as "maxAttempts", created_at as "createdAt",
        updated_at as "updatedAt" from execution_task
        where (${requestedTaskId ?? null}::uuid is null or id = ${requestedTaskId ?? null})
           and executor_key <> 'box-agent'
           and (status = 'queued' or (status = 'retry_waiting' and next_retry_at <= ${new Date(now)}))
        order by created_at, id for update skip locked limit 1`
      const task = rows[0]
      if (task === undefined) return null
      const validationActor = options.systemActor
      if (validationActor === undefined) throw new Error("Worker system actor is required")
      if (await rejectInvalidPersistedTask(tx, task, { actor: validationActor, now })) return null
      if (!canTransitionTask(task.status, "dispatching")) return null
      const runId = crypto.randomUUID()
      const claimToken = crypto.randomUUID()
      const expiresAt = now + leaseMs
      const updated = await tx<ExecutionTaskRow[]>`update execution_task set status = 'dispatching',
        started_at = coalesce(started_at, ${new Date(now)}), updated_at = ${new Date(now)}
        where id = ${task.id} and status = ${task.status} returning id, group_id as "groupId",
        device_id as "deviceId", status, retry_count as "retryCount", max_attempts as "maxAttempts",
        created_at as "createdAt", updated_at as "updatedAt"`
      const current = updated[0]
      if (current === undefined) return null
      await tx`insert into execution_task_run (id, task_id, group_id, attempt, worker_id, claim_token,
        claim_expires_at, heartbeat_at, started_at) values (${runId}, ${task.id}, ${task.groupId},
        ${task.retryCount + 1}, ${owner}, ${claimToken}, ${new Date(expiresAt)}, ${new Date(now)}, ${new Date(now)})`
      const actor = options.systemActor
      if (actor === undefined) throw new Error("Worker system actor is required for claim audit")
      await appendTransition(
        tx,
        task.id,
        task.groupId,
        task.status,
        "dispatching",
        actor,
        now,
        "claim",
        "claimed",
      )
      await tx`insert into audit_event (id, actor_id, action, outcome, target, metadata)
        values (${crypto.randomUUID()}, ${actor.actorId}, 'execution.task.claim', 'allowed',
          ${`execution-task:${task.id}`}, ${tx.json({ taskId: task.id, owner, requestId: actor.requestId, actorType: actor.actorType })})`
      return readClaim(tx, current, runId, claimToken, expiresAt, actor)
    }),
  renewTask: async (taskId, runId, claimToken, now, leaseMs) =>
    (
      await db`update execution_task_run set heartbeat_at = ${new Date(now)},
        claim_expires_at = ${new Date(now + leaseMs)} where id = ${runId} and task_id = ${taskId}
        and claim_token = ${claimToken} and status in ('claimed', 'running') and claim_expires_at > ${new Date(now)}`
    ).count === 1,
  getOwnedTask: async (taskId, runId, owner, claimToken) => {
    const rows = await db<ExecutionTaskRow[]>`select task.id, task.group_id as "groupId",
      task.device_id as "deviceId", task.status, task.retry_count as "retryCount",
      task.max_attempts as "maxAttempts", task.created_at as "createdAt", task.updated_at as "updatedAt"
      from execution_task task join execution_task_run run on run.task_id = task.id
      where task.id = ${taskId} and run.id = ${runId} and run.worker_id = ${owner}
        and run.claim_token = ${claimToken} and run.status in ('claimed', 'running')
        and run.claim_expires_at > now()`
    const task = rows[0]
    if (task === undefined) return null
    const runs = await db<{ readonly expiresAt: Date }[]>`select claim_expires_at as "expiresAt"
       from execution_task_run where id = ${runId}`
    const expiresAt = runs[0]?.expiresAt
    const actor = options.systemActor
    if (actor === undefined) throw new Error("Worker system actor is required for claim audit")
    return expiresAt === undefined
      ? null
      : readClaim(db, task, runId, claimToken, expiresAt.getTime(), actor)
  },
  claimNext: async (taskId, runId, owner, claimToken, now) =>
    db.begin(async (tx) => {
      const valid =
        await tx`select id from execution_task_run where id = ${runId} and task_id = ${taskId}
        and worker_id = ${owner} and claim_token = ${claimToken} and status in ('claimed', 'running')
        and claim_expires_at > ${new Date(now)} for update`
      if (valid.length === 0) return null
      const active = await tx`select id from execution_task where id = ${taskId}
        and status in ('dispatching', 'running') for update`
      if (active.length === 0) return null
      const rows = await tx<ExecutionStepRow[]>`select id, task_id as "taskId", sequence,
        command_id as "commandId", command_idempotency_key as "commandIdempotencyKey", kind, target,
        parameters, status from execution_task_step where task_id = ${taskId} and status = 'pending'
        and not exists (select 1 from execution_task_step prior where prior.task_id = execution_task_step.task_id
          and prior.sequence < execution_task_step.sequence and prior.status not in ('succeeded', 'skipped'))
        order by sequence for update skip locked limit 1`
      const row = rows[0]
      if (row === undefined) return null
      const updated =
        await tx`update execution_task_step set status = 'claimed', started_at = ${new Date(now)}
        where id = ${row.id} and status = 'pending' returning id`
      if (updated.length === 0) return null
      await tx`update execution_task_run set status = 'running', step_id = ${row.id} where id = ${runId}`
      const taskStatus = await tx<{ readonly status: TaskState; readonly groupId: string }[]>`
        select status, group_id as "groupId" from execution_task where id = ${taskId} for update`
      const task = taskStatus[0]
      if (task?.status === "dispatching") {
        if (!canTransitionTask(task.status, "running")) return null
        await tx`update execution_task set status = 'running', updated_at = ${new Date(now)}
          where id = ${taskId} and status = 'dispatching'`
        const actor = options.systemActor
        if (actor === undefined)
          throw new Error("Worker system actor is required for transition audit")
        await appendTransition(
          tx,
          taskId,
          task.groupId,
          task.status,
          "running",
          actor,
          now,
          "claim",
          "step_claimed",
        )
        await tx`insert into audit_event (id, actor_id, action, outcome, target, metadata)
          values (${crypto.randomUUID()}, ${actor.actorId}, 'execution.task.running', 'allowed',
            ${`execution-task:${taskId}`}, ${tx.json({ taskId, requestId: actor.requestId, actorType: actor.actorType })})`
      }
      return {
        stepId: row.id,
        taskId: row.taskId,
        ordinal: row.sequence,
        command: parseExecutableCommand({
          ...row.parameters,
          commandId: row.commandId,
          idempotencyKey: row.commandIdempotencyKey,
          target: DeviceTargetSchema.parse(row.target),
          type: row.kind,
        }),
        state: "claimed" as const,
        attempt: 0,
      }
    }),
  finishStep: async (
    taskId,
    runId,
    owner,
    claimToken,
    stepId,
    status,
    result,
    errorCode,
    errorMessage,
    now,
  ) =>
    db.begin(async (tx) => {
      if (status === "succeeded" && result?.status !== "succeeded") return false
      if (status === "cancelled" && result?.status !== "cancelled") return false
      if (result !== undefined && result.status !== status) return false
      const valid =
        await tx`select id from execution_task_run where id = ${runId} and task_id = ${taskId}
        and worker_id = ${owner} and claim_token = ${claimToken} and status in ('claimed', 'running')
        and claim_expires_at > ${new Date(now)} for update`
      if (valid.length === 0) return false
      const active = await tx`select id from execution_task where id = ${taskId}
        and (status in ('dispatching', 'running') or (status = 'cancel_requested'
          and (${status} in ('cancelled', 'succeeded', 'failed', 'timed_out')))) for update`
      if (active.length === 0) return false
      const safeError =
        errorCode === undefined && errorMessage === undefined
          ? null
          : safeExecutionError(errorCode, errorMessage)
      const rows =
        await tx`update execution_task_step set status = ${status}, result = ${result === undefined ? null : tx.json(safeExecutionResult(result))},
        error_code = ${safeError?.code ?? null}, error_message = ${safeError?.message ?? null}, finished_at = ${new Date(now)}
        where id = ${stepId} and task_id = ${taskId} and status in ('claimed', 'running')
          and (${result === undefined} or command_id::text = ${result?.commandId ?? null})
          and exists (select 1 from execution_task_run where id = ${runId} and step_id = ${stepId}
            and task_id = ${taskId} and worker_id = ${owner} and claim_token = ${claimToken}
            and status in ('claimed', 'running') and claim_expires_at > ${new Date(now)}) returning id`
      return rows.length === 1
    }),
  retryStep: async (taskId, runId, owner, claimToken, stepId, errorCode, errorMessage, now) =>
    db.begin(async (tx) => {
      const valid =
        await tx`select id from execution_task_run where id = ${runId} and task_id = ${taskId}
        and worker_id = ${owner} and claim_token = ${claimToken} and status in ('claimed', 'running')
        and claim_expires_at > ${new Date(now)} for update`
      if (valid.length === 0) return false
      const active = await tx`select id from execution_task where id = ${taskId}
        and status in ('dispatching', 'running') for update`
      if (active.length === 0) return false
      const safeError = safeExecutionError(errorCode, errorMessage)
      const rows =
        await tx`update execution_task_step set status = 'pending', error_code = ${safeError.code},
        error_message = ${safeError.message}, result = null where id = ${stepId} and task_id = ${taskId}
        and submit_started_at is null and status in ('claimed', 'running') and exists (select 1 from execution_task_run
          where id = ${runId} and step_id = ${stepId} and claim_token = ${claimToken}) returning id`
      return rows.length === 1
    }),
  finishOwned: async (taskId, runId, claimToken, expectedState, nextState, now, nextRetryAt) =>
    db.begin(async (tx) => {
      const runState = nextState === "retry_waiting" ? "failed" : nextState
      const owned = await tx`select id from execution_task_run where id = ${runId}
        and task_id = ${taskId} and claim_token = ${claimToken}
        and status in ('claimed', 'running') and claim_expires_at > ${new Date(now)} for update`
      if (owned.length === 0) return false
      const current = await tx<
        {
          readonly retryCount: number
          readonly maxAttempts: number
        }[]
      >`select retry_count as "retryCount", max_attempts as "maxAttempts" from execution_task
        where id = ${taskId} and status = ${expectedState} for update`
      const attempts = current[0]
      if (attempts === undefined) return false
      if (nextState === "retry_waiting") {
        const marked = await tx`select id from execution_task_step where task_id = ${taskId}
           and submit_started_at is not null and status not in ('succeeded', 'skipped') limit 1`
        if (marked.length > 0) return false
      }
      const exhausted =
        nextState === "retry_waiting" && attempts.retryCount + 1 >= attempts.maxAttempts
      const resolvedState = exhausted ? "failed" : nextState
      const retryAt =
        resolvedState === "retry_waiting"
          ? (nextRetryAt ??
            retryDeadline(
              now,
              attempts.retryCount + 1,
              options.minimumRetryDelayMs ?? 1_000,
              options.retryPolicy,
              options.random,
            ))
          : null
      const minimum = Math.min(
        EXECUTION_LIMITS.maxBackoffMs.maximum,
        Math.max(
          options.minimumRetryDelayMs ?? 1_000,
          options.retryPolicy?.baseBackoffMs ?? DEFAULT_RETRY_POLICY.baseBackoffMs,
        ),
      )
      if (
        retryAt !== null &&
        (retryAt < now + minimum || retryAt > now + EXECUTION_LIMITS.maxBackoffMs.maximum)
      )
        return false
      if (!(await canPersistTaskTransition(tx, taskId, { from: expectedState, to: resolvedState })))
        return false
      const successProjection =
        resolvedState === "succeeded" ? await terminalProjection(tx, taskId, resolvedState) : null
      if (resolvedState === "succeeded" && successProjection === null) return false
      const tasks = await tx<
        { readonly groupId: string }[]
      >`update execution_task set status = ${resolvedState}, updated_at = ${new Date(now)},
        finished_at = case when ${resolvedState} = 'retry_waiting' then null else ${new Date(now)} end,
        retry_count = case when ${nextState} = 'retry_waiting' then retry_count + 1 else retry_count end,
         next_retry_at = ${retryAt === null ? null : new Date(retryAt)},
        last_retry_at = case when ${nextState} = 'retry_waiting' then ${new Date(now)} else last_retry_at end,
        terminal_reason = case when ${resolvedState} = 'retry_waiting' then null
          when ${exhausted} then 'retry_exhausted' else ${resolvedState} end
        where id = ${taskId} and status = ${expectedState}
          and (${nextState} <> 'succeeded' or not exists (select 1 from execution_task_step
            where task_id = ${taskId} and status not in ('succeeded', 'skipped')))
        returning group_id as "groupId"`
      const task = tasks[0]
      if (task === undefined) return false
      if (exhausted) {
        await tx`update execution_task_step set status = 'failed', error_code = 'retry_exhausted',
          finished_at = ${new Date(now)} where task_id = ${taskId}
            and id = (select step_id from execution_task_run where id = ${runId})
            and status in ('pending', 'claimed', 'running')`
      }
      const projection =
        resolvedState === "retry_waiting"
          ? null
          : (successProjection ?? (await terminalProjection(tx, taskId, resolvedState)))
      await tx`update execution_task set result = ${projection?.result === undefined || projection.result === null ? null : tx.json(projection.result)},
        error_code = ${projection?.errorCode ?? null}, error_message = ${projection?.errorMessage ?? null}
        where id = ${taskId} and status = ${resolvedState}`
      await tx`update execution_task_run set status = ${runState}, finished_at = ${new Date(now)}
        where id = ${runId}`
      const actor = options.systemActor
      if (actor === undefined)
        throw new Error("Worker system actor is required for transition audit")
      await appendTransition(
        tx,
        taskId,
        task.groupId,
        expectedState,
        resolvedState,
        actor,
        now,
        "finish",
        "finished",
        retryAt ?? now,
      )
      await tx`insert into audit_event (id, actor_id, action, outcome, target, metadata)
        values (${crypto.randomUUID()}, ${actor.actorId}, 'execution.task.finish', 'allowed',
          ${`execution-task:${taskId}`}, ${tx.json({ taskId, nextState: resolvedState, requestId: actor.requestId, actorType: actor.actorType })})`
      return true
    }),
  acquireDeviceLease: async (input) =>
    db.begin(async (tx) => {
      await tx`select id from device where id = ${input.deviceId} and group_id = ${input.groupId} for update`
      const conflicts = await tx`select id from device_command where group_id = ${input.groupId}
        and device_id = ${input.deviceId} and (${input.instanceId ?? null}::uuid is null
          or instance_id is null or instance_id = ${input.instanceId ?? null}::uuid)
        and status in ('queued', 'running') for key share limit 1`
      if (conflicts.length > 0) return false
      const leases = await tx`select id from execution_task_device_lease
        where group_id = ${input.groupId} and device_id = ${input.deviceId}
          and released_at is null and (${input.instanceId ?? null}::uuid is null
            or instance_id is null or instance_id = ${input.instanceId ?? null}::uuid)
        limit 1`
      if (leases.length > 0) return false
      const rows =
        await tx`insert into execution_task_device_lease (id, task_id, group_id, device_id, instance_id,
        lease_token, worker_id, expires_at, heartbeat_at) values (${input.leaseId}, ${input.taskId}, ${input.groupId},
        ${input.deviceId}, ${input.instanceId ?? null}, ${input.leaseToken}, ${input.workerId}, ${new Date(input.expiresAt)}, now())
        on conflict do nothing returning id`
      return rows.length === 1
    }),
  renewDeviceLease: async (leaseId, leaseToken, expiresAt, heartbeatAt) =>
    (
      await db`update execution_task_device_lease set expires_at = ${new Date(expiresAt)}, heartbeat_at = ${new Date(heartbeatAt)}
        where id = ${leaseId} and lease_token = ${leaseToken} and released_at is null and expires_at > now()`
    ).count === 1,
  releaseDeviceLease: async (leaseId, leaseToken, reason) =>
    (
      await db`update execution_task_device_lease set released_at = now(), recovery_reason = ${reason}
        where id = ${leaseId} and lease_token = ${leaseToken} and released_at is null
          and not exists (select 1 from execution_task_step where task_id = execution_task_device_lease.task_id
            and submit_started_at is not null and status in ('pending','claimed','running'))
          and not exists (select 1 from execution_task where id = execution_task_device_lease.task_id
            and status = 'needs_reconciliation')`
    ).count === 1,
  claimAvailable: async (owner, now, limit) =>
    db.begin(async (tx) => {
      const rows = await tx<OutboxRow[]>`
        select id, task_id as "taskId", event_type as "eventType", payload,
          available_at as "availableAt", claimed_at as "claimedAt", claimed_by as "claimedBy",
          attempt_count as "attemptCount"
        from execution_task_outbox
        where (status = 'pending' or (status = 'claimed' and claim_expires_at <= ${new Date(now)}))
          and available_at <= ${new Date(now)}
        order by available_at, id for update skip locked limit ${limit}`
      const claimed: OutboxRow[] = []
      for (const row of rows) {
        const updated = await tx<OutboxRow[]>`
          update execution_task_outbox
          set status = 'claimed', claimed_at = ${new Date(now)}, claimed_by = ${owner},
            claim_expires_at = ${new Date(now + (options.outboxLeaseMs ?? 30_000))}, attempt_count = attempt_count + 1
          where id = ${row.id}
            and (status = 'pending' or (status = 'claimed' and claim_expires_at <= ${new Date(now)}))
          returning id, task_id as "taskId", event_type as "eventType", payload,
            available_at as "availableAt", claimed_at as "claimedAt", claimed_by as "claimedBy",
            attempt_count as "attemptCount"`
        const current = updated[0]
        if (current !== undefined) claimed.push(current)
      }
      return toMessages(claimed)
    }),
  acknowledge: async ({ outboxId, owner, claimAttempt, now }) => {
    await db`
      update execution_task_outbox set status = 'delivered', delivered_at = now()
       where id = ${outboxId} and status = 'claimed' and claimed_by = ${owner}
         and attempt_count = ${claimAttempt} and claim_expires_at > ${new Date(now)}`
  },
  fail: async ({ outboxId, owner, claimAttempt, now }, availableAt) => {
    await db`
      update execution_task_outbox
      set status = case when attempt_count >= 10 then 'dead_letter' else 'pending' end,
        available_at = ${new Date(availableAt)}, last_error = 'delivery_failed',
        dead_lettered_at = case when attempt_count >= 10 then now() else null end
       where id = ${outboxId} and status = 'claimed' and claimed_by = ${owner}
         and attempt_count = ${claimAttempt} and claim_expires_at > ${new Date(now)}`
  },
  recoverStale: async (now, limit) =>
    db.begin(async (tx) => {
      const rows = await tx<
        {
          readonly id: string
          readonly taskId: string
          readonly stepId: string | null
          readonly workerId: string
          readonly claimExpiresAt: Date
          readonly heartbeatAt: Date
        }[]
      >`
      update execution_task_run
      set status = 'recovered', recovery_reason = 'lease_expired', finished_at = ${new Date(now)}
      where id in (
        select id from execution_task_run
        where status in ('claimed', 'running') and claim_expires_at <= ${new Date(now)}
          and task_id in (select id from execution_task where executor_key <> 'box-agent')
        order by claim_expires_at for update skip locked limit ${limit}
      )
      returning id, task_id as "taskId", step_id as "stepId", worker_id as "workerId",
        claim_expires_at as "claimExpiresAt", heartbeat_at as "heartbeatAt"`
      const actor = options.systemActor
      if (actor === undefined) throw new Error("Worker system actor is required for recovery audit")
      for (const row of rows) {
        const tasks = await tx<
          {
            readonly groupId: string
            readonly status: TaskState
            readonly retryCount: number
            readonly maxAttempts: number
          }[]
        >`select group_id as "groupId", status, retry_count as "retryCount", max_attempts as "maxAttempts"
         from execution_task where id = ${row.taskId} for update`
        const task = tasks[0]
        if (task === undefined) continue
        const ambiguous = await tx`select id from execution_task_step where task_id = ${row.taskId}
          and submit_started_at is not null and status in ('pending', 'claimed', 'running') limit 1`
        if (
          ambiguous.length > 0 &&
          !(await confirmProviderStep(tx, row.taskId, options.getResult))
        ) {
          await quarantineTask(tx, { taskId: row.taskId, runId: row.id, now }, actor)
          continue
        }
        if (
          task.status !== "dispatching" &&
          task.status !== "running" &&
          task.status !== "cancel_requested"
        )
          continue
        const stepRows =
          row.stepId === null
            ? []
            : await tx<{ readonly status: PersistedStepState; readonly submitStarted: boolean }[]>`
            select status, submit_started_at is not null as "submitStarted" from execution_task_step
            where id = ${row.stepId} and task_id = ${row.taskId} for update`
        const completion = await tx<{ readonly allStepsComplete: boolean }[]>`
           select not exists (select 1 from execution_task_step where task_id = ${row.taskId}
             and status not in ('succeeded', 'skipped')) as "allStepsComplete"`
        const providerSuccessConfirmed =
          task.status === "cancel_requested" &&
          (await canPersistTaskTransition(tx, row.taskId, { from: task.status, to: "succeeded" }))
        const decision = decideStaleRecovery({
          taskState: task.status,
          stepState: stepRows[0] === undefined ? null : parsePersistedStepState(stepRows[0].status),
          retryCount: task.retryCount,
          maxAttempts: task.maxAttempts,
          allStepsComplete: completion[0]?.allStepsComplete ?? false,
          providerSuccessConfirmed,
          submitStarted: stepRows[0]?.submitStarted ?? false,
        })
        const nextStatus = decision.nextState
        if (nextStatus === "needs_reconciliation") {
          await quarantineTask(tx, { taskId: row.taskId, runId: row.id, now }, actor)
          continue
        }
        if (
          nextStatus === "succeeded" &&
          (await terminalProjection(tx, row.taskId, nextStatus)) === null
        ) {
          await quarantineTask(
            tx,
            { taskId: row.taskId, runId: row.id, now, reason: "projection_unconfirmed" },
            actor,
          )
          continue
        }
        const retryAt =
          nextStatus === "retry_waiting"
            ? retryDeadline(
                now,
                task.retryCount + 1,
                options.minimumRetryDelayMs ?? 1_000,
                options.retryPolicy,
                options.random,
              )
            : null
        transitionTask(
          task.status,
          nextStatus,
          providerSuccessConfirmed
            ? { reason: "provider_success", allStepsComplete: true }
            : undefined,
        )
        const updated = await tx`update execution_task set status = ${nextStatus},
         retry_count = case when ${decision.reason} = 'lease_expired' then retry_count + 1 else retry_count end,
          next_retry_at = ${retryAt === null ? null : new Date(retryAt)},
          last_retry_at = case when ${nextStatus} = 'retry_waiting' then ${new Date(now)} else last_retry_at end,
         finished_at = case when ${nextStatus} = 'retry_waiting' then null else ${new Date(now)} end,
         terminal_reason = case when ${nextStatus} = 'retry_waiting' then null else ${decision.reason} end,
         updated_at = ${new Date(now)} where id = ${row.taskId} and status = ${task.status}
          and status in ('dispatching', 'running', 'cancel_requested') returning id`
        if (updated.length === 0) continue
        await tx`update execution_task_device_lease set released_at = ${new Date(now)},
          recovery_reason = 'lease_expired' where task_id = ${row.taskId} and released_at is null`
        if (row.stepId !== null) {
          await tx`update execution_task_step set
             status = case when ${nextStatus} = 'retry_waiting' then 'pending'
               when ${nextStatus} = 'cancelled' then 'cancelled' else 'failed' end,
             result = null, error_code = ${decision.reason}, error_message = 'Run lease expired',
             started_at = case when ${nextStatus} = 'retry_waiting' then null else started_at end,
             finished_at = case when ${nextStatus} = 'retry_waiting' then null else ${new Date(now)} end
            where id = ${row.stepId} and task_id = ${row.taskId}
              and status in ('claimed', 'running')`
        }
        if (nextStatus !== "retry_waiting") {
          const projection = await terminalProjection(tx, row.taskId, nextStatus)
          await tx`update execution_task set result = ${projection?.result === undefined || projection.result === null ? null : tx.json(projection.result)},
            error_code = ${projection?.errorCode ?? null}, error_message = ${projection?.errorMessage ?? null}
            where id = ${row.taskId} and status = ${nextStatus}`
        }
        await appendTransition(
          tx,
          row.taskId,
          task.groupId,
          task.status,
          nextStatus,
          actor,
          now,
          "recovery",
          decision.reason,
          retryAt ?? now,
        )
        await tx`insert into audit_event (id, actor_id, action, outcome, target, metadata)
        values (${crypto.randomUUID()}, ${actor.actorId}, 'execution.task.recover', 'allowed',
           ${`execution-task:${row.taskId}`}, ${tx.json({ taskId: row.taskId, nextStatus, reason: decision.reason, requestId: actor.requestId })})`
      }
      await tx`update execution_task_device_lease lease set released_at = ${new Date(now)},
        recovery_reason = 'terminal_confirmed' where released_at is null and expires_at <= ${new Date(now)}
        and exists (select 1 from execution_task task where task.id = lease.task_id
          and task.status in ('succeeded','failed','cancelled','timed_out'))
        and not exists (select 1 from execution_task_step step where step.task_id = lease.task_id
          and step.submit_started_at is not null and step.status in ('pending','claimed','running'))`
      return rows.map(
        (row): ExecutionLease => ({
          leaseId: row.id,
          taskId: row.taskId,
          stepId: row.stepId,
          owner: row.workerId,
          expiresAt: row.claimExpiresAt.getTime(),
          heartbeatAt: row.heartbeatAt.getTime(),
        }),
      )
    }),
  checkReadiness: async () => {
    await db`select 1`
    const actor = options.systemActor
    if (actor === undefined) throw new Error("Worker system actor is required for readiness")
    await checkSystemActorReadiness(db, actor.actorId)
  },
})
