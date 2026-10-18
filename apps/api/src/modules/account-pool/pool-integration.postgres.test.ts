import { afterEach, describe, expect, it } from "bun:test"
import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { PoolError, PoolListSchema, PoolSourceFilterSchema, PoolWriteSchema } from "./pool-model"
import { createPostgresPoolRepository } from "./pool-repository"

const databaseTest = hasConfiguredTestDatabase ? it : it.skip
const groupId = "11111111-1111-4111-8111-111111111111"
const otherGroup = "22222222-2222-4222-8222-222222222222"
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const deviceId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const instanceId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
let database: MigratedTestDatabase | null = null
afterEach(async () => {
  await database?.close()
  database = null
})

const setup = async () => {
  database = await createMigratedTestDatabase()
  const sql = database.client
  await sql`insert into access_group(id,name) values (${groupId},'Pools'),(${otherGroup},'Other')`
  await sql`insert into app_user(id,email,password_hash,role) values
    (${actorId},'pool.integration@example.test','unused','administrator')`
  await sql`insert into device(id,group_id,host,model,name)
    values (${deviceId},${groupId},'192.0.2.40','fixture','Pool fixture')`
  await sql`insert into device_instance(id,device_id,instance_index,label)
    values (${instanceId},${deviceId},1,'Pool fixture pit')`
  const ids = Array.from({ length: 7 }, () => crypto.randomUUID())
  for (const [index, id] of ids.entries()) {
    await sql`insert into operation_account
      (id,group_id,name,identifier,encrypted_secret,backup_type,device_id,device_instance_id,tags,extra,transferred,deleted,status)
      values (${id},${index === 6 ? otherGroup : groupId},'Pool fixture',${`pool.${index}`},
        'fixture-ciphertext',${index === 0 ? "local" : "private_cloud"}::operation_account_backup_type,
        ${index === 0 ? deviceId : null},${index === 0 ? instanceId : null},
        ${["pool-group", index === 1 ? "red" : "blue"]},
        ${sql.json({ playTotal: 123, password: "fixture-do-not-expose" })},
        ${index === 3},${index === 4},${index === 5 ? "disabled" : "ready"}::operation_account_status)`
  }
  return { sql, ids, repository: createPostgresPoolRepository(sql) }
}
const cloud = PoolSourceFilterSchema.parse({ backType: "3" })
const write = (key = "persisted-pool", times = 3) =>
  PoolWriteSchema.parse({ filter: cloud, key, times })

