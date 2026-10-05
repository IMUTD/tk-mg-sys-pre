import { type DeviceAdapter, DeviceCommandIdSchema } from "@tk-mg/device-adapter"
import type { TransactionSql } from "postgres"
import { isConfirmedProviderResult } from "./provider-result"
import { safeExecutionError, safeExecutionResult } from "./redaction"

export const confirmProviderStep = async (
  tx: TransactionSql,
  taskId: string,
  lookup: DeviceAdapter["getResult"] | undefined,
): Promise<boolean> => {
  if (lookup === undefined) return false
  const rows = await tx<{ readonly id: string; readonly commandId: string }[]>`
    select id, command_id as "commandId" from execution_task_step where task_id = ${taskId}
      and submit_started_at is not null and status in ('claimed', 'running') for update`
  const step = rows[0]
  if (rows.length !== 1 || step === undefined) return false
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      lookup(DeviceCommandIdSchema.parse(step.commandId)),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 1000)
      }),
    ])
    if (
      result === null ||
      result.commandId !== step.commandId ||
      !isConfirmedProviderResult(result)
    )
      return false
    const error =
      result.status === "failed" || result.status === "timed_out"
        ? safeExecutionError(result.error.code, result.error.message)
        : null
    await tx`update execution_task_step set status = ${result.status},
      error_code = ${error?.code ?? null}, error_message = ${error?.message ?? null},
      result = ${tx.json(safeExecutionResult(result))}, finished_at = now()
      where id = ${step.id}`
    return true
  } catch {
    return false
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
