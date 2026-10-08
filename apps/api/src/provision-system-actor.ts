import { checkSystemActorReadiness } from "@tk-mg/task-execution"
import postgres, { type Sql } from "postgres"
import { z } from "zod"

export const provisionSystemActor = async (sql: Sql, actorId: string): Promise<void> => {
  const id = z.string().uuid().parse(actorId)
  const passwordHash = await Bun.password.hash(crypto.randomUUID())
  await sql.begin(async (tx) => {
    await tx`insert into app_user(id,email,display_name,password_hash,role,enabled)
      values (${id}, ${`system-${id}@execution.internal`}, 'System execution audit', ${passwordHash}, 'administrator', false)
      on conflict(id) do nothing`
    const existing =
      await tx`select id from app_user where id = ${id} and role = 'administrator' and not enabled`
    if (existing.length !== 1)
      throw new Error("Refusing to overwrite an existing non-system account")
  })
  await checkSystemActorReadiness(sql, id)
}

if (import.meta.main) {
  const config = z
    .object({
      DATABASE_URL: z.string().url(),
      TK_MG_SYSTEM_ACTOR_ID: z.string().uuid(),
    })
    .parse(Bun.env)
  const sql = postgres(config.DATABASE_URL, { max: 1 })
  try {
    await provisionSystemActor(sql, config.TK_MG_SYSTEM_ACTOR_ID)
    console.log("Disabled system audit actor configured")
  } catch (error) {
    console.error(
      "System actor configuration failed",
      error instanceof Error ? error.name : "Error",
    )
    process.exitCode = 1
  } finally {
    await sql.end()
  }
}
