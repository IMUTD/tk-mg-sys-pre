import type { Sql } from "postgres"

export const retentionMs = 24 * 60 * 60 * 1000

export const purgeExpiredOperationalRows = async (sql: Sql): Promise<void> => {
  await sql`delete from operation_log where created_at < now() - interval '14 days'`
  await sql`delete from execution_task_event where created_at < now() - interval '14 days'`
}
