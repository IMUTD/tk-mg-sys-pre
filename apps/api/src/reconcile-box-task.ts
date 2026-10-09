import { checkSystemActorReadiness } from "@tk-mg/task-execution"
import postgres, { type Sql } from "postgres"
import { z } from "zod"

export const reconcileBoxTask = async (
  sql: Sql,
  actorId: string,
  taskId: string,
  outcome: "failed" | "cancelled",
  evidence: string,
): Promise<void> => {
  if (evidence.trim().length < 10)
    throw new Error("Document independent confirmation that box execution has stopped")
  await checkSystemActorReadiness(sql, actorId)
  await sql.begin(async (tx) => {
    const tasks = await tx<{ id: string }[]>`select id from execution_task
      where id = ${taskId} and executor_key = 'box-agent' and status = 'needs_reconciliation' for update`
    if (tasks.length !== 1) throw new Error("Task is not awaiting box reconciliation")
    await tx`update execution_task_step set status = ${outcome}, finished_at = now()
      where task_id = ${taskId} and status in ('pending','claimed','running','held')`
    await tx`update execution_task set status = ${outcome}, finished_at = now(),
      terminal_reason = 'box_execution_stop_confirmed', updated_at = now() where id = ${taskId}`
    await tx`update execution_task_device_lease set released_at = now(), recovery_reason = 'manual_confirmation'
      where task_id = ${taskId} and released_at is null`
    await tx`insert into audit_event(id, actor_id, action, outcome, target, metadata)
      values (${crypto.randomUUID()}, ${actorId}, 'box.task.reconcile', 'allowed', ${taskId},
        ${tx.json({ outcome, confirmation: evidence.trim() })})`
  })
}
if (import.meta.main) {
  const config = z
    .object({
      DATABASE_URL: z.string().url(),
      TK_MG_SYSTEM_ACTOR_ID: z.string().uuid(),
      BOX_TASK_ID: z.string().uuid(),
      BOX_RECONCILIATION_RESULT: z.enum(["failed", "cancelled"]),
      BOX_EXECUTION_STOP_CONFIRMED: z.literal("true"),
      BOX_RECONCILIATION_EVIDENCE: z.string().min(10).max(1000),
    })
    .parse(Bun.env)
  const sql = postgres(config.DATABASE_URL, { max: 1 })
  try {
    await reconcileBoxTask(
      sql,
      config.TK_MG_SYSTEM_ACTOR_ID,
      config.BOX_TASK_ID,
      config.BOX_RECONCILIATION_RESULT,
      config.BOX_RECONCILIATION_EVIDENCE,
    )
    console.log("Box task reconciled without replay")
  } finally {
    await sql.end()
  }
}