describe("account pool catalog PostgreSQL", () => {
  databaseTest(
    "persists metadata, sanitized membership snapshots and each repetition",
    async () => {
      const { sql, repository } = await setup()
      const source = await repository.sources(groupId, cloud, 1, 10)
      expect(source.total).toBe(2)
      expect(source.groups).toEqual([{ tag: "pool-group", total: 2 }])
      const pool = await repository.create(groupId, actorId, write())
      const restored = await createPostgresPoolRepository(sql).details(groupId, pool.id)
      expect(restored.count).toBe(2)
      expect(restored.progress).toHaveLength(3)
      expect(restored.progress.map((item) => item.size)).toEqual([2, 2, 2])
      expect(restored.accounts.every((item) => item.statisticsState === "stored")).toBe(true)
      expect(JSON.stringify(restored)).not.toContain("fixture-ciphertext")
      expect(JSON.stringify(restored)).not.toContain("fixture-do-not-expose")
      expect(restored.expiresAt.getTime() - restored.createdAt.getTime()).toBe(30 * 86_400_000)
      await expect(repository.create(groupId, actorId, write())).rejects.toBeInstanceOf(PoolError)
      const rows = await sql`select * from operation_account_pool`
      expect(rows).toHaveLength(1)
    },
  )
  databaseTest(
    "filters AND/OR, excludes transferred and recycled accounts, and rejects foreign IDs",
    async () => {
      const { repository, ids } = await setup()
      const filtered = await repository.sources(
        groupId,
        { ...cloud, tagInclude: ["red", "blue"] },
        1,
        10,
      )
      expect(filtered.total).toBe(0)
      expect(
        (
          await repository.sources(
            groupId,
            { ...cloud, tagInclude: ["red", "blue"], tagQueryMode: "OR" },
            1,
            10,
          )
        ).total,
      ).toBe(2)
      expect(
        (await repository.sources(groupId, { ...cloud, tagExclude: ["red"] }, 1, 10)).total,
      ).toBe(1)
      for (const index of [3, 4, 5, 6]) {
        await expect(
          repository.create(groupId, actorId, {
            ...write(`invalid-${index}`),
            mode: "selected",
            accountIds: [ids[index] ?? ""],
          }),
        ).rejects.toMatchObject({ code: "account_pool_invalid_source" })
      }
      const selected = ids[1]
      if (selected === undefined) throw new Error("Missing fixture account")
      const pool = await repository.create(groupId, actorId, {
        ...write(),
        mode: "selected",
        accountIds: [selected],
      })
      expect(pool.count).toBe(1)
      expect(pool.filterCondition).toBeNull()
      await expect(repository.details(otherGroup, pool.id)).rejects.toMatchObject({
        code: "account_pool_not_found",
      })
    },
  )
  databaseTest(
    "validates local devices and selections again inside the creation transaction",
    async () => {
      const { repository, sql, ids } = await setup()
      const local = { ...cloud, backType: "2" as const, deviceId }
      const pool = await repository.create(groupId, actorId, { ...write("local"), filter: local })
      expect(pool.deviceLabel).toBe("192.0.2.40-Pool fixture")
      expect(pool.count).toBe(1)
      await expect(
        repository.create(otherGroup, actorId, { ...write("foreign-device"), filter: local }),
      ).rejects.toMatchObject({ code: "account_pool_invalid_source" })
      const accountId = ids[1]
      if (accountId === undefined) throw new Error("Missing fixture account")
      await sql`update operation_account set transferred = true where id = ${accountId}`
      await expect(
        repository.create(groupId, actorId, {
          ...write("stale-selection"),
          mode: "selected",
          accountIds: [accountId],
        }),
      ).rejects.toMatchObject({ code: "account_pool_invalid_source" })
    },
  )
  databaseTest("serializes consumption, preserves retries and isolates rounds", async () => {
    const { repository, sql } = await setup()
    const pool = await repository.create(groupId, actorId, write())
    const member = (await repository.details(groupId, pool.id)).accounts[0]
    if (member === undefined) throw new Error("Missing fixture member")
    const consume = { accountId: member.id, round: 1, consumptionKey: "same-request" }
    await Promise.all([
      repository.consume(groupId, actorId, pool.id, consume),
      repository.consume(groupId, actorId, pool.id, consume),
    ])
    expect(await sql`select * from operation_account_pool_consumption`).toHaveLength(1)
    await expect(
      repository.consume(groupId, actorId, pool.id, {
        ...consume,
        consumptionKey: "different-request",
      }),
    ).rejects.toMatchObject({ code: "account_pool_consumption_conflict" })
    await repository.consume(groupId, actorId, pool.id, {
      ...consume,
      round: 2,
      consumptionKey: "round-two",
    })
    await expect(
      repository.consume(groupId, actorId, pool.id, { ...consume, round: 2 }),
    ).rejects.toMatchObject({ code: "account_pool_consumption_conflict" })
    expect((await repository.details(groupId, pool.id)).progress.map((item) => item.size)).toEqual([
      1, 1, 2,
    ])
    await sql`update operation_account_pool set expires_at = now() - interval '1 second' where id = ${pool.id}`
    await expect(
      repository.consume(groupId, actorId, pool.id, {
        ...consume,
        round: 3,
        consumptionKey: "expired",
      }),
    ).rejects.toMatchObject({ code: "account_pool_expired" })
    await repository.consume(groupId, actorId, pool.id, consume)
  })
  databaseTest("revalidates source and device eligibility without erasing snapshots", async () => {
    const { repository, sql, ids } = await setup()
    const accountId = ids[0]
    if (accountId === undefined) throw new Error("Missing local fixture")
    const pool = await repository.create(groupId, actorId, {
      ...write("revalidated-local"),
      filter: { ...cloud, backType: "2", deviceId },
    })
    const receipt = { accountId, round: 1, consumptionKey: "must-not-consume" }
    for (const status of ["disabled", "suspended"] as const) {
      await sql`update operation_account set status = ${status} where id = ${accountId}`
      await expect(repository.consume(groupId, actorId, pool.id, receipt)).rejects.toMatchObject({
        code: "account_pool_invalid_source",
      })
    }
    await sql`update operation_account set status = 'ready', transferred = true where id = ${accountId}`
    await expect(repository.consume(groupId, actorId, pool.id, receipt)).rejects.toMatchObject({
      code: "account_pool_invalid_source",
    })
    await sql`update operation_account set transferred = false where id = ${accountId}`
    await sql`update device set assignment_pending = true where id = ${deviceId}`
    await expect(repository.consume(groupId, actorId, pool.id, receipt)).rejects.toMatchObject({
      code: "account_pool_invalid_source",
    })
    await sql`update device set assignment_pending = false, enabled = false where id = ${deviceId}`
    await expect(repository.consume(groupId, actorId, pool.id, receipt)).rejects.toMatchObject({
      code: "account_pool_invalid_source",
    })
    await sql`update device set enabled = true where id = ${deviceId}`
    await sql`update operation_account set backup_type = 'private_cloud', device_id = null,
      device_instance_id = null where id = ${accountId}`
    await expect(repository.consume(groupId, actorId, pool.id, receipt)).rejects.toMatchObject({
      code: "account_pool_invalid_source",
    })
    const details = await repository.details(groupId, pool.id)
    expect(details.accounts).toHaveLength(1)
    expect(details.progress.map((round) => round.size)).toEqual([1, 1, 1])
    expect(await sql`select * from operation_account_pool_consumption`).toHaveLength(0)
  })
  databaseTest(
    "soft-deletes atomically without deleting accounts or consumption history",
    async () => {
      const { repository, sql } = await setup()
      const pool = await repository.create(groupId, actorId, write())
      await expect(
        repository.remove(groupId, actorId, [pool.id, crypto.randomUUID()]),
      ).rejects.toMatchObject({ code: "account_pool_not_found" })
      expect((await repository.list(groupId, PoolListSchema.parse({}))).total).toBe(1)
      expect(await repository.remove(groupId, actorId, [pool.id])).toBe(1)
      expect((await repository.list(groupId, PoolListSchema.parse({}))).total).toBe(0)
      expect(await sql`select * from operation_account_pool_member`).toHaveLength(2)
      expect(await sql`select * from operation_account`).toHaveLength(7)
      const replacement = await repository.create(groupId, actorId, write())
      expect(replacement.id).not.toBe(pool.id)
    },
  )
  databaseTest("caps all-mode creation at 3000 while paginating sources", async () => {
    const { repository, sql } = await setup()
    await sql`insert into operation_account(group_id,name,identifier,encrypted_secret,backup_type,tags)
      select ${groupId},'Batch fixture','bulk.' || n,'','private_cloud',array['bulk'] from generate_series(1,3002) n`
    const filter = { ...cloud, tag: ["bulk"] }
    const page = await repository.sources(groupId, filter, 2, 500)
    expect(page.items).toHaveLength(500)
    expect(page.total).toBe(3002)
    const pool = await repository.create(groupId, actorId, { ...write("bounded"), filter })
    expect(pool.count).toBe(3000)
  })
  databaseTest(
    "rolls back metadata and members if transactional audit persistence fails",
    async () => {
      const { repository, sql } = await setup()
      await sql`create function reject_pool_audit() returns trigger language plpgsql as $$
      begin if new.action = 'account-pool.create' then raise exception 'fixture audit failure'; end if; return new; end $$`
      await sql`create trigger reject_pool_audit before insert on audit_event for each row execute function reject_pool_audit()`
      await expect(repository.create(groupId, actorId, write())).rejects.toThrow()
      expect(await sql`select * from operation_account_pool`).toHaveLength(0)
      expect(await sql`select * from operation_account_pool_member`).toHaveLength(0)
    },
  )
})
