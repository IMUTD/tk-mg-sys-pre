import type { Sql, TransactionSql } from "postgres"

// Three missed 15s heartbeats. Initializer sync must not put a box back online after this.
export const markBoxesWithoutHeartbeat = async (sql: Sql | TransactionSql): Promise<void> => {
  await sql`
    update device d set status = 'offline', updated_at = now()
    where d.external_id is not null
      and d.status = 'online'
      and not exists (
        select 1 from device_agent a
        where a.device_id = d.id
          and a.last_heartbeat_at > now() - interval '45 seconds'
      )
  `
}
