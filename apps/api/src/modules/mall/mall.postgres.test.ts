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

describe("mall purchase PostgreSQL", () => {
  const product = (
    repository: ReturnType<typeof createPostgresMallRepository>,
    patch: { stock?: number; pricePoints?: number; minQuantity?: number; enabled?: boolean } = {},
  ) =>
    repository.createProduct(actor, {
      enabled: patch.enabled ?? true,
      kind: "account",
      minQuantity: patch.minQuantity ?? 1,
      name: "日本满季度白号",
      pricePoints: patch.pricePoints ?? 100,
      spec: "100 个起售",
      stock: patch.stock ?? 10,
    })
  const buy = (
    repository: ReturnType<typeof createPostgresMallRepository>,
    productId: string,
    patch: { group?: string; key?: string; quantity?: number; expected?: number } = {},
  ) =>
    repository.purchase(actor, patch.group ?? groupA, {
      expectedUnitPoints: patch.expected ?? 100,
      idempotencyKey: patch.key ?? crypto.randomUUID(),
      productId,
      quantity: patch.quantity ?? 1,
    })
  const balanceOf = async (
    repository: ReturnType<typeof createPostgresMallRepository>,
    group = groupA,
  ) => (await repository.listWallets([group]))[0]?.balance
  const stockOf = async (
    repository: ReturnType<typeof createPostgresMallRepository>,
    productId: string,
  ) =>
    (await repository.listProducts({ enabledOnly: false, page: 1, pageSize: 100 })).items.find(
      (item) => item.id === productId,
    )?.stock

  databaseTest("deducts points and stock and records one order and ledger entry", async () => {
    const { repository } = await setup()
    await repository.recharge(actor, recharge({ amountYuan: "10" }))
    const { id } = await product(repository)
    const result = await buy(repository, id, { quantity: 3 })
    expect(result).toMatchObject({ balance: 700, points: 300, replayed: false })
    expect(await balanceOf(repository)).toBe(700)
    expect(await stockOf(repository, id)).toBe(7)

    const orders = await repository.listOrders({
      groupId: groupA,
      page: 1,
      pageSize: 20,
      type: "resource",
    })
    expect(orders.items[0]).toMatchObject({
      amountCents: 0,
      orderNo: result.orderNo,
      points: 300,
      product: "日本满季度白号",
      productKind: "account",
      quantity: 3,
      status: "pending_ship",
      unitPoints: 100,
    })
    const ledger = await repository.listLedger({
      groupId: groupA,
      page: 1,
      pageSize: 20,
      type: "spend",
    })
    expect(ledger.items[0]).toMatchObject({
      balance: 700,
      delta: -300,
      orderNo: result.orderNo,
      remark: "购买 日本满季度白号 × 3",
    })
  })

  databaseTest("never oversells when many groups race for the last units", async () => {
    const { repository } = await setup()
    await repository.recharge(actor, recharge({ amountYuan: "100" }))
    await repository.recharge(actor, recharge({ amountYuan: "100", groupId: groupB }))
    const { id } = await product(repository, { stock: 5 })
    const attempts = await Promise.allSettled(
      Array.from({ length: 30 }, (_, index) =>
        buy(repository, id, { group: index % 2 === 0 ? groupA : groupB }),
      ),
    )
    const rejected = attempts.filter((attempt) => attempt.status === "rejected")
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(5)
    for (const attempt of rejected) {
      expect((attempt.reason as MallError).code).toBe("insufficient_stock")
    }
    expect(await stockOf(repository, id)).toBe(0)
    const total = (await balanceOf(repository, groupA)) ?? 0
    expect(total + ((await balanceOf(repository, groupB)) ?? 0)).toBe(20_000 - 500)
  })

  databaseTest("never overdraws when one group races across products", async () => {
    const { repository } = await setup()
    await repository.recharge(actor, recharge({ amountYuan: "3" }))
    const first = await product(repository, { stock: 100 })
    const second = await product(repository, { stock: 100 })
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        buy(repository, index % 2 === 0 ? first.id : second.id),
      ),
    )
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(3)
    expect(await balanceOf(repository)).toBe(0)
    const stockLeft =
      ((await stockOf(repository, first.id)) ?? 0) + ((await stockOf(repository, second.id)) ?? 0)
    expect(stockLeft).toBe(197)
  })

  databaseTest("charges once when the same purchase is retried concurrently", async () => {
    const { repository, sql } = await setup()
    await repository.recharge(actor, recharge({ amountYuan: "10" }))
    const { id } = await product(repository)
    const key = crypto.randomUUID()
    const results = await Promise.all(
      Array.from({ length: 10 }, () => buy(repository, id, { key, quantity: 2 })),
    )
    expect(results.filter((result) => !result.replayed)).toHaveLength(1)
    expect(new Set(results.map((result) => result.orderId)).size).toBe(1)
    expect(results.every((result) => result.points === 200 && result.balance === 800)).toBe(true)
    expect(await balanceOf(repository)).toBe(800)
    expect(await stockOf(repository, id)).toBe(8)
    const [spent] = await sql<{ count: string }[]>`
      select count(*) from mall_point_ledger where type = 'spend'
    `
    expect(Number(spent?.count)).toBe(1)

    await expectMallError(buy(repository, id, { key, quantity: 3 }), "idempotency_conflict")
  })

  databaseTest("leaves everything unchanged when a purchase is refused", async () => {
    const { repository, sql } = await setup()
    await repository.recharge(actor, recharge({ amountYuan: "1" }))
    const { id } = await product(repository, { minQuantity: 2, stock: 5 })
    await expectMallError(buy(repository, id, { quantity: 1 }), "invalid_quantity")
    await expectMallError(buy(repository, id, { quantity: 6 }), "insufficient_stock")
    await expectMallError(buy(repository, id, { quantity: 2 }), "insufficient_balance")
    await expectMallError(buy(repository, id, { expected: 99, quantity: 2 }), "price_changed")
    await expectMallError(buy(repository, missingGroup), "product_not_found")
    const hidden = await product(repository, { enabled: false })
    await expectMallError(buy(repository, hidden.id), "product_unavailable")

    expect(await balanceOf(repository)).toBe(100)
    expect(await stockOf(repository, id)).toBe(5)
    const [orders] = await sql<{ count: string }[]>`
      select count(*) from mall_order where type = 'resource'
    `
    expect(Number(orders?.count)).toBe(0)
  })

  databaseTest("keeps the price on an old order when the product later changes", async () => {
    const { repository } = await setup()
    await repository.recharge(actor, recharge({ amountYuan: "10" }))
    const { id } = await product(repository)
    await buy(repository, id)
    await repository.updateProduct(id, { name: "改名", pricePoints: 999 })
    await expectMallError(buy(repository, id, { expected: 100 }), "price_changed")
    const orders = await repository.listOrders({
      groupId: groupA,
      page: 1,
      pageSize: 20,
      type: "resource",
    })
    expect(orders.items[0]).toMatchObject({
      points: 100,
      product: "日本满季度白号",
      unitPoints: 100,
    })
  })

  databaseTest("refunds points and stock exactly once when an order is cancelled", async () => {
    const { repository } = await setup()
    await repository.recharge(actor, recharge({ amountYuan: "10" }))
    const { id } = await product(repository)
    const { orderId } = await buy(repository, id, { quantity: 4 })

    const results = await Promise.all(
      Array.from({ length: 6 }, () => repository.cancelOrder(actor, orderId, "缺货")),
    )
    expect(results.filter((result) => !result.replayed)).toHaveLength(1)
    expect(await balanceOf(repository)).toBe(1_000)
    expect(await stockOf(repository, id)).toBe(10)

    const orders = await repository.listOrders({
      groupId: groupA,
      page: 1,
      pageSize: 20,
      status: "cancelled",
    })
    expect(orders.items[0]).toMatchObject({ cancelReason: "缺货", status: "cancelled" })
    expect(orders.items[0]?.cancelledAt).not.toBeNull()
    const refunds = await repository.listLedger({
      groupId: groupA,
      page: 1,
      pageSize: 20,
      type: "refund",
    })
    expect(refunds.items).toHaveLength(1)
    expect(refunds.items[0]).toMatchObject({
      balance: 1_000,
      delta: 400,
      remark: "订单取消退回：缺货",
    })
  })

  databaseTest("does not deadlock when purchases and cancellations overlap", async () => {
    const { repository } = await setup()
    await repository.recharge(actor, recharge({ amountYuan: "100" }))
    const { id } = await product(repository, { stock: 40 })
    const bought = await Promise.all(Array.from({ length: 10 }, () => buy(repository, id)))
    await Promise.all([
      ...bought.map((order) => repository.cancelOrder(actor, order.orderId, "取消")),
      ...Array.from({ length: 10 }, () => buy(repository, id)),
    ])
    expect(await balanceOf(repository)).toBe(10_000 - 1_000)
    expect(await stockOf(repository, id)).toBe(30)
  })

  databaseTest("refuses to cancel a recharge, a shipped order or an unknown order", async () => {
    const { repository, sql } = await setup()
    await repository.recharge(actor, recharge({ amountYuan: "10" }))
    const paid = await repository.listOrders({ groupId: groupA, page: 1, pageSize: 1 })
    await expectMallError(
      repository.cancelOrder(actor, paid.items[0]?.id ?? "", "x"),
      "order_not_cancellable",
    )
    await expectMallError(repository.cancelOrder(actor, missingGroup, "x"), "order_not_found")

    const { id } = await product(repository)
    const { orderId } = await buy(repository, id)
    await sql`update mall_order set status = 'shipped' where id = ${orderId}`
    await expectMallError(repository.cancelOrder(actor, orderId, "x"), "order_not_cancellable")
    expect(await balanceOf(repository)).toBe(900)
  })

  databaseTest("adjusts stock by delta without losing concurrent purchases", async () => {
    const { repository } = await setup()
    await repository.recharge(actor, recharge({ amountYuan: "100" }))
    const { id } = await product(repository, { stock: 10 })
    await Promise.all([
      buy(repository, id),
      buy(repository, id),
      repository.updateProduct(id, { stockDelta: 5 }),
      repository.updateProduct(id, { stockDelta: 5 }),
    ])
    expect(await stockOf(repository, id)).toBe(18)
    await expectMallError(repository.updateProduct(id, { stockDelta: -19 }), "insufficient_stock")
    await expectMallError(
      repository.updateProduct(missingGroup, { enabled: false }),
      "product_not_found",
    )
  })

  databaseTest("lists only enabled products to buyers and filters by kind", async () => {
    const { repository } = await setup()
    await product(repository)
    await product(repository, { enabled: false })
    await repository.createProduct(actor, {
      enabled: true,
      kind: "proxy",
      minQuantity: 1,
      name: "全球动态住宅",
      pricePoints: 200,
      spec: "",
      stock: 1,
    })
    const page = { page: 1, pageSize: 20 }
    expect((await repository.listProducts({ ...page, enabledOnly: false })).total).toBe(3)
    expect((await repository.listProducts({ ...page, enabledOnly: true })).total).toBe(2)
    const proxies = await repository.listProducts({ ...page, enabledOnly: true, kind: "proxy" })
    expect(proxies.items.map((item) => item.name)).toEqual(["全球动态住宅"])
  })

  databaseTest("enforces order shape and non-negative stock in the database", async () => {
    const { repository, sql } = await setup()
    const { id } = await product(repository)
    const failed = (query: PromiseLike<unknown>) =>
      Promise.resolve(query).then(
        () => false,
        () => true,
      )
    expect(await failed(sql`update mall_product set stock = -1 where id = ${id}`)).toBe(true)
    expect(
      await failed(sql`
        insert into mall_order (order_no, group_id, type, status, title, product, amount_cents,
          points, payment_method, created_by, idempotency_key)
        values ('X1', ${groupA}, 'resource', 'pending_ship', 't', 'p', 0, 100, 'points', ${actor},
          'bad-shape-key')
      `),
    ).toBe(true)
  })
})
