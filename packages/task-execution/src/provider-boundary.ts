import type { Sql, TransactionSql } from "postgres"
import { transitionTask } from "./lifecycle"
import type { SystemActorMetadata, TaskState } from "./models"
import { canPersistTaskTransition } from "./persisted-transition"

export type SubmitBoundary = {
  readonly taskId: string
  readonly runId: string
  readonly claimToken: string
  readonly stepId: string
  readonly owner: string
  readonly leaseId: string
  readonly leaseToken: string
  readonly now: number
}

export const appendSafetyTransition = async (
  tx: TransactionSql,
  input: {
    readonly taskId: string
    readonly groupId: string
    readonly from: TaskState
    readonly to: TaskState
    readonly reason: string
    readonly action: string
    readonly actor: SystemActorMetadata
    readonly now: number
    readonly evidenceHash?: string
  },
): Promise<void> => {
  const eventId = crypto.randomUUID()
  await tx`insert into execution_task_event
    (id, task_id, group_id, from_status, to_status, source, reason, actor_id)
    values (${eventId}, ${input.taskId}, ${input.groupId}, ${input.from}, ${input.to},
      'recovery', ${input.reason}, ${input.actor.actorId})`
  await tx`insert into execution_task_outbox
    (event_id, task_id, group_id, event_type, payload, available_at)
    values (${eventId}, ${input.taskId}, ${input.groupId}, 'execution_task.status_changed',
      ${tx.json({ taskId: input.taskId, fromStatus: input.from, toStatus: input.to, reason: input.reason })},
      ${new Date(input.now)})`
  await tx`insert into audit_event (id, actor_id, action, outcome, target, metadata)
    values (${crypto.randomUUID()}, ${input.actor.actorId}, ${input.action}, 'allowed',
      ${`execution-task:${input.taskId}`}, ${tx.json({
        taskId: input.taskId,
        reason: input.reason,
        resolution: input.to,
        actorType: input.actor.actorType,
        requestId: input.actor.requestId,
        ...(input.evidenceHash === undefined ? {} : { evidenceHash: input.evidenceHash }),
      })})`
}

export const rejectInvalidPersistedTask = async (
  tx: TransactionSql,
  task: { readonly id: string; readonly groupId: string; readonly status: TaskState },
  context: { readonly actor: SystemActorMetadata; readonly now: number },
): Promise<boolean> => {
  if (task.status !== "queued" && task.status !== "retry_waiting") return false
  const invalid = await canPersistTaskTransition(tx, task.id, { from: task.status, to: "failed" })
  if (!invalid) return false
  transitionTask(task.status, "failed", { reason: "invalid_persisted_validation" })
  await tx`update execution_task set status = 'failed', terminal_reason = 'invalid_persisted_validation',
    finished_at = ${new Date(context.now)}, updated_at = ${new Date(context.now)}, next_retry_at = null
    where id = ${task.id}`
  await appendSafetyTransition(tx, {
    taskId: task.id,
    groupId: task.groupId,
    from: task.status,
    to: "failed",
    reason: "invalid_persisted_validation",
    action: "execution.task.invalid",
    ...context,
  })
  return true
}

export const markSubmitStarted = async (db: Sql, input: SubmitBoundary): Promise<boolean> =>
  db.begin(async (tx) => {
    const runs = await tx`select id from execution_task_run where id = ${input.runId}
      and task_id = ${input.taskId} and step_id = ${input.stepId} and worker_id = ${input.owner}
      and claim_token = ${input.claimToken} and status = 'running'
      and claim_expires_at > ${new Date(input.now)} for update`
    if (runs.length === 0) return false
    const tasks = await tx`select id from execution_task where id = ${input.taskId}
      and status = 'running' for update`
    if (tasks.length === 0) return false
    const leases = await tx`select id from execution_task_device_lease where id = ${input.leaseId}
      and task_id = ${input.taskId} and worker_id = ${input.owner} and lease_token = ${input.leaseToken}
      and released_at is null and expires_at > ${new Date(input.now)}
      and not exists (select 1 from execution_task_step step where step.task_id = ${input.taskId}
        and (step.target->>'deviceId' is distinct from execution_task_device_lease.device_id::text
          or step.target->>'instanceId' is distinct from execution_task_device_lease.instance_id::text))
      for update`
    if (leases.length === 0) return false
    const rows = await tx`update execution_task_step set submit_started_at = ${new Date(input.now)}
      where id = ${input.stepId} and task_id = ${input.taskId} and status = 'claimed'
        and submit_started_at is null returning id`
    if (rows.length === 0) return false
    await tx`update execution_task_device_lease set recovery_reason = 'reconciliation_required'
      where id = ${input.leaseId}`
    return true
  })

export const quarantineTask = async (
  tx: TransactionSql,
  input: {
    readonly taskId: string
    readonly runId: string
    readonly now: number
    readonly reason?: "projection_unconfirmed"
  },
  actor: SystemActorMetadata,
): Promise<boolean> => {
  const tasks = await tx<{ readonly status: TaskState; readonly groupId: string }[]>`
    select status, group_id as "groupId" from execution_task where id = ${input.taskId} for update`
  const task = tasks[0]
  if (task === undefined || task.status === "needs_reconciliation") return false
  transitionTask(task.status, "needs_reconciliation", { reason: "ambiguous_provider" })
  const reason = input.reason ?? "reconciliation_required"
  await tx`update execution_task set status = 'needs_reconciliation', next_retry_at = null,
    finished_at = null, result = null, terminal_reason = ${reason},
    updated_at = ${new Date(input.now)} where id = ${input.taskId}`
  await tx`update execution_task_run set status = 'needs_reconciliation',
    recovery_reason = ${reason}, finished_at = ${new Date(input.now)}
    where id = ${input.runId}`
  await tx`update execution_task_device_lease set recovery_reason = ${reason}
    where task_id = ${input.taskId} and released_at is null`
  await appendSafetyTransition(tx, {
    taskId: input.taskId,
    groupId: task.groupId,
    from: task.status,
    to: "needs_reconciliation",
    reason,
    action: "execution.task.quarantine",
    actor,
    now: input.now,
  })
  return true
}
