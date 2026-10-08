import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { z } from "zod"
import { UserIdSchema } from "./lib/authorization"
import { createSecretCipher } from "./lib/crypto"
import { createPostgresAccountRepository } from "./modules/accounts/repository"
import { createAccountService } from "./modules/accounts/service"
import { createPostgresAuditRepository } from "./modules/audit/service"
import { applyInitializerSnapshot } from "./modules/initializer-sync/repository"
import { readInitializerSnapshot } from "./modules/initializer-sync/source"
import { provisionAgent } from "./provision-agent"
import { provisionSystemActor } from "./provision-system-actor"

const config = z
  .object({
    DATABASE_URL: z.string().url(),
    INIT_FIXTURE_WRITER_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    SECRET_ENCRYPTION_KEY: z.string().length(32),
    TK_MG_SYSTEM_ACTOR_ID: z.string().uuid(),
  })
  .parse(Bun.env)
for (const url of [config.DATABASE_URL, config.INIT_FIXTURE_WRITER_URL]) {
  if (!/^tk_mg_test_[a-zA-Z0-9_]+$/.test(new URL(url).pathname.slice(1))) {
    throw new Error("Fixtures require disposable tk_mg_test_* databases")
  }
}
if (new URL(config.DATABASE_URL).pathname === new URL(config.INIT_FIXTURE_WRITER_URL).pathname) {
  throw new Error("Fixtures require separate initializer and business databases")
}
const sql = postgres(config.DATABASE_URL, { max: 1 })
const source = postgres(config.INIT_FIXTURE_WRITER_URL, { max: 1 })
let stage = "migrations"
try {
  // Drizzle changes the client's JSON serializers; business SQL needs a separate client.
  const migration = postgres(config.DATABASE_URL, { max: 1 })
  try {
    await migrate(drizzle(migration), {
      migrationsFolder: fileURLToPath(new URL("./db/migrations", import.meta.url)),
    })
  } finally {
    await migration.end()
  }
  await provisionSystemActor(sql, config.TK_MG_SYSTEM_ACTOR_ID)
  await source`create table if not exists init_admin (
    id bigserial primary key, username text not null, email text not null unique,
    password text not null default '', password_hash text not null, enabled boolean not null default true)`
  await source`create table if not exists init_box (
    id text primary key, ip text not null, type text not null default '',
    firmware text not null default '', memory text not null default '', memory_pct int not null default 0,
    disk text not null default '', disk_pct int not null default 0, online boolean not null default false,
    last_seen_at timestamptz)`
  await source`create table if not exists init_admin_box (
    box_id text primary key references init_box(id), admin_id bigint not null references init_admin(id))`
  stage = "source-fixtures"
  const password = crypto.randomUUID()
  const passwordHash = await Bun.password.hash(password, { algorithm: "bcrypt", cost: 4 })
  for (const [index, email] of [
    "first.integration@example.test",
    "second.integration@example.test",
  ].entries()) {
    await source`insert into init_admin(username,email,password_hash) values (${`integration-${index}`},${email},${passwordHash})
      on conflict(email) do update set password_hash = excluded.password_hash, enabled = true`
  }
  await source`insert into init_box(id,ip,type) values ('integration-box','192.0.2.20','Q1')
    on conflict(id) do nothing`
  await source`insert into init_admin_box(box_id,admin_id)
    select 'integration-box', id from init_admin where email = 'first.integration@example.test'
    on conflict(box_id) do update set admin_id = excluded.admin_id`
  const role = "tk_mg_test_init_reader"
  stage = "read-only-role"
  const readerPassword = crypto.randomUUID().replaceAll("-", "")
  const exists = await source`select rolname from pg_roles where rolname = ${role}`
  const ddl = await source<{ statement: string }[]>`select format(
    ${exists.length === 0 ? "create role %I login password %L" : "alter role %I login password %L"}::text,
    ${role}::text, ${readerPassword}::text) as statement`
  const statement = ddl[0]?.statement
  if (statement === undefined) throw new Error("Cannot provision read-only fixture role")
  await source.unsafe(statement)
  await source`grant usage on schema public to ${source(role)}`
  await source`grant select(id,username,email,password_hash,enabled) on init_admin to ${source(role)}`
  await source`grant select on init_box,init_admin_box to ${source(role)}`
  const readerUrl = new URL(config.INIT_FIXTURE_WRITER_URL)
  readerUrl.username = role
  readerUrl.password = readerPassword
  const reader = postgres(readerUrl.toString(), { max: 1 })
  stage = "synchronization"
  try {
    await applyInitializerSnapshot(sql, "integration", await readInitializerSnapshot(reader))
  } finally {
    await reader.end()
  }
  const agentToken = crypto.randomUUID() + crypto.randomUUID()
  stage = "agent-provisioning"
  await provisionAgent(sql, "integration-box", agentToken)
  const admin = (
    await sql<{ id: string; groupId: string }[]>`
    select u.id, g.group_id as "groupId" from app_user u join user_group g on g.user_id = u.id
    where u.email = 'first.integration@example.test'`
  )[0]
  if (admin === undefined) throw new Error("Missing synchronized fixture administrator")
  const accounts = createAccountService({
    auditRepository: createPostgresAuditRepository(sql),
    cipher: createSecretCipher(config.SECRET_ENCRYPTION_KEY),
    repository: createPostgresAccountRepository(sql),
  })
  stage = "account-list"
  if ((await accounts.list({ groupId: admin.groupId, page: 1, pageSize: 1 })).total === 0) {
    stage = "account-create"
    await accounts.create(UserIdSchema.parse(admin.id), admin.groupId, {
      identifier: "integration.account",
      name: "Integration account",
      note: "",
      secret: crypto.randomUUID(),
      status: "ready",
      tags: ["integration"],
    })
  }
  const destination = resolve(process.argv[2] ?? "infra/.integration-fixtures.json")
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(
    destination,
    JSON.stringify({
      ...config,
      INIT_SOURCE_DATABASE_URL: readerUrl.toString(),
      INIT_SOURCE_TEST_DATABASE_URL: readerUrl.toString(),
      INIT_SOURCE_KEY: "integration",
      E2E_EMAIL: "first.integration@example.test",
      E2E_SECOND_EMAIL: "second.integration@example.test",
      E2E_PASSWORD: password,
      E2E_AGENT_TOKEN: agentToken,
    }),
    { mode: 0o600 },
  )
  console.log("Prepared disposable integration fixtures; credentials were not printed")
} catch (error) {
  console.error(
    "Integration fixture preparation failed",
    stage,
    error instanceof Error ? error.name : "Error",
    typeof error === "object" && error !== null
      ? (Object.getOwnPropertyDescriptor(error, "code")?.value ?? "")
      : "",
  )
  process.exitCode = 1
} finally {
  await source.end()
  await sql.end()
}
