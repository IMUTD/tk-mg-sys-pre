import { afterEach, describe, expect, it } from "bun:test"

import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { MallError, type MallErrorCode, type RechargeInput } from "./model"
import { createPostgresMallRepository } from "./repository"

const databaseTest = hasConfiguredTestDatabase ? it : it.skip
const groupA = "11111111-1111-4111-8111-111111111111"
const groupB = "22222222-2222-4222-8222-222222222222"
const missingGroup = "33333333-3333-4333-8333-333333333333"
const unassignedGroup = "00000000-0000-4000-8000-000000000001"
const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

let database: MigratedTestDatabase | null = null
afterEach(async () => {
  await database?.close()
  database = null
})

const setup = async () => {
  database = await createMigratedTestDatabase()
  const sql = database.client
  await sql`insert into access_group(id,name) values (${groupA},'一组'),(${groupB},'二组 100%')`
  await sql`insert into app_user(id,email,display_name,password_hash,role)
    values (${actor},'platform@example.test','平台人员','unused','administrator')`
  return { repository: createPostgresMallRepository(sql), sql }
}

const recharge = (patch: Partial<RechargeInput> = {}): RechargeInput => ({
  amountYuan: "600",
  groupId: groupA,
  idempotencyKey: crypto.randomUUID(),
  remark: "银行流水 001",
  ...patch,
})

const expectMallError = async (run: Promise<unknown>, code: MallErrorCode): Promise<void> => {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(MallError)
  expect((error as MallError).code).toBe(code)
}

