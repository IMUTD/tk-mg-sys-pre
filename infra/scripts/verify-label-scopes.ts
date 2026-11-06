import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("../../apps/api/", import.meta.url))
const require = createRequire(`${root}package.json`)
const { default: postgres } = await import(pathToFileURL(require.resolve("postgres")).href)
const { drizzle } = await import(pathToFileURL(require.resolve("drizzle-orm/postgres-js")).href)
const { migrate } = await import(
  pathToFileURL(require.resolve("drizzle-orm/postgres-js/migrator")).href
)
const url = new URL(process.env["MIGRATION_VERIFY_DATABASE_URL"] ?? "")
assert(
  /^tk_mg_test_label_scopes_[a-zA-Z0-9_]+$/.test(url.pathname.slice(1)),
  "Verification requires a separate tk_mg_test_label_scopes_* database",
)
const client = postgres(url.toString(), { onnotice: () => undefined })
const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
const tables = [
  "operation_account",
  "operation_proxy",
  "operation_resource",
  "execution_task",
  "execution_task_step",
  "execution_task_run",
  "execution_task_event",
  "device_group_history",
  "audit_event",
]
const snapshot = async () => {
  const records: Record<string, { count: number; hash: string }> = {}
  for (const table of tables) {
    const order = table === "device_group_history" ? ["device_id", "group_id"] : ["id"]
    const rows = await client`select * from ${client(table)} order by ${client(order)}`
    records[table] = { count: rows.length, hash: digest([...rows]) }
  }
  const labels = await client`select id, administrator_id, kind, name, created_at
    from business_label order by id`
  const devices = await client`select id, group_id, assignee_user_id, assignment_pending,
    remark_id, box_group_id from device order by id`
  return {
    records,
    labels: Object.fromEntries(labels.map((row: { id: string }) => [row.id, digest(row)])),
    devices: { count: devices.length, hash: digest([...devices]) },
  }
}

try {
  const before = await snapshot()
  const versions = await client`select count(*)::int as count from drizzle.__drizzle_migrations`
  assert.equal(versions[0].count, 37, "Expected the pre-scope migration version")
  await migrate(drizzle(client), { migrationsFolder: `${root}src/db/migrations` })
  const after = await snapshot()
  assert.deepEqual(after.records, before.records, "Business or history records changed")
  assert.deepEqual(after.devices, before.devices, "Device assignments changed")
  for (const [id, hash] of Object.entries(before.labels))
    assert.equal(after.labels[id], hash, `Original category changed: ${id}`)
  const wrongReferences = await client`select d.id from device d
    left join business_label g on g.id = d.box_group_id
    left join business_label r on r.id = d.remark_id
    where (d.box_group_id is not null and (g.scope <> 'device' or g.kind <> 'group'))
      or (d.remark_id is not null and (r.scope <> 'device' or r.kind <> 'remark'))`
  assert.equal(wrongReferences.length, 0, "Invalid migrated device classification")
  await migrate(drizzle(client), { migrationsFolder: `${root}src/db/migrations` })
  assert.deepEqual(await snapshot(), after, "Repeated migration changed data")
  const applied = await client`select count(*)::int as count from drizzle.__drizzle_migrations`
  assert.equal(applied[0].count, 38)
  const scopes = await client`select scope, kind, count(*)::int as count
    from business_label group by scope, kind order by scope, kind`
  console.log(
    JSON.stringify({
      result: "passed",
      migrationsBefore: 37,
      migrationsAfter: 38,
      originalLabelsPreserved: Object.keys(before.labels).length,
      deviceAssignmentsPreserved: before.devices.count,
      records: Object.fromEntries(
        Object.entries(before.records).map(([table, row]) => [table, row.count]),
      ),
      scopes: [...scopes],
      idempotence: true,
    }),
  )
} finally {
  await client.end()
}
