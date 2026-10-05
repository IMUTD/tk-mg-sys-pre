import type { TransactionSql } from "postgres"
import { z } from "zod"
import type { TaskState } from "./models"
import { safeExecutionError } from "./redaction"

const safeSuccess = z.strictObject({
  commandId: z.uuid(),
  status: z.literal("succeeded"),
  retryable: z.boolean(),
  outcome: z.strictObject({ kind: z.enum(["acknowledged", "no_artifact", "artifact"]) }),
})

export const terminalProjection = async (
  tx: TransactionSql,
  taskId: string,
  state: Extract<TaskState, "succeeded" | "failed" | "timed_out" | "cancelled">,
) => {
  if (state === "cancelled") {
    const error = safeExecutionError("cancelled", undefined)
    return { result: null, errorCode: error.code, errorMessage: error.message }
  }
  const rows = await tx<
    {
      readonly commandId: string
      readonly result: unknown
      readonly errorCode: string | null
    }[]
  >`select command_id as "commandId", result, error_code as "errorCode"
    from execution_task_step where task_id = ${taskId}
      and status in ${tx(state === "failed" ? ["failed", "timed_out"] : [state])}
    order by sequence desc limit 1`
  const step = rows[0]
  if (state === "succeeded") {
    const parsed = safeSuccess.safeParse(step?.result)
    if (!parsed.success || parsed.data.commandId !== step?.commandId) return null
    return { result: parsed.data, errorCode: null, errorMessage: null }
  }
  const error = safeExecutionError(step?.errorCode ?? undefined, undefined)
  return { result: null, errorCode: error.code, errorMessage: error.message }
}
