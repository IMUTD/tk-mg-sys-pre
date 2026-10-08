import type { Sql } from "postgres"

export const retentionMs = 24 * 60 * 60 * 1000

export const purgeExpiredOperationalRows = async (sql: Sql): Promise<void> => {
  await sql`delete from device_watch where expires_at < now()`
}
