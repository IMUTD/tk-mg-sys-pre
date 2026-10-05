import type { Sql } from "postgres"
import { transitionTask } from "./lifecycle"
import type { SystemActorMetadata, TaskState } from "./models"
import { appendSafetyTransition } from "./provider-boundary"

export type Reconciliation = {
  readonly taskId: string
  readonly groupId: string
  readonly resolution: "succeeded" | "failed" | "cancelled"
  readonly evidenceHash: string
  readonly actor: SystemActorMetadata
  readonly now: number
}
export type ReconciliationOutcome = "resolved" | "duplicate" | "conflict" | "not_found"

export const reconcileTask = async (
  db: Sql,
  input: Reconciliation,
): Promise<ReconciliationOutcome> =>
  db.begin(async (tx) => {
    const devices = await tx`select device.id from device join execution_task task
    on task.device_id = device.id and task.group_id = device.group_id
    where task.id = ${input.taskId} and task.group_id = ${input.groupId} for update of device`
    if (devices.length === 0) return "not_found"
    const runs = await tx<
      { readonly id: string; readonly stepId: string | null; readonly reason: string | null }[]
    >`
    select id, step_id as "stepId", recovery_reason as reason from execution_task_run where task_id = ${input.taskId}
      and status = 'needs_reconciliation' for update`
    const tasks = await tx<{ readonly status: TaskState; readonly reason: string | null }[]>`
    select status, terminal_reason as reason from execution_task
    where id = ${input.taskId} and group_id = ${input.groupId} for update`
    const task = tasks[0]
    if (task === undefined) return "not_found"
    if (task.status !== "needs_reconciliation")
      return task.status === input.resolution && task.reason === "operator_verified"
        ? "duplicate"
        : "conflict"
    const run = runs[0]
    if (runs.length !== 1 || run === undefined || run.stepId === null) return "conflict"
    const steps = await tx<
      { readonly id: string; readonly status: string; readonly marked: boolean }[]
    >`
    select id, status, submit_started_at is not null as marked from execution_task_step
    where task_id = ${input.taskId} order by sequence for update`
    const unresolved = steps.filter(
      (step) => step.marked && (step.status === "claimed" || step.status === "running"),
    )
    const step = unresolved[0]
    const completedProjection =
      task.reason === "projection_unconfirmed" &&
      run.reason === "projection_unconfirmed" &&
      unresolved.length === 0 &&
      steps.length > 0 &&
      steps.every((item) => item.status === "succeeded" || item.status === "skipped") &&
      steps.some((item) => item.id === run.stepId && item.status === "succeeded")
    if (completedProjection) {
      if (input.resolution === "succeeded") return "conflict"
    } else {
      if (task.reason === "projection_unconfirmed") return "conflict"
      if (unresolved.length !== 1 || step === undefined || step.id !== run.stepId) return "conflict"
      if (
        input.resolution === "succeeded" &&
        (steps.at(-1)?.id !== step.id ||
          steps
            .slice(0, -1)
            .some((prior) => prior.status !== "succeeded" && prior.status !== "skipped"))
      )
        return "conflict"
    }
    transitionTask(task.status, input.resolution, { reason: "operator_reconciliation" })
    if (!completedProjection && step !== undefined)
      await tx`update execution_task_step set status = ${input.resolution}, result = null,
      error_code = 'operator_verified', error_message = null, finished_at = ${new Date(input.now)}
      where id = ${step.id}`
    await tx`update execution_task_run set status = ${input.resolution}, recovery_reason = 'operator_verified',
    finished_at = ${new Date(input.now)} where id = ${run.id}`
    await tx`update execution_task set status = ${input.resolution}, result = null, next_retry_at = null,
    terminal_reason = 'operator_verified', error_code = null, error_message = null,
    finished_at = ${new Date(input.now)}, updated_at = ${new Date(input.now)} where id = ${input.taskId}`
    await tx`update execution_task_device_lease set released_at = ${new Date(input.now)},
    recovery_reason = 'operator_verified' where task_id = ${input.taskId} and released_at is null`
    await appendSafetyTransition(tx, {
      taskId: input.taskId,
      groupId: input.groupId,
      from: task.status,
      to: input.resolution,
      reason: "operator_verified",
      action: "execution.task.reconcile",
      actor: input.actor,
      now: input.now,
      evidenceHash: input.evidenceHash,
    })
    return "resolved"
  })
