import { DeviceTargetSchema } from "@tk-mg/device-adapter"
import {
  type AuditEntry,
  canPersistTaskTransition,
  canTransitionTask,
  DEFAULT_RETRY_POLICY,
  type DeviceLeaseInput,
  decideStaleRecovery,
  EXECUTION_LIMITS,
  type ExecutionLease,
  type ExecutionTaskRepository,
  type OutboxMessage,
  type PersistedStepState,
  parseExecutableCommand,
  parsePersistedStepState,
  parsePersistedTaskState,
  quarantineTask,
  type RetryPolicy,
  reconcileTask,
  rejectInvalidPersistedTask,
  retryDeadline,
  type SystemActorMetadata,
  type TaskClaim,
  TaskIdempotencyConflictError,
  type TaskRecord,
  type TaskState,
  type TaskStepRecord,
  type TaskSubmission,
  terminalProjection,
  transitionTask,
} from "@tk-mg/task-execution"
import type { Sql, TransactionSql } from "postgres"

type Query = Sql | TransactionSql
type JsonObject = Readonly<Record<string, unknown>>
type OutboxRow = {
  readonly id: string
  readonly taskId: string
  readonly eventType: string
  readonly payload: JsonObject
  readonly availableAt: Date
  readonly claimedAt: Date | null
  readonly claimedBy: string | null
  readonly attemptCount: number
}
type TaskRow = {
  readonly id: string
  readonly groupId: string
  readonly requesterId: string
  readonly deviceId: string
  readonly fingerprint: string
  readonly name: string
  readonly executorKey: string
  readonly parameters: unknown
  readonly status: TaskState
  readonly retryCount: number
  readonly maxAttempts: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

const taskColumns = (db: Query) => db`
  id, group_id as "groupId", requester_id as "requesterId", device_id as "deviceId",
  fingerprint, name, executor_key as "executorKey", parameters, status,
  retry_count as "retryCount", max_attempts as "maxAttempts", created_at as "createdAt",
  updated_at as "updatedAt"
`

const audit = async (db: TransactionSql, entry: AuditEntry): Promise<void> => {
  await db`insert into audit_event (id, actor_id, action, outcome, target, metadata)
    values (${crypto.randomUUID()}, ${entry.actor.actorId},
      ${entry.eventType}, 'allowed', ${`execution-task:${entry.taskId}`},
      ${db.json({
        ...entry.metadata,
        taskId: entry.taskId,
        stepId: entry.stepId ?? null,
        requestId: entry.actor.requestId,
        actorType: entry.actor.actorType,
      })})`
}

const appendTransition = async (
  db: TransactionSql,
  taskId: string,
  groupId: string,
  fromStatus: string | null,
  toStatus: string,
  source: string,
  actor: SystemActorMetadata,
  reason: string,
  now: number,
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

const readSteps = async (db: Query, taskId: string): Promise<readonly TaskStepRecord[]> => {
  const rows = await db<
    {
      readonly id: string
      readonly taskId: string
      readonly sequence: number
      readonly commandId: string
      readonly commandIdempotencyKey: string
      readonly kind: string
      readonly target: unknown
      readonly parameters: JsonObject
      readonly status: string
    }[]
  >`select id, task_id as "taskId", sequence, command_id as "commandId",
    command_idempotency_key as "commandIdempotencyKey", kind, target, parameters, status
    from execution_task_step where task_id = ${taskId} order by sequence asc`
  return rows.map((row) => {
    const command = parseExecutableCommand({
      ...row.parameters,
      commandId: row.commandId,
      idempotencyKey: row.commandIdempotencyKey,
      target: DeviceTargetSchema.parse(row.target),
      type: row.kind,
    })
    return {
      stepId: row.id,
      taskId: row.taskId,
      ordinal: row.sequence,
      command,
      state: parsePersistedStepState(row.status),
      attempt: 0,
    }
  })
}

const toTask = async (db: Query, row: TaskRow, actor: SystemActorMetadata): Promise<TaskRecord> => {
  const steps = await readSteps(db, row.id)
  return {
    taskId: row.id,
    groupId: row.groupId,
    target: steps[0]?.command.target ?? DeviceTargetSchema.parse({ deviceId: row.deviceId }),
    state: parsePersistedTaskState(row.status),
    attempt: row.retryCount,
    maxAttempts: row.maxAttempts,
    steps,
    actor,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

const outboxRows = (rows: readonly OutboxRow[]): readonly OutboxMessage[] =>
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

export const createPostgresExecutionTaskRepository = (
  db: Sql,
  systemActor: SystemActorMetadata,
  retryOptions: {
    readonly minimumDelayMs?: number
    readonly policy?: RetryPolicy
    readonly random?: () => number
  } = {},
): ExecutionTaskRepository => ({
  reconcile: (input) => reconcileTask(db, input),
  submit: async (input: TaskSubmission, actor: SystemActorMetadata) =>
    db.begin(async (tx) => {
      const inserted = await tx<TaskRow[]>`insert into execution_task
      (id, group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters, max_attempts)
      values (${input.taskId}, ${input.groupId}, ${input.requesterId}, ${input.deviceId}, ${input.idempotencyKey},
        ${input.fingerprint}, ${input.name}, ${input.executorKey}, ${JSON.stringify(input.parameters)}::text::jsonb, ${input.maxAttempts})
      on conflict (group_id, idempotency_key) do nothing returning ${taskColumns(tx)}`
      const row = inserted[0]
      if (row === undefined) {
        const existing = await tx<TaskRow[]>`select ${taskColumns(tx)} from execution_task
        where group_id = ${input.groupId} and idempotency_key = ${input.idempotencyKey}`
        const previous = existing[0]
        if (previous === undefined || previous.fingerprint !== input.fingerprint) {
          throw new TaskIdempotencyConflictError()
        }
        return { task: await toTask(tx, previous, actor), created: false }
      }
      for (const step of input.steps) {
        await tx`insert into execution_task_step
        (id, task_id, group_id, sequence, command_id, command_idempotency_key, fingerprint, kind, target, parameters)
        values (${step.stepId}, ${input.taskId}, ${input.groupId}, ${step.sequence}, ${step.command.commandId},
          ${step.command.idempotencyKey}, ${step.fingerprint}, ${step.command.type},
          ${tx.json(step.command.target)}, ${tx.json(step.command)})`
      }
      const eventId = crypto.randomUUID()
      await tx`insert into execution_task_event (id, task_id, group_id, to_status, source, actor_id)
      values (${eventId}, ${input.taskId}, ${input.groupId}, 'queued', 'submit',
        ${actor.actorType === "system" ? null : actor.actorId})`
      await tx`insert into execution_task_outbox
      (event_id, task_id, group_id, event_type, payload)
      values (${eventId}, ${input.taskId}, ${input.groupId}, 'execution_task.queued',
        ${tx.json({ taskId: input.taskId, groupId: input.groupId, status: "queued" })})`
      await audit(tx, {
        taskId: input.taskId,
        eventType: "execution.task.submit",
        actor,
        metadata: { fingerprint: input.fingerprint },
        occurredAt: Date.now(),
      })
      return { task: await toTask(tx, row, actor), created: true }
    }),
  get: async (groupId, taskId) => {
    const rows = await db<
      TaskRow[]
    >`select ${taskColumns(db)} from execution_task where id = ${taskId} and group_id = ${groupId}`
    const row = rows[0]
    return row === undefined
      ? null
      : toTask(db, row, { actorId: "system", actorType: "system", requestId: "repository" })
  },
  list: async (groupId, page, pageSize) => {
    const offset = (page - 1) * pageSize
    const rows = await db<TaskRow[]>`select ${taskColumns(db)} from execution_task
      where group_id = ${groupId} order by created_at desc, id desc limit ${pageSize} offset ${offset}`
    const counts = await db<{ readonly total: number }[]>`select count(*)::integer as total
      from execution_task where group_id = ${groupId}`
    return {
      items: await Promise.all(
        rows.map((row) =>
          toTask(db, row, {
            actorId: "system",
            actorType: "system",
            requestId: "repository",
          }),
        ),
      ),
      total: counts[0]?.total ?? 0,
      page,
      pageSize,
    }
  },
  claimTask: async (owner, now, leaseMs) =>
    db.begin(async (tx) => {
      const rows = await tx<TaskRow[]>`select ${taskColumns(tx)} from execution_task
       where status = 'queued' or (status = 'retry_waiting' and next_retry_at <= ${new Date(now)})
      order by created_at, id for update skip locked limit 1`
      const row = rows[0]
      if (row === undefined) return null
      if (await rejectInvalidPersistedTask(tx, row, { actor: systemActor, now })) return null
      if (!canTransitionTask(row.status, "dispatching")) return null
      const runId = crypto.randomUUID()
      const token = crypto.randomUUID()
      const expires = new Date(now + leaseMs)
      const updated = await tx<
        TaskRow[]
      >`update execution_task set status = 'dispatching', started_at = coalesce(started_at, ${new Date(now)}), updated_at = ${new Date(now)}
      where id = ${row.id} and status = ${row.status} returning ${taskColumns(tx)}`
      const current = updated[0]
      if (current === undefined) return null
      await tx`insert into execution_task_run (id, task_id, group_id, attempt, worker_id, claim_token, claim_expires_at, heartbeat_at, started_at)
      values (${runId}, ${row.id}, ${row.groupId}, ${row.retryCount + 1}, ${owner}, ${token}, ${expires}, ${new Date(now)}, ${new Date(now)})`
      await appendTransition(
        tx,
        row.id,
        row.groupId,
        row.status,
        "dispatching",
        "claim",
        systemActor,
        "claimed",
        now,
      )
      await audit(tx, {
        taskId: row.id,
        eventType: "execution.task.claim",
        actor: systemActor,
        metadata: { owner },
        occurredAt: now,
      })
      return {
        ...(await toTask(tx, current, {
          actorId: "system",
          actorType: "system",
          requestId: "claim",
        })),
        runId,
        claimToken: token,
        leaseExpiresAt: expires.getTime(),
      } satisfies TaskClaim
    }),
  renewTask: async (taskId, runId, claimToken, now, leaseMs) => {
    const rows =
      await db`update execution_task_run set heartbeat_at = ${new Date(now)}, claim_expires_at = ${new Date(now + leaseMs)}
      where id = ${runId} and task_id = ${taskId} and claim_token = ${claimToken}
        and status in ('claimed', 'running') and claim_expires_at > ${new Date(now)} returning id`
    return rows.length === 1
  },
  finishOwned: async (taskId, runId, claimToken, expectedState, nextState, now, nextRetryAt) =>
    db.begin(async (tx) => {
      const owned = await tx`select id from execution_task_run
        where id = ${runId} and task_id = ${taskId} and claim_token = ${claimToken}
          and status in ('claimed', 'running') and claim_expires_at > ${new Date(now)} for update`
      if (owned.length === 0) return false
      const currentRows = await tx<
        { readonly groupId: string; readonly retryCount: number; readonly maxAttempts: number }[]
      >`select group_id as "groupId", retry_count as "retryCount", max_attempts as "maxAttempts"
          from execution_task where id = ${taskId} and status = ${expectedState} for update`
      const current = currentRows[0]
      if (current === undefined) return false
      if (nextState === "retry_waiting") {
        const marked = await tx`select id from execution_task_step where task_id = ${taskId}
          and submit_started_at is not null and status not in ('succeeded', 'skipped') limit 1`
        if (marked.length > 0) return false
      }
      const exhausted =
        nextState === "retry_waiting" && current.retryCount + 1 >= current.maxAttempts
      const resolvedState = exhausted ? "failed" : nextState
      const retryAt =
        resolvedState === "retry_waiting"
          ? (nextRetryAt ??
            retryDeadline(
              now,
              current.retryCount + 1,
              retryOptions.minimumDelayMs ?? 1_000,
              retryOptions.policy,
              retryOptions.random,
            ))
          : null
      const minimum = Math.min(
        EXECUTION_LIMITS.maxBackoffMs.maximum,
        Math.max(
          retryOptions.minimumDelayMs ?? 1_000,
          retryOptions.policy?.baseBackoffMs ?? DEFAULT_RETRY_POLICY.baseBackoffMs,
        ),
      )
      if (
        retryAt !== null &&
        (retryAt < now + minimum || retryAt > now + EXECUTION_LIMITS.maxBackoffMs.maximum)
      )
        return false
      if (!(await canPersistTaskTransition(tx, taskId, { from: expectedState, to: resolvedState })))
        return false
      if (exhausted) {
        await tx`update execution_task_step set status = 'failed', error_code = 'retry_exhausted',
          finished_at = ${new Date(now)} where task_id = ${taskId}
            and id = (select step_id from execution_task_run where id = ${runId})
            and status in ('pending', 'claimed', 'running')`
      }
      const projection =
        resolvedState === "retry_waiting"
          ? null
          : await terminalProjection(tx, taskId, resolvedState)
      if (resolvedState === "succeeded" && projection === null) return false
      const tasks = await tx<
        { readonly groupId: string }[]
      >`update execution_task set status = ${resolvedState},
            finished_at = ${retryAt === null ? new Date(now) : null},
            retry_count = case when ${nextState} = 'retry_waiting' then retry_count + 1 else retry_count end,
            next_retry_at = ${retryAt === null ? null : new Date(retryAt)},
            last_retry_at = case when ${nextState} = 'retry_waiting' then ${new Date(now)} else last_retry_at end,
            terminal_reason = case when ${resolvedState} = 'retry_waiting' then null
              when ${exhausted} then 'retry_exhausted' else ${resolvedState} end,
            result = ${projection?.result === undefined || projection.result === null ? null : tx.json(projection.result)},
            error_code = ${projection?.errorCode ?? null}, error_message = ${projection?.errorMessage ?? null},
            updated_at = ${new Date(now)}
         where id = ${taskId} and status = ${expectedState}
           and (${resolvedState} <> 'succeeded' or not exists (select 1 from execution_task_step
             where task_id = ${taskId} and status not in ('succeeded', 'skipped')))
         returning group_id as "groupId"`
      const task = tasks[0]
      if (task === undefined) return false
      await tx`update execution_task_run set status = ${nextState === "retry_waiting" ? "failed" : resolvedState}, finished_at = ${new Date(now)} where id = ${runId}`
      await appendTransition(
        tx,
        taskId,
        task.groupId,
        expectedState,
        resolvedState,
        "finish",
        systemActor,
        "finished",
        now,
        retryAt ?? now,
      )
      await audit(tx, {
        taskId,
        eventType: "execution.task.finish",
        actor: systemActor,
        metadata: { nextState: resolvedState },
        occurredAt: now,
      })
      return true
    }),
  requestCancel: async (groupId, taskId, actor, now) =>
    db.begin(async (tx) => {
      const rows = await tx<
        { readonly id: string; readonly groupId: string; readonly status: string }[]
      >`select id, group_id as "groupId", status from execution_task
        where id = ${taskId} and group_id = ${groupId} and status in ('queued', 'dispatching', 'running', 'retry_waiting') for update`
      const row = rows[0]
      if (row === undefined) return false
      const currentState = parsePersistedTaskState(row.status)
      const nextStatus =
        currentState === "queued" || currentState === "retry_waiting"
          ? "cancelled"
          : "cancel_requested"
      if (!canTransitionTask(currentState, nextStatus)) return false
      await tx`update execution_task set status = ${nextStatus}, cancel_requested_at = ${new Date(now)},
        finished_at = case when ${nextStatus} = 'cancelled' then ${new Date(now)} else finished_at end,
        terminal_reason = case when ${nextStatus} = 'cancelled' then 'cancel_requested' else terminal_reason end,
        result = null,
        error_code = case when ${nextStatus} = 'cancelled' then 'cancelled' else error_code end,
        error_message = case when ${nextStatus} = 'cancelled' then 'Device command error (cancelled)' else error_message end,
        updated_at = ${new Date(now)} where id = ${taskId} and status = ${row.status}`
      await appendTransition(
        tx,
        taskId,
        row.groupId,
        currentState,
        nextStatus,
        "cancel",
        actor,
        "cancel_requested",
        now,
      )
      await audit(tx, {
        taskId,
        eventType: "execution.task.cancel",
        actor,
        metadata: {},
        occurredAt: now,
      })
      return true
    }),
  claimNext: async (taskId, runId, owner, claimToken, now) =>
    db.begin(async (tx) => {
      const runs = await tx<
        { readonly groupId: string }[]
      >`select group_id as "groupId" from execution_task_run
        where id = ${runId} and task_id = ${taskId} and worker_id = ${owner} and claim_token = ${claimToken}
          and status in ('claimed', 'running') and claim_expires_at > ${new Date(now)} for update`
      if (runs[0] === undefined) return null
      const active = await tx`select id from execution_task where id = ${taskId}
        and status in ('dispatching', 'running') for update`
      if (active.length === 0) return null
      const rows = await tx<
        {
          readonly id: string
          readonly taskId: string
          readonly sequence: number
          readonly commandId: string
          readonly commandIdempotencyKey: string
          readonly kind: string
          readonly target: unknown
          readonly parameters: JsonObject
          readonly status: string
        }[]
      >`select step.id, step.task_id as "taskId", step.sequence, step.command_id as "commandId", step.command_idempotency_key as "commandIdempotencyKey", step.kind, step.target, step.parameters, step.status from execution_task_step step
      where step.task_id = ${taskId} and step.status = 'pending'
        and not exists (select 1 from execution_task_step prior where prior.task_id = step.task_id
          and prior.sequence < step.sequence and prior.status not in ('succeeded', 'skipped'))
        order by step.sequence for update of step skip locked limit 1`
      const row = rows[0]
      if (row === undefined) return null
      const updated =
        await tx`update execution_task_step set status = 'claimed', started_at = ${new Date(now)}
       where id = ${row.id} and status = 'pending' returning id`
      if (updated.length === 0) return null
      const linked = await tx`update execution_task_run set status = 'running', step_id = ${row.id}
         where id = ${runId} and task_id = ${taskId} and worker_id = ${owner}
           and claim_token = ${claimToken} and status in ('claimed', 'running')
           and claim_expires_at > ${new Date(now)} returning id`
      if (linked.length !== 1) throw new Error("Run ownership changed during step claim")
      const task = await tx<{ readonly status: TaskState; readonly groupId: string }[]>`
         select status, group_id as "groupId" from execution_task where id = ${taskId} for update`
      const currentTask = task[0]
      if (currentTask?.status === "dispatching") {
        if (!canTransitionTask(currentTask.status, "running")) return null
        await tx`update execution_task set status = 'running', updated_at = ${new Date(now)}
           where id = ${taskId} and status = 'dispatching'`
        await appendTransition(
          tx,
          taskId,
          currentTask.groupId,
          currentTask.status,
          "running",
          "claim",
          systemActor,
          "step_claimed",
          now,
        )
        await audit(tx, {
          taskId,
          eventType: "execution.task.running",
          actor: systemActor,
          metadata: {},
          occurredAt: now,
        })
      }
      const command = parseExecutableCommand({
        ...row.parameters,
        commandId: row.commandId,
        idempotencyKey: row.commandIdempotencyKey,
        target: DeviceTargetSchema.parse(row.target),
        type: row.kind,
      })
      return {
        stepId: row.id,
        taskId: row.taskId,
        ordinal: row.sequence,
        command,
        state: "claimed",
        attempt: 0,
      }
    }),
  claimAvailable: async (owner, now, limit) =>
    db.begin(async (tx) => {
      const rows = await tx<
        OutboxRow[]
      >`select id, task_id as "taskId", event_type as "eventType", payload, available_at as "availableAt", claimed_at as "claimedAt", claimed_by as "claimedBy", attempt_count as "attemptCount" from execution_task_outbox
      where (status = 'pending' or (status = 'claimed' and claim_expires_at <= ${new Date(now)}))
        and available_at <= ${new Date(now)} order by available_at, id for update skip locked limit ${limit}`
      const claimed: OutboxRow[] = []
      for (const row of rows) {
        const updated = await tx<
          OutboxRow[]
        >`update execution_task_outbox set status = 'claimed', claimed_at = ${new Date(now)}, claimed_by = ${owner}, claim_expires_at = ${new Date(now + 30_000)}, attempt_count = attempt_count + 1 where id = ${row.id} and (status = 'pending' or (status = 'claimed' and claim_expires_at <= ${new Date(now)})) returning id, task_id as "taskId", event_type as "eventType", payload, available_at as "availableAt", claimed_at as "claimedAt", claimed_by as "claimedBy", attempt_count as "attemptCount"`
        if (updated[0] !== undefined) claimed.push(updated[0])
      }
      return outboxRows(claimed)
    }),
  acknowledge: async ({ outboxId, owner, claimAttempt, now }) => {
    await db`update execution_task_outbox set status = 'delivered', delivered_at = now() where id = ${outboxId} and status = 'claimed' and claimed_by = ${owner} and attempt_count = ${claimAttempt} and claim_expires_at > ${new Date(now)}`
  },
  fail: async ({ outboxId, owner, claimAttempt, now }, availableAt) => {
    await db`update execution_task_outbox set status = case when attempt_count >= 10 then 'dead_letter' else 'pending' end, available_at = ${new Date(availableAt)}, last_error = 'delivery_failed', dead_lettered_at = case when attempt_count >= 10 then now() else null end where id = ${outboxId} and status = 'claimed' and claimed_by = ${owner} and attempt_count = ${claimAttempt} and claim_expires_at > ${new Date(now)}`
  },
  renew: async (leaseId, owner, expiresAt, heartbeatAt) =>
    (
      await db`update execution_task_run set claim_expires_at = ${new Date(expiresAt)}, heartbeat_at = ${new Date(heartbeatAt)} where id = ${leaseId} and worker_id = ${owner} and status in ('claimed', 'running') and claim_expires_at > now()`
    ).count === 1,
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
      >`update execution_task_run set status = 'recovered', recovery_reason = 'lease_expired', finished_at = ${new Date(now)} where id in (select id from execution_task_run where status in ('claimed','running') and claim_expires_at <= ${new Date(now)} order by claim_expires_at for update skip locked limit ${limit}) returning id, task_id as "taskId", step_id as "stepId", worker_id as "workerId", claim_expires_at as "claimExpiresAt", heartbeat_at as "heartbeatAt"`
      for (const row of rows) {
        const tasks = await tx<
          {
            readonly groupId: string
            readonly status: string
            readonly retryCount: number
            readonly maxAttempts: number
          }[]
        >`select group_id as "groupId", status, retry_count as "retryCount", max_attempts as "maxAttempts" from execution_task where id = ${row.taskId} for update`
        const task = tasks[0]
        if (task === undefined) continue
        const ambiguous = await tx`select id from execution_task_step where task_id = ${row.taskId}
          and submit_started_at is not null and status in ('pending', 'claimed', 'running') limit 1`
        if (ambiguous.length > 0) {
          await quarantineTask(tx, { taskId: row.taskId, runId: row.id, now }, systemActor)
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
          await quarantineTask(tx, { taskId: row.taskId, runId: row.id, now }, systemActor)
          continue
        }
        if (
          nextStatus === "succeeded" &&
          (await terminalProjection(tx, row.taskId, nextStatus)) === null
        ) {
          await quarantineTask(
            tx,
            { taskId: row.taskId, runId: row.id, now, reason: "projection_unconfirmed" },
            systemActor,
          )
          continue
        }
        transitionTask(
          task.status,
          nextStatus,
          providerSuccessConfirmed
            ? { reason: "provider_success", allStepsComplete: true }
            : undefined,
        )
        const terminal = nextStatus !== "retry_waiting"
        const retryAt = terminal
          ? null
          : retryDeadline(
              now,
              task.retryCount + 1,
              retryOptions.minimumDelayMs ?? 1_000,
              retryOptions.policy,
              retryOptions.random,
            )
        const updated = await tx`update execution_task set status = ${nextStatus},
        retry_count = case when ${decision.reason} = 'lease_expired' then retry_count + 1 else retry_count end,
        next_retry_at = ${retryAt === null ? null : new Date(retryAt)},
        last_retry_at = case when ${terminal} then last_retry_at else ${new Date(now)} end,
        finished_at = case when ${terminal} then ${new Date(now)} else null end,
        terminal_reason = case when ${terminal} then ${decision.reason} else null end,
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
            started_at = case when ${terminal} then started_at else null end,
            finished_at = case when ${terminal} then ${new Date(now)} else null end
            where id = ${row.stepId} and task_id = ${row.taskId}
              and status in ('claimed', 'running')`
        }
        if (terminal) {
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
          "recovery",
          systemActor,
          decision.reason,
          now,
          retryAt ?? now,
        )
        await audit(tx, {
          taskId: row.taskId,
          eventType: "execution.task.recover",
          actor: systemActor,
          metadata: { nextStatus, reason: decision.reason },
          occurredAt: now,
        })
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
  acquireDeviceLease: async (input: DeviceLeaseInput) => {
    return db.begin(async (tx) => {
      await tx`select id from device where id = ${input.deviceId} and group_id = ${input.groupId} for update`
      const commands = await tx<{ readonly id: string }[]>`select id from device_command
        where group_id = ${input.groupId} and device_id = ${input.deviceId}
          and (${input.instanceId ?? null}::uuid is null or instance_id is null
            or instance_id = ${input.instanceId ?? null}::uuid)
          and status in ('queued', 'running') for key share limit 1`
      if (commands[0] !== undefined) return false
      const leases = await tx`select id from execution_task_device_lease
        where group_id = ${input.groupId} and device_id = ${input.deviceId}
          and released_at is null and (${input.instanceId ?? null}::uuid is null
            or instance_id is null or instance_id = ${input.instanceId ?? null}::uuid)
        limit 1`
      if (leases.length > 0) return false
      const rows =
        await tx`insert into execution_task_device_lease (id, task_id, group_id, device_id, instance_id, lease_token, worker_id, expires_at, heartbeat_at)
        values (${input.leaseId}, ${input.taskId}, ${input.groupId}, ${input.deviceId}, ${input.instanceId ?? null}, ${input.leaseToken}, ${input.workerId}, ${new Date(input.expiresAt)}, now()) on conflict do nothing returning id`
      return rows.length === 1
    })
  },
  renewDeviceLease: async (leaseId, leaseToken, expiresAt, heartbeatAt) =>
    (
      await db`update execution_task_device_lease set expires_at = ${new Date(expiresAt)}, heartbeat_at = ${new Date(heartbeatAt)} where id = ${leaseId} and lease_token = ${leaseToken} and released_at is null and expires_at > now()`
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
})
