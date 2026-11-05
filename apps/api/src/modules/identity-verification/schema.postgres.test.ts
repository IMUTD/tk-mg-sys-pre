import { afterEach, expect, it } from "bun:test"
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { z } from "zod"
import { createSqlClient } from "../../db/client"
import {
  createMigratedTestDatabase,
  getTestDatabaseUrl,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"

let database: MigratedTestDatabase | null = null
afterEach(async () => {
  await database?.close()
  database = null
})
const integration = hasConfiguredTestDatabase ? it : it.skip
integration("creates all three identity tables when migrations run", async () => {
  // Given
  database = await createMigratedTestDatabase()
  // When
  const tables = await database.client<
    { readonly name: string }[]
  >`select tablename as name from pg_tables where schemaname='public' and tablename in ('admin_identity_verification', 'identity_verification_attempt', 'identity_password_failure') order by tablename`
  // Then
  expect(tables.map((row) => row.name)).toEqual([
    "admin_identity_verification",
    "identity_password_failure",
    "identity_verification_attempt",
  ])
})

integration(
  "preserves baseline 0060 data across the incremental identity migration and its replay",
  async () => {
    // Given: a genuine 0060 database built from the original migration journal prefix.
    const migrationsFolder = fileURLToPath(new URL("../../db/migrations", import.meta.url))
    const baselineFolder = await mkdtemp(join(tmpdir(), "identity-migration-baseline-"))
    const sql = createSqlClient(getTestDatabaseUrl())
    database = { client: sql, close: () => sql.end() }
    try {
      await cp(migrationsFolder, baselineFolder, { recursive: true })
      const journalSchema = z.object({
        version: z.string(),
        dialect: z.string(),
        entries: z.array(
          z.object({
            idx: z.number().int(),
            version: z.string(),
            when: z.number(),
            tag: z.string(),
            breakpoints: z.boolean(),
          }),
        ),
      })
      const journalPath = join(baselineFolder, "meta", "_journal.json")
      const journal = journalSchema.parse(JSON.parse(await readFile(journalPath, "utf8")))
      const entries = journal.entries.filter((entry) => entry.idx < 60)
      expect(entries.at(-1)?.tag).toBe("0060_box_service_refund")
      await writeFile(journalPath, JSON.stringify({ ...journal, entries }))
      await sql`select pg_advisory_lock(705203901)`
      await sql`drop schema if exists public cascade`
      await sql`create schema public`
      await sql`drop schema if exists drizzle cascade`
      await migrate(drizzle(sql), { migrationsFolder: baselineFolder })
      const absent = await sql<{ readonly relation: string | null }[]>`
      select to_regclass('public.admin_identity_verification')::text as relation
    `
      expect(absent[0]?.relation).toBeNull()
      const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      const sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      const auditId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
      const createdAt = "2026-01-02T03:04:05.000Z"
      await sql`insert into app_user(id,email,display_name,password_hash,role,enabled,provisioned_by,created_at) values (${userId},'baseline@example.test','Existing administrator','fixture-password-hash','administrator',true,'init-tool',${createdAt})`
      await sql`insert into app_session(id,user_id,token_hash,expires_at,created_at) values (${sessionId},${userId},'fixture-session-token-hash',${"2099-01-01T00:00:00.000Z"},${createdAt})`
      await sql`insert into audit_event(id,actor_id,target,action,outcome,metadata,created_at) values (${auditId},${userId},${userId},'fixture.baseline','success',${JSON.stringify({ marker: "existing-audit" })},${createdAt})`
      const snapshots = async () => {
        const results = await Promise.all([
          sql<
            { readonly value: string }[]
          >`select row_to_json(u)::text as value from app_user u where id=${userId}`,
          sql<
            { readonly value: string }[]
          >`select row_to_json(s)::text as value from app_session s where id=${sessionId}`,
          sql<
            { readonly value: string }[]
          >`select row_to_json(a)::text as value from audit_event a where id=${auditId}`,
        ])
        return results.map((rows) => rows.map((row) => row.value))
      }
      const baseline = await snapshots()
      expect(baseline.map((rows) => rows.length)).toEqual([1, 1, 1])

      // When: apply the additive identity migration and rerun the migrator unchanged.
      await migrate(drizzle(sql), { migrationsFolder })
      const upgraded = await snapshots()
      await migrate(drizzle(sql), { migrationsFolder })

      // Then: every original column remains unchanged and migrations run exactly once.
      expect(upgraded).toEqual(baseline)
      expect(await snapshots()).toEqual(baseline)
      const applied = await sql<
        { readonly count: number }[]
      >`select count(*)::int as count from drizzle.__drizzle_migrations`
      expect(applied[0]?.count).toBe(journal.entries.length)
      const tables = await sql<
        { readonly count: number }[]
      >`select count(*)::int as count from pg_tables where schemaname='public' and tablename in ('admin_identity_verification','identity_verification_attempt','identity_password_failure')`
      expect(tables[0]?.count).toBe(3)
    } finally {
      await rm(baselineFolder, { recursive: true })
    }
  },
)