describe("mall wallet PostgreSQL", () => {
  databaseTest("credits points at 100 per yuan, in one order and one ledger entry", async () => {
    const { repository } = await setup()
    const result = await repository.recharge(actor, recharge({ amountYuan: "600.50" }))
    expect(result).toMatchObject({ balance: 60_050, points: 60_050, replayed: false })

    expect(await repository.listWallets([groupA])).toEqual([
      { balance: 60_050, groupId: groupA, name: "一组" },
    ])
    const orders = await repository.listOrders({ groupId: groupA, page: 1, pageSize: 20 })
    expect(orders.total).toBe(1)
    expect(orders.items[0]).toMatchObject({
      amountCents: 60_050,
      orderNo: result.orderNo,
      points: 60_050,
      status: "paid",
      type: "points",
    })
    expect(orders.items[0]?.paidAt).not.toBeNull()
    const ledger = await repository.listLedger({ groupId: groupA, page: 1, pageSize: 20 })
    expect(ledger.items).toHaveLength(1)
    expect(ledger.items[0]).toMatchObject({
      actorName: "平台人员",
      balance: 60_050,
      delta: 60_050,
      orderNo: result.orderNo,
      remark: "银行流水 001",
      type: "recharge",
    })
  })

  databaseTest("keeps every concurrent recharge and a consistent running balance", async () => {
    const { repository, sql } = await setup()
    await Promise.all(
      Array.from({ length: 25 }, () => repository.recharge(actor, recharge({ amountYuan: "1" }))),
    )
    expect((await repository.listWallets([groupA]))[0]?.balance).toBe(2_500)
    const rows = await sql<{ balance_after: string; delta: string }[]>`
      select delta, balance_after from mall_point_ledger order by balance_after
    `
    expect(rows.map((row) => Number(row.balance_after))).toEqual(
      Array.from({ length: 25 }, (_, index) => (index + 1) * 100),
    )
  })

  databaseTest("credits once when the same recharge is retried concurrently", async () => {
    const { repository, sql } = await setup()
    const input = recharge()
    const results = await Promise.all(
      Array.from({ length: 10 }, () => repository.recharge(actor, input)),
    )
    expect(results.filter((result) => !result.replayed)).toHaveLength(1)
    expect(new Set(results.map((result) => result.orderNo)).size).toBe(1)
    expect(new Set(results.map((result) => result.balance))).toEqual(new Set([60_000]))
    expect((await repository.listWallets([groupA]))[0]?.balance).toBe(60_000)
    const [orders] = await sql<{ count: string }[]>`select count(*) from mall_order`
    expect(Number(orders?.count)).toBe(1)
  })

  databaseTest("rejects a reused key with a different amount or kind", async () => {
    const { repository } = await setup()
    const input = recharge()
    await repository.recharge(actor, input)
    await expectMallError(
      repository.recharge(actor, { ...input, amountYuan: "1" }),
      "idempotency_conflict",
    )
    await expectMallError(
      repository.adjust(actor, {
        delta: 60_000,
        groupId: groupA,
        idempotencyKey: input.idempotencyKey,
        remark: "误用",
      }),
      "idempotency_conflict",
    )
    expect((await repository.listWallets([groupA]))[0]?.balance).toBe(60_000)
  })

  databaseTest("scopes idempotency keys to a group", async () => {
    const { repository } = await setup()
    const key = crypto.randomUUID()
    await repository.recharge(actor, recharge({ idempotencyKey: key }))
    const other = await repository.recharge(
      actor,
      recharge({ groupId: groupB, idempotencyKey: key }),
    )
    expect(other.replayed).toBe(false)
    expect(other.balance).toBe(60_000)
  })

  databaseTest("adjusts both ways and never lets the balance go negative", async () => {
    const { repository } = await setup()
    await repository.recharge(actor, recharge({ amountYuan: "1" }))
    const adjust = (delta: number, idempotencyKey = crypto.randomUUID()) =>
      repository.adjust(actor, { delta, groupId: groupA, idempotencyKey, remark: "冲正" })

    expect((await adjust(-40)).balance).toBe(60)
    expect((await adjust(15)).balance).toBe(75)
    await expectMallError(adjust(-76), "insufficient_balance")
    expect((await repository.listWallets([groupA]))[0]?.balance).toBe(75)

    const key = crypto.randomUUID()
    await adjust(-5, key)
    expect(await adjust(-5, key)).toMatchObject({ balance: 70, replayed: true })
    expect((await repository.listWallets([groupA]))[0]?.balance).toBe(70)
    const ledger = await repository.listLedger({ groupId: groupA, page: 1, pageSize: 20 })
    expect(ledger.total).toBe(4)
  })

  databaseTest("rolls back when the group does not exist", async () => {
    const { repository, sql } = await setup()
    await expectMallError(
      repository.recharge(actor, recharge({ groupId: missingGroup })),
      "group_not_found",
    )
    const [wallets] = await sql<{ count: string }[]>`select count(*) from mall_wallet`
    expect(Number(wallets?.count)).toBe(0)
  })

  databaseTest("refuses the system unassigned group", async () => {
    const { repository } = await setup()
    await expectMallError(
      repository.recharge(actor, recharge({ groupId: unassignedGroup })),
      "group_not_found",
    )
    expect(await repository.listWallets([unassignedGroup])).toEqual([])
  })

  databaseTest("rejects a negative balance at the database level", async () => {
    const { repository, sql } = await setup()
    await repository.recharge(actor, recharge({ amountYuan: "1" }))
    const failed = await sql`update mall_wallet set balance = -1 where group_id = ${groupA}`.then(
      () => false,
      () => true,
    )
    expect(failed).toBe(true)
  })

  databaseTest("isolates groups and filters, escaping LIKE wildcards", async () => {
    const { repository } = await setup()
    await repository.recharge(actor, recharge({ remark: "一组 100% 到账" }))
    await repository.recharge(actor, recharge({ groupId: groupB, remark: "二组 xx 到账" }))
    await repository.adjust(actor, {
      delta: 1,
      groupId: groupA,
      idempotencyKey: crypto.randomUUID(),
      remark: "补偿",
    })

    const own = await repository.listLedger({ groupId: groupA, page: 1, pageSize: 20 })
    expect(own.items.every((entry) => entry.groupId === groupA)).toBe(true)
    expect(own.total).toBe(2)

    const byType = await repository.listLedger({
      groupId: groupA,
      page: 1,
      pageSize: 20,
      type: "adjust",
    })
    expect(byType.items.map((entry) => entry.remark)).toEqual(["补偿"])

    const wildcard = await repository.listLedger({ keyword: "%", page: 1, pageSize: 20 })
    expect(wildcard.items.map((entry) => entry.remark)).toEqual(["一组 100% 到账"])

    const all = await repository.listLedger({ page: 1, pageSize: 1 })
    expect(all.items).toHaveLength(1)
    expect(all.total).toBe(3)

    const orders = await repository.listOrders({
      groupId: groupB,
      keyword: "积分充值",
      page: 1,
      pageSize: 20,
    })
    expect(orders.total).toBe(1)
    const none = await repository.listOrders({
      groupId: groupA,
      page: 1,
      pageSize: 20,
      type: "resource",
    })
    expect(none.total).toBe(0)
  })

  databaseTest("lists every group for the merchant with a zero balance by default", async () => {
    const { repository } = await setup()
    await repository.recharge(actor, recharge({ amountYuan: "2" }))
    expect(await repository.listAllWallets({ page: 1, pageSize: 20 })).toEqual({
      items: [
        { balance: 200, groupId: groupA, name: "一组" },
        { balance: 0, groupId: groupB, name: "二组 100%" },
      ],
      total: 2,
    })
    expect(
      (await repository.listAllWallets({ keyword: "%", page: 1, pageSize: 20 })).items.map(
        (wallet) => wallet.name,
      ),
    ).toEqual(["二组 100%"])
    expect(await repository.listWallets([])).toEqual([])
  })
})
