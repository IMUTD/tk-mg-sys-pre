import { DeviceCommandSchema } from "@tk-mg/device-adapter"
import type { TransactionSql } from "postgres"
import { z } from "zod"
import { canTransitionTask } from "./lifecycle"
import type { TaskState } from "./models"

export const canPersistTaskTransition = async (
  db: TransactionSql,
  taskId: string,
  transition: { readonly from: TaskState; readonly to: TaskState },
): Promise<boolean> => {
  const { from, to } = transition
  if (from === to) return false
  const unresolved = await db`select id from execution_task_step where task_id = ${taskId}
    and submit_started_at is not null and status in ('pending', 'claimed', 'running') limit 1`
  if (unresolved.length > 0) return false
  if (from === "cancel_requested" && to === "cancelled") {
    const active = await db`select id from execution_task_step where task_id = ${taskId}
      and status in ('claimed', 'running') limit 1`
    if (active.length > 0) return false
    if (await canPersistTaskTransition(db, taskId, { from, to: "succeeded" })) return false
  }
  if ((from === "queued" || from === "retry_waiting") && to === "failed") {
    const tasks = await db<{ executor_key: string; parameters: unknown; device_id: string }[]>`
      select executor_key, parameters, device_id from execution_task where id = ${taskId}`
    const task = tasks[0]
    if (task === undefined) return false
    const steps = await db<
      {
        kind: string
        target: unknown
        parameters: unknown
        command_id: string
        command_idempotency_key: string
      }[]
    >`select kind, target, parameters, command_id, command_idempotency_key
      from execution_task_step where task_id = ${taskId} order by sequence`
    const commands = steps.map((step) => {
      const parameters = z.record(z.string(), z.unknown()).safeParse(step.parameters)
      return DeviceCommandSchema.safeParse(
        parameters.success
          ? {
              ...parameters.data,
              type: step.kind,
              target: step.target,
              commandId: step.command_id,
              idempotencyKey: step.command_idempotency_key,
            }
          : null,
      )
    })
    const firstCommand = commands[0]
    const target = firstCommand?.success ? firstCommand.data.target : undefined
    const invalid =
      task.executor_key !== "device-command" ||
      task.parameters === null ||
      typeof task.parameters !== "object" ||
      Array.isArray(task.parameters) ||
      Object.keys(task.parameters).length !== 0 ||
      steps.length === 0 ||
      commands.some(
        (parsed) =>
          !parsed.success ||
          parsed.data.type === "input_text" ||
          parsed.data.target.deviceId !== task.device_id ||
          parsed.data.target.instanceId !== target?.instanceId,
      )
    return invalid && canTransitionTask(from, to, { reason: "invalid_persisted_validation" })
  }
  if (to === "succeeded") {
    const rows = await db<{ complete: boolean; confirmed: boolean }[]>`
      select exists (select 1 from execution_task_step where task_id = ${taskId})
        and not exists (select 1 from execution_task_step where task_id = ${taskId}
          and status not in ('succeeded', 'skipped')) as complete,
        exists (select 1 from execution_task_step where task_id = ${taskId} and status = 'succeeded')
        and not exists (select 1 from execution_task_step where task_id = ${taskId}
          and status = 'succeeded' and (result->>'status' is distinct from 'succeeded'
            or result->>'commandId' is distinct from command_id::text)) as confirmed`
    const completion = rows[0]
    if (completion?.complete !== true) return false
    if (from === "cancel_requested") {
      return (
        completion.confirmed &&
        canTransitionTask(from, to, {
          reason: "provider_success",
          allStepsComplete: completion.complete,
        })
      )
    }
  }
  return canTransitionTask(from, to)
}
