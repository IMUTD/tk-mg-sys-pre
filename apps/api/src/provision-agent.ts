import { createHash } from "node:crypto"
import postgres, { type Sql } from "postgres"
import { z } from "zod"

export const provisionAgent = async (sql: Sql, boxId: string, token: string): Promise<void> => {
  if (token.length < 32 || token.length > 200)
    throw new Error("Agent token must contain 32-200 characters")
  await sql.begin(async (tx) => {
    const devices = await tx<{ id: string }[]>`select id from device
      where external_id = ${boxId} and enabled and not assignment_pending for update`
    const device = devices[0]
    if (device === undefined) throw new Error("Box not found")
    const active = await tx`select 1 from execution_task where device_id = ${device.id}
      and status in ('dispatching','running','ood','needs_reconciliation')
      union all select 1 from execution_task_device_lease where device_id = ${device.id} and released_at is null`
    if (active.length > 0)
      throw new Error("Resolve active or uncertain work before rotating the token")
    await tx`insert into device_agent(device_id, token_hash)
      values (${device.id}, ${createHash("sha256").update(token).digest("hex")})
      on conflict(device_id) do update set token_hash = excluded.token_hash, registered_at = null,
        last_heartbeat_at = null`
  })
}
if (import.meta.main) {
  const config = z
    .object({
      DATABASE_URL: z.string().url(),
      BOX_ID: z.string().min(1),
      AGENT_TOKEN: z.string().min(32).max(200),
    })
    .parse(Bun.env)
  const sql = postgres(config.DATABASE_URL, { max: 1 })
  try {
    await provisionAgent(sql, config.BOX_ID, config.AGENT_TOKEN)
    console.log("Agent token hash configured")
  } finally {
    await sql.end()
  }
}
