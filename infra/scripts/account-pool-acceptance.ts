import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("../../", import.meta.url))
const require = createRequire(`${root}apps/api/package.json`)
const { default: postgres } = await import(pathToFileURL(require.resolve("postgres")).href)
const { drizzle } = await import(pathToFileURL(require.resolve("drizzle-orm/postgres-js")).href)
const { migrate } = await import(
  pathToFileURL(require.resolve("drizzle-orm/postgres-js/migrator")).href
)
const url = new URL(process.env["DATABASE_URL"] ?? "")
assert.equal(
  url.pathname,
  "/tk_mg_test_browser",
  "Only the disposable acceptance instance is allowed",
)
const mode = process.argv[2]
assert(mode === "prepare" || mode === "deploy", "Use prepare or deploy")
const directory = "/opt/tk-mg-integration/backups"
const manifestPath = `${directory}/account-pool-acceptance.json`
const environment = {
  ...Bun.env,
  POSTGRES_DB: "tk_mg_test_browser",
  WEB_BIND_ADDRESS: "100.65.10.245",
}
const compose = [
  "docker",
  "compose",
  "--project-name",
  "tk-mg-integration",
  "--env-file",
  "infra/.env.integration",
  "-f",
  "infra/docker-compose.yml",
  "-f",
  "infra/docker-compose.integration.yml",
]
const run = async (command: string[], capture = false, stdin?: Blob) => {
  const child = Bun.spawn(command, {
    cwd: root,
    env: environment,
    stdin: stdin ?? "ignore",
    stdout: capture ? "pipe" : "inherit",
    stderr: "inherit",
  })
  const output = capture ? await new Response(child.stdout).text() : ""
  assert.equal(await child.exited, 0, `Command failed: ${command[0]}`)
  return output.trim()
}
const snapshot = async (
  client: ReturnType<typeof postgres>,
  names?: readonly string[],
  excludeSyncTimestamps = false,
) => {
  const tables =
    names ??
    (
      await client<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public' order by tablename`
    ).map((row: { tablename: string }) => row.tablename)
  const result: Record<string, { count: number; hash: string }> = {}
  for (const table of tables) {
    const ignored =
      excludeSyncTimestamps && table === "device"
        ? ["updated_at"]
        : excludeSyncTimestamps && table === "init_sync_state"
          ? ["last_success_at"]
          : []
    const record = client`(to_jsonb(original) - ${ignored}::text[])`
    const rows = await client<{ count: number; hash: string }[]>`
      select count(*)::int as count,
        md5(coalesce(string_agg(${record}::text, E'\n'
          order by ${record}::text), '')) as hash
      from ${client(table)} original`
    const row = rows[0]
    assert(row !== undefined)
    result[table] = row
  }
  return result
}
const client = postgres(url.toString(), { onnotice: () => undefined })
try {
  if (mode === "prepare") {
    const version = await client`select count(*)::int as count from drizzle.__drizzle_migrations`
    assert.equal(version[0].count, 38, "Expected the pre-account-pool migration version")
    const records = await snapshot(client)
    const stableRecords = await snapshot(client, Object.keys(records), true)
    const stamp = new Date().toISOString().replace(/\D/g, "")
    const backup = `${directory}/${stamp}-pre-account-pools.dump`
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const container = await run([...compose, "ps", "-q", "postgres"], true)
    assert(container.length > 0)
    const user = decodeURIComponent(url.username)
    const child = Bun.spawn(
      ["docker", "exec", container, "pg_dump", "-U", user, "-d", "tk_mg_test_browser", "-Fc"],
      {
        stdout: Bun.file(backup),
        stderr: "inherit",
      },
    )
    assert.equal(await child.exited, 0, "Backup failed")
    await run(["chmod", "600", backup])
    const database = `tk_mg_test_account_pools_${stamp}`
    assert(/^tk_mg_test_account_pools_\d+$/.test(database))
    await run(["docker", "exec", container, "createdb", "-U", user, "-T", "template0", database])
    await run(
      [
        "docker",
        "exec",
        "-i",
        container,
        "pg_restore",
        "-U",
        user,
        "-d",
        database,
        "--no-owner",
        "--no-privileges",
        "--exit-on-error",
      ],
      false,
      Bun.file(backup),
    )
    const copyUrl = new URL(url)
    copyUrl.pathname = `/${database}`
    const copy = postgres(copyUrl.toString(), { onnotice: () => undefined })
    try {
      assert.deepEqual(
        await snapshot(copy, Object.keys(records)),
        records,
        "Restored records changed",
      )
      await migrate(drizzle(copy), { migrationsFolder: `${root}apps/api/src/db/migrations` })
      assert.deepEqual(
        await snapshot(copy, Object.keys(records)),
        records,
        "Migration changed existing records",
      )
      await migrate(drizzle(copy), { migrationsFolder: `${root}apps/api/src/db/migrations` })
      assert.deepEqual(
        await snapshot(copy, Object.keys(records)),
        records,
        "Repeated migration changed records",
      )
      const after = await copy`select count(*)::int as count from drizzle.__drizzle_migrations`
      assert.equal(after[0].count, 39)
    } finally {
      await copy.end()
    }
    writeFileSync(
      manifestPath,
      JSON.stringify({ stamp, backup, database, records, stableRecords }),
      {
        mode: 0o600,
      },
    )
    console.log(
      JSON.stringify({
        result: "backup_and_copy_migration_passed",
        backup,
        database,
        migrations: 39,
        originalTables: Object.keys(records).length,
        idempotence: true,
      }),
    )
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    assert.deepEqual(
      await snapshot(client, Object.keys(manifest.stableRecords), true),
      manifest.stableRecords,
      "Acceptance data changed after backup; prepare a new backup before deployment",
    )
    for (const name of ["api", "web"]) {
      await run([
        "docker",
        "image",
        "tag",
        `tk-mg-integration-${name}`,
        `tk-mg-integration-${name}:pre-account-pools-${manifest.stamp}`,
      ])
    }
    await run([
      ...compose,
      "up",
      "-d",
      "--build",
      "--no-deps",
      "--wait",
      "--wait-timeout",
      "120",
      "api",
      "web",
    ])
    assert.deepEqual(
      await snapshot(client, Object.keys(manifest.stableRecords), true),
      manifest.stableRecords,
      "Deployment changed original records",
    )
    const version = await client`select count(*)::int as count from drizzle.__drizzle_migrations`
    assert.equal(version[0].count, 39)
    console.log(
      JSON.stringify({
        result: "deployed_and_original_data_preserved",
        migrations: 39,
        originalTables: Object.keys(manifest.records).length,
        backup: manifest.backup,
        previousImageTag: `pre-account-pools-${manifest.stamp}`,
      }),
    )
  }
} finally {
  await client.end()
}
