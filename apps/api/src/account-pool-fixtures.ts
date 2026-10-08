import postgres from "postgres"
import { z } from "zod"
import { createSecretCipher } from "./lib/crypto"
import { PoolSourceFilterSchema, PoolWriteSchema } from "./modules/account-pool/pool-model"
import { createPostgresPoolRepository } from "./modules/account-pool/pool-repository"

const config = z
  .object({
    DATABASE_URL: z.string().url(),
    SECRET_ENCRYPTION_KEY: z.string().length(32),
  })
  .parse(Bun.env)
const database = new URL(config.DATABASE_URL).pathname.slice(1)
if (!/^tk_mg_test_[a-zA-Z0-9_]+$/.test(database))
  throw new Error("Account-pool fixtures require a disposable tk_mg_test_* database")
const sql = postgres(config.DATABASE_URL, { max: 1 })
try {
  const users = await sql<{ id: string; group_id: string }[]>`
    select u.id, g.group_id from app_user u join user_group g on g.user_id = u.id
    where u.email = 'first.integration@example.test'`
  const user = users[0]
  if (user === undefined)
    throw new Error(
      "Existing integration administrator is required; fixtures do not reset identities",
    )
  const devices = await sql<{ id: string }[]>`
    select id from device where group_id = ${user.group_id} and assignment_pending = false
      and enabled = true order by created_at limit 1`
  const device = devices[0]
  if (device === undefined) throw new Error("Existing disposable integration device is required")
  const cipher = createSecretCipher(config.SECRET_ENCRYPTION_KEY)
  for (let index = 0; index < 12; index++) {
    const identifier = `simulation.pool.${String(index + 1).padStart(2, "0")}@example.test`
    const exists =
      await sql`select id from operation_account where group_id = ${user.group_id} and identifier = ${identifier}`
    if (exists.length > 0) continue
    const local = index < 4
    await sql`insert into operation_account
      (group_id, name, identifier, encrypted_secret, app, platform_uid, backup_type,
        backup_key, device_id, tags, status, online, transferred, deleted, note, follower, following, favorite, extra)
      values (${user.group_id}, ${`模拟账号-${index + 1}`}, ${identifier},
        ${cipher.encrypt("simulation-only-not-a-real-password")}, 'tiktok', ${`SIMPOOL-${index + 1}`},
        ${local ? "local" : "private_cloud"}::operation_account_backup_type,
        ${`simulation-backup-${index + 1}`}, ${local ? device.id : null},
        ${[local ? "验收-本地账号" : "验收-云端账号", index % 2 === 0 ? "验收-标签A" : "验收-标签B"]},
        ${index === 10 ? "disabled" : index === 7 ? "suspended" : "ready"}::operation_account_status,
        ${index % 2 === 0}, ${index === 8}, ${index === 9},
        '账号池模拟数据，非真实平台账号', ${(index + 1) * 100}, ${index + 10}, ${index * 20},
        ${sql.json({ playToday: index * 11, playYesterday: index * 9, playBeforeYesterday: index * 7, playTotal: index * 1000, fixture: "account-pool-simulation" })})`
  }
  const repository = createPostgresPoolRepository(sql)
  const prepared: { key: string; count: number; rounds: number }[] = []
  for (const [backType, name] of [
    ["2", "验收-本地备份"],
    ["3", "验收-私有云备份"],
    ["4", "验收-全量备份"],
    ["5", "验收-全量私有云备份"],
  ] as const) {
    const exists = await sql<{ id: string }[]>`select id from operation_account_pool
      where group_id = ${user.group_id} and key = ${name} and deleted_at is null`
    const filter = PoolSourceFilterSchema.parse({
      backType,
      deviceId: ["2", "4"].includes(backType) ? device.id : null,
      tag: [["2", "4"].includes(backType) ? "验收-本地账号" : "验收-云端账号"],
    })
    const pool =
      exists[0] === undefined
        ? await repository.create(
            user.group_id,
            user.id,
            PoolWriteSchema.parse({
              key: name,
              filter,
              remark: "模拟验收数据，不代表真实盒子执行",
              times: backType === "3" ? 20 : 3,
            }),
          )
        : await repository.details(user.group_id, exists[0].id)
    const details = await repository.details(user.group_id, pool.id)
    const account = details.accounts.find((item) => item.status === "0")
    if (account !== undefined) {
      await repository.consume(user.group_id, user.id, pool.id, {
        accountId: account.id,
        round: 1,
        consumptionKey: "fixture-simulation-round-1",
        origin: "simulation",
      })
    }
    prepared.push({ key: name, count: pool.count, rounds: pool.times })
  }
  console.log(
    JSON.stringify({
      result: "prepared_simulated_account_pools",
      pools: prepared,
      identitiesReset: false,
    }),
  )
} finally {
  await sql.end()
}
