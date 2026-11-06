import { hostname } from "node:os"

import type { Sql, TransactionSql } from "postgres"

// Idle heartbeats are 60s. The box stays online for 150s. Initializer sync uses the same window.
export const presenceHolder = (): string => {
  const configured = process.env["TK_MG_PRESENCE_HOLDER"]?.trim()
  if (configured !== undefined && configured.length > 0) return configured
  return `${hostname()}:${process.pid}`
}

export const sqlState = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code
  }
  return error instanceof Error ? error.name : "Error"
}

export const tryAcquirePresenceLease = async (sql: Sql, holder: string): Promise<boolean> => {
  const rows = await sql`
    update presence_leader
    set holder = ${holder},
        leased_until = now() + interval '15 seconds',
        updated_at = now()
    where id = 1
      and (holder = ${holder} or leased_until < now())
    returning holder
  `
  return rows.length === 1
}

export const markBoxesWithoutHeartbeat = async (sql: Sql | TransactionSql): Promise<void> => {
  await sql`
    with picked as (
      select d.id
      from device d
      where d.external_id is not null
        and d.status = 'online'
        and not exists (
          select 1 from device_agent a
          where a.device_id = d.id
            and a.last_heartbeat_at > now() - interval '150 seconds'
        )
      order by d.external_id
      for update
    )
    update device
    set status = 'offline', updated_at = now()
    from picked
    where device.id = picked.id
  `
  await sql`
    update box_share_entry set box_online = false
    where device_id in (
      select d.id from device d
      where d.external_id is not null and d.status = 'offline'
        and not exists (
          select 1 from device_agent a
          where a.device_id = d.id and a.last_heartbeat_at > now() - interval '150 seconds'
        )
    )
  `
}
