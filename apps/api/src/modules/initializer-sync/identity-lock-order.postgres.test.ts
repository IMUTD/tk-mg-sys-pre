import { expect, test } from "bun:test"
import { createMigratedTestDatabase, hasConfiguredTestDatabase } from "../../db/test-database"
import { applyInitializerSnapshot } from "./repository"

const integrationTest = hasConfiguredTestDatabase ? test : test.skip

integrationTest(
  "initializer waits for the user lock before revoking sessions",
  async () => {
    const db = await createMigratedTestDatabase()
    const sql = db.client
    const holder = await sql.reserve()
    let sync: Promise<void> | undefined
    let holding = false
    try {
      const admin = {
        id: "identity-lock",
        username: "lock-test",
        email: "lock@example.test",
        passwordHash: "$2b$10$fixture",
        enabled: true,
      }
      await applyInitializerSnapshot(sql, "identity-lock", { admins: [admin], boxes: [] })
      const rows = await sql<{ id: string }[]>`select id from app_user where email = ${admin.email}`
      const userId = rows[0]?.id
      if (userId === undefined) throw new Error("Missing test administrator")
      await sql`insert into app_session (id,user_id,token_hash,expires_at) values (${crypto.randomUUID()},${userId},'lock-test',now()+interval '1 hour')`
      await holder`begin`
      holding = true
      await holder`select id from app_user where id=${userId} for update`
      sync = applyInitializerSnapshot(sql, "identity-lock", {
        admins: [{ ...admin, enabled: false }],
        boxes: [],
      })
      const deadline = Date.now() + 3000
      let waiting = false
      while (!waiting && Date.now() < deadline) {
        const active =
          await sql`select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%app_user%' and pid<>pg_backend_pid()`
        waiting = active.length > 0
        if (!waiting) await Bun.sleep(10)
      }
      expect(waiting).toBe(true)
      await holder`set local lock_timeout = '300ms'`
      let updated = false
      try {
        await holder`update app_session set revoked_at=now() where user_id=${userId}`
        updated = true
      } catch (error) {
        if (!(error instanceof Error)) throw error
      }
      await holder`rollback`
      holding = false
      await sync
      expect(updated).toBe(true)
    } finally {
      if (holding) await holder`rollback`
      holder.release()
      await sync
      await db.close()
    }
  },
  10_000,
)
