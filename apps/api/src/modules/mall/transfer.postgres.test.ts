import { afterEach, describe, expect, it } from "bun:test"

import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { OperationDeleteConflictError } from "../../lib/operation-claim-guard"
import { createAccountDesk } from "../accounts/desk"
import { createPostgresAccountRepository } from "../accounts/repository"
import { createDispatchRepository } from "../dispatch/repository"
import { MallError, type MallErrorCode } from "./model"
import { createPostgresMallRepository } from "./repository"

const databaseTest = hasConfiguredTestDatabase ? it : it.skip
const buyerA = "11111111-1111-4111-8111-111111111111"
const buyerB = "22222222-2222-4222-8222-222222222222"
const stock = "33333333-3333-4333-8333-333333333333"
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
  await sql`insert into access_group(id,name)
    values (${buyerA},'买家一'),(${buyerB},'买家二'),(${stock},'平台库存')`
  await sql`insert into app_user(id,email,display_name,password_hash,role)
    values (${actor},'platform@example.test','平台人员','unused','administrator')`
  const repository = createPostgresMallRepository(sql)

  const account = async (
    identifier: string,
    patch: { group?: string; status?: string; deleted?: boolean; proxyId?: string } = {},
  ) => {
    const rows = await sql<{ id: string }[]>`
      insert into operation_account
        (group_id, identifier, name, encrypted_secret, status, deleted, tags, note, proxy_id)
      values (${patch.group ?? stock}, ${identifier}, ${identifier}, ${`secret-${identifier}`},
        ${patch.status ?? "ready"}, ${patch.deleted ?? false}, ${["内部标签"]}, '内部备注',
        ${patch.proxyId ?? null})
      returning id`
    return rows[0]?.id ?? ""
  }
  const proxy = async (
    name: string,
    patch: { group?: string; status?: string; expiredAt?: string } = {},
  ) => {
    const configuration = {
      acceleratorId: null,
      acceleratorIds: [],
      expiredAt: patch.expiredAt ?? null,
      favorite: false,
      host: "203.0.113.1",
      kind: "static",
      port: 1080,
      protocol: "socks5",
      refreshUrl: "",
      region: "",
      safe: false,
      save: false,
      tun: false,
      turbo: true,
      v2Protocol: null,
    }
    const rows = await sql<{ id: string }[]>`
      insert into operation_proxy
        (group_id, name, endpoint, encrypted_credentials, status, tags, note, configuration)
      values (${patch.group ?? stock}, ${name}, '203.0.113.1:1080', ${`secret-${name}`},
        ${patch.status ?? "ready"}, ${["内部标签"]}, '内部备注', ${sql.json(configuration)})
      returning id`
    return rows[0]?.id ?? ""
  }
  const order = async (kind: "account" | "proxy", quantity: number, group = buyerA) => {
    await repository.recharge(actor, {
      amountYuan: "1000",
      groupId: group,
      idempotencyKey: crypto.randomUUID(),
      remark: "打款",
    })
    const product = await repository.createProduct(actor, {
      enabled: true,
      inventoryGroupId: null,
      kind,
      minQuantity: 1,
      name: kind === "account" ? "白号" : "住宅代理",
      pricePoints: 100,
      spec: "",
      stock: 100,
    })
    const result = await repository.purchase(actor, group, {
      expectedUnitPoints: 100,
      idempotencyKey: crypto.randomUUID(),
      productId: product.id,
      quantity,
    })
    return { orderId: result.orderId, productId: product.id }
  }
  return { account, order, proxy, repository, sql }
}

const failure = async (run: Promise<unknown>): Promise<MallError> => {
  try {
    await run
  } catch (error) {
    if (error instanceof MallError) return error
    throw error
  }
  throw new Error("expected a MallError")
}

const failureMessage = async (run: PromiseLike<unknown>): Promise<string> => {
  try {
    await run
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error("expected the write to fail")
}

const expectCode = async (run: Promise<unknown>, code: MallErrorCode): Promise<MallError> => {
  const error = await failure(run)
  expect(error.code).toBe(code)
  return error
}

const seedTask = async (
  sql: Awaited<ReturnType<typeof setup>>["sql"],
  taskId: string,
  accountId: string,
  status = "queued",
): Promise<void> => {
  const deviceId = crypto.randomUUID()
  await sql`insert into device(id, group_id, host, model, name)
    values (${deviceId}, ${stock}, '192.0.2.11', 'fixture', '任务机')`
  await sql`insert into execution_task (
      id, group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key,
      parameters, account_id, status
    ) values (
      ${taskId}, ${stock}, ${actor}, ${deviceId}, ${taskId}, 'fingerprint', '运行中', 'box-agent',
      '[]'::jsonb, ${accountId}, ${status}
    )`
}

const groupOf = async (
  sql: Awaited<ReturnType<typeof setup>>["sql"],
  table: "operation_account" | "operation_proxy",
  id: string,
) =>
  (
    await sql<{ groupId: string }[]>`
    select group_id as "groupId" from ${sql(table)} where id = ${id}`
  )[0]?.groupId

describe("order shipping PostgreSQL", () => {
  databaseTest(
    "moves accounts to the buyer and leaves the source group's bindings behind",
    async () => {
      const { account, order, proxy, repository, sql } = await setup()
      const sourceProxy = await proxy("库存代理")
      const first = await account("jp_001", { proxyId: sourceProxy })
      const second = await account("jp_002")
      const deviceId = crypto.randomUUID()
      await sql`insert into device(id, group_id, host, model, name)
        values (${deviceId}, ${stock}, '192.0.2.10', 'fixture', '库存机')`
      const instances = await sql<{ id: string }[]>`
        insert into device_instance(device_id, instance_index, label)
        values (${deviceId}, 1, '1') returning id`
      await sql`update operation_account
        set device_id = ${deviceId}, device_instance_id = ${instances[0]?.id ?? ""}, backup_device_id = ${deviceId}, backup_type = 'local',
          backup_key = 'key', backup_name = 'name', backup_slot = '1', backup_sha256 = 'sha',
          online = true, encrypted_totp = 'totp', encrypted_transfer_key = 'code',
          transfer_key_hash = 'hash'
        where id = ${first}`
      const transfers = await sql<{ id: string }[]>`
        insert into operation_account_transfer (group_id, created_by, code_hash, encrypted_code)
        values (${stock}, ${actor}, 'hash', 'code') returning id`
      await sql`insert into operation_account_transfer_item (transfer_id, account_id, position)
        values (${transfers[0]?.id ?? ""}, ${first}, 0)`
      const { orderId, productId } = await order("account", 2)
      const before = await repository.listWallets([buyerA])

      const result = await repository.shipOrder(actor, orderId, {
        ids: [first, second],
        sourceGroupId: stock,
      })
      expect(result).toMatchObject({ groupId: buyerA, moved: 2, replayed: false })

      const rows = await sql`select * from operation_account where id = ${first}`
      expect(rows[0]).toMatchObject({
        backup_device_id: null,
        backup_key: "",
        backup_name: "",
        backup_sha256: "",
        backup_slot: "",
        backup_type: null,
        device_id: null,
        device_instance_id: null,
        encrypted_secret: "secret-jp_001",
        encrypted_totp: "totp",
        encrypted_transfer_key: "",
        group_id: buyerA,
        identifier: "jp_001",
        note: "",
        online: false,
        proxy_id: null,
        tags: [],
        transfer_key_hash: null,
      })
      // 卖家手里的旧转移码不能再把账号转走。
      expect(
        await sql`select 1 from operation_account_transfer_item where account_id = ${first}`,
      ).toHaveLength(0)
      expect(
        (
          await sql<{ status: string }[]>`
            select status from operation_account_transfer where id = ${transfers[0]?.id ?? ""}`
        )[0]?.status,
      ).toBe("revoked")

      const orders = await repository.listOrders({
        groupId: buyerA,
        page: 1,
        pageSize: 20,
        type: "resource",
      })
      expect(orders.items[0]?.status).toBe("shipped")
      expect(orders.items[0]?.shippedAt).not.toBeNull()
      // 积分和库存在下单时已经处理，发货不再动。
      expect(await repository.listWallets([buyerA])).toEqual(before)
      const products = await repository.listProducts({ enabledOnly: false, page: 1, pageSize: 10 })
      expect(products.items.find((item) => item.id === productId)?.stock).toBe(98)

      const shipment = await repository.listShipment(buyerA, orderId)
      expect(shipment.map(({ kind, name }) => ({ kind, name }))).toEqual([
        { kind: "account", name: "jp_001" },
        { kind: "account", name: "jp_002" },
      ])
      const records = await repository.listTransfers({ orderId, page: 1, pageSize: 20 })
      expect(records.total).toBe(2)
      expect(records.items[0]).toMatchObject({
        movedByName: "平台人员",
        sourceGroupName: "平台库存",
        targetGroupName: "买家一",
      })
    },
    60000,
  )

  databaseTest(
    "keeps the source's history and clears every backup field",
    async () => {
      const { account, order, proxy, repository, sql } = await setup()
      const item = await account("jp_001")
      const usedProxy = await proxy("用过的代理")
      const deviceId = crypto.randomUUID()
      await sql`insert into device(id, group_id, host, model, name)
        values (${deviceId}, ${stock}, '192.0.2.12', 'fixture', '旧任务机')`
      await sql`update operation_account set backup_type = 'cloud', backup_name = 'name',
        backup_key = 'key', backup_slot = '1', backup_sha256 = 'sha' where id = ${item}`
      await sql`alter table operation_dispatch drop constraint operation_dispatch_chain_xor`
      const dispatches = await sql<{ id: string }[]>`
        insert into operation_dispatch (group_id, requester_id, name, selection)
        values (${stock}, ${actor}, '历史', '{}'::jsonb) returning id`
      await sql`insert into operation_dispatch_item
          (dispatch_id, group_id, account_id, proxy_id, device_id, instance_index, status)
        values (${dispatches[0]?.id ?? ""}, ${stock}, ${item}, ${usedProxy}, ${deviceId}, 1, 'started')`
      const taskId = crypto.randomUUID()
      await seedTask(sql, taskId, item, "succeeded")

      const accountOrder = await order("account", 1)
      await repository.shipOrder(actor, accountOrder.orderId, {
        ids: [item],
        sourceGroupId: stock,
      })
      const proxyOrder = await order("proxy", 1)
      await repository.shipOrder(actor, proxyOrder.orderId, {
        ids: [usedProxy],
        sourceGroupId: stock,
      })
      const items = await sql<{ accountId: string | null; proxyId: string | null }[]>`
        select account_id as "accountId", proxy_id as "proxyId" from operation_dispatch_item`
      expect([...items]).toEqual([{ accountId: item, proxyId: usedProxy }])
      const tasks = await sql<{ accountId: string | null }[]>`
        select account_id as "accountId" from execution_task where id = ${taskId}`
      expect([...tasks]).toEqual([{ accountId: item }])
      const rows = await sql`select * from operation_account where id = ${item}`
      expect(rows[0]).toMatchObject({
        backup_key: "",
        backup_name: "",
        backup_sha256: "",
        backup_slot: "",
        backup_type: null,
      })

      // 来源设备照常能删，买家永久删除账号时得到明确的冲突而不是 500。
      const accounts = createPostgresAccountRepository(sql)
      await sql`update operation_account set deleted = true, deleted_at = now() where id = ${item}`
      await expect(accounts.delete(buyerA as never, [item as never])).rejects.toBeInstanceOf(
        OperationDeleteConflictError,
      )
      await sql`delete from device where id = ${deviceId}`
    },
    60000,
  )

  databaseTest(
    "retries the same shipment safely and refuses a second batch",
    async () => {
      const { account, order, repository, sql } = await setup()
      const first = await account("jp_001")
      const other = await account("jp_002")
      const { orderId } = await order("account", 1)
      await repository.shipOrder(actor, orderId, { ids: [first], sourceGroupId: stock })
      expect(
        await repository.shipOrder(actor, orderId, { ids: [first], sourceGroupId: stock }),
      ).toMatchObject({ moved: 0, replayed: true })
      await expectCode(
        repository.shipOrder(actor, orderId, { ids: [other], sourceGroupId: stock }),
        "order_not_shippable",
      )
      expect(await groupOf(sql, "operation_account", other)).toBe(stock)
      expect((await repository.listTransfers({ orderId, page: 1, pageSize: 20 })).total).toBe(1)
    },
    60000,
  )

  databaseTest(
    "refuses a wrong count, the buyer's own group, an unready account and a finished order",
    async () => {
      const { account, order, repository, sql } = await setup()
      const ok = await account("ok")
      const banned = await account("banned", { status: "suspended" })
      const { orderId } = await order("account", 2)
      await expectCode(
        repository.shipOrder(actor, orderId, { ids: [ok], sourceGroupId: stock }),
        "ship_quantity_mismatch",
      )
      await expectCode(
        repository.shipOrder(actor, orderId, { ids: [ok, banned], sourceGroupId: buyerA }),
        "transfer_same_group",
      )
      const unready = await expectCode(
        repository.shipOrder(actor, orderId, { ids: [ok, banned], sourceGroupId: stock }),
        "resource_not_ready",
      )
      expect(unready.items).toEqual(["banned"])
      // 一个不行就全部不动。
      expect(await groupOf(sql, "operation_account", ok)).toBe(stock)

      await repository.cancelOrder(actor, orderId, "买家不要了")
      const another = await account("another")
      await expectCode(
        repository.shipOrder(actor, orderId, { ids: [ok, another], sourceGroupId: stock }),
        "order_not_shippable",
      )
      await expectCode(
        repository.shipOrder(actor, crypto.randomUUID(), { ids: [ok], sourceGroupId: stock }),
        "order_not_found",
      )
      const ledger = await repository.listLedger({ groupId: buyerA, page: 1, pageSize: 20 })
      expect(ledger.items.find((item) => item.type === "refund")).toBeDefined()
    },
    60000,
  )

  databaseTest(
    "refuses accounts in use, naming them and moving nothing",
    async () => {
      const { account, order, repository, sql } = await setup()
      const idle = await account("idle")
      const leased = await account("leased")
      const allocated = await account("allocated")
      const drafted = await account("drafted")
      const running = await account("running")
      await sql`insert into operation_account_lease (account_id, group_id, leased_by_user_id)
        values (${leased}, ${stock}, ${actor})`
      const resources = await sql<{ id: string }[]>`
        insert into operation_resource (group_id, category, name)
        values (${stock}, 'text', '文案') returning id`
      await sql`insert into operation_resource_allocation
          (account_id, allocated_by_user_id, group_id, resource_id)
        values (${allocated}, ${actor}, ${stock}, ${resources[0]?.id ?? ""})`
      // 这里只关心派发项是否占用账号，不需要造一条完整的行为链。
      await sql`alter table operation_dispatch drop constraint operation_dispatch_chain_xor`
      const dispatches = await sql<{ id: string }[]>`
        insert into operation_dispatch (group_id, requester_id, name, selection)
        values (${stock}, ${actor}, '草稿', '{}'::jsonb) returning id`
      await sql`insert into operation_dispatch_item (dispatch_id, group_id, account_id, status)
        values (${dispatches[0]?.id ?? ""}, ${stock}, ${drafted}, 'ready')`
      const taskId = crypto.randomUUID()
      await seedTask(sql, taskId, running, "cancel_requested")
      // 派发项必须和账号同分组，跨分组的写入在数据库层就被拒绝。
      expect(
        await failureMessage(
          sql`insert into operation_dispatch_item (dispatch_id, group_id, account_id, status)
            values (${dispatches[0]?.id ?? ""}, ${buyerA}, ${idle}, 'ready')`,
        ),
      ).toContain("account does not belong")

      const { orderId } = await order("account", 5)
      const error = await expectCode(
        repository.shipOrder(actor, orderId, {
          ids: [idle, leased, allocated, drafted, running],
          sourceGroupId: stock,
        }),
        "resource_in_use",
      )
      expect([...error.items].sort()).toEqual(["allocated", "drafted", "leased", "running"])
      expect(await groupOf(sql, "operation_account", idle)).toBe(stock)

      const listed = await repository.listTransferable("account", {
        groupId: stock,
        page: 1,
        pageSize: 20,
      })
      expect(listed.total).toBe(5)
      const byName = new Map(listed.items.map((item) => [item.name, item]))
      expect(byName.get("idle")).toMatchObject({ blockedBy: null, shippable: true })
      expect(byName.get("running")).toMatchObject({ blockedBy: "in_use", shippable: false })
      const shippable = await repository.listTransferable("account", {
        groupId: stock,
        page: 1,
        pageSize: 20,
        shippableOnly: true,
      })
      expect(shippable.items.map((item) => item.name)).toEqual(["idle"])
      expect(shippable.total).toBe(1)
      // 平台方列表也不能带出凭据。
      expect(JSON.stringify(listed.items)).not.toContain("secret-")
    },
    60000,
  )

  databaseTest(
    "reports identifiers already in the buyer's group, including the recycle bin",
    async () => {
      const { account, order, repository, sql } = await setup()
      const clash = await account("jp_001")
      await account("jp_001", { deleted: true, group: buyerA })
      const { orderId } = await order("account", 1)
      const error = await expectCode(
        repository.shipOrder(actor, orderId, { ids: [clash], sourceGroupId: stock }),
        "transfer_conflict",
      )
      expect(error.items).toEqual(["jp_001"])
      expect(await groupOf(sql, "operation_account", clash)).toBe(stock)
    },
    60000,
  )

  databaseTest(
    "ships an account to one buyer when two orders race for it",
    async () => {
      const { account, order, repository, sql } = await setup()
      for (let round = 0; round < 5; round++) {
        const contested = await account(`race_${round}`)
        const first = await order("account", 1, buyerA)
        const second = await order("account", 1, buyerB)
        const [a, b] = await Promise.allSettled([
          repository.shipOrder(actor, first.orderId, { ids: [contested], sourceGroupId: stock }),
          repository.shipOrder(actor, second.orderId, { ids: [contested], sourceGroupId: stock }),
        ])
        const results = [a, b]
        expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1)
        const lost = results.find((item) => item.status === "rejected")
        expect(lost?.status === "rejected" && (lost.reason as MallError).code).toBe(
          "resource_changed",
        )
        expect(await groupOf(sql, "operation_account", contested)).toBe(
          a?.status === "fulfilled" ? buyerA : buyerB,
        )
        expect(
          await sql`select 1 from mall_resource_transfer where entity_id = ${contested}`,
        ).toHaveLength(1)
      }
    },
    90000,
  )

  databaseTest(
    "lets only one of shipping and cancelling win",
    async () => {
      const { account, order, repository, sql } = await setup()
      for (let round = 0; round < 5; round++) {
        const item = await account(`race_${round}`)
        const { orderId } = await order("account", 1)
        const results = await Promise.allSettled([
          repository.shipOrder(actor, orderId, { ids: [item], sourceGroupId: stock }),
          repository.cancelOrder(actor, orderId, "并发取消"),
        ])
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
        const orders = await repository.listOrders({ groupId: buyerA, page: 1, pageSize: 100 })
        const current = orders.items.find((row) => row.id === orderId)
        const refunds = await sql`
          select 1 from mall_point_ledger where idempotency_key = ${`refund:${orderId}`}`
        if (results[0]?.status === "fulfilled") {
          expect(current?.status).toBe("shipped")
          expect(refunds).toHaveLength(0)
          expect(await groupOf(sql, "operation_account", item)).toBe(buyerA)
        } else {
          expect(current?.status).toBe("cancelled")
          expect(refunds).toHaveLength(1)
          expect(await groupOf(sql, "operation_account", item)).toBe(stock)
        }
      }
    },
    90000,
  )

  databaseTest(
    "ships proxies, keeps their credentials and clears the source's labels",
    async () => {
      const { order, proxy, repository, sql } = await setup()
      const id = await proxy("东京住宅")
      await sql`update operation_proxy set probe_token = ${crypto.randomUUID()},
        probe_started_at = now() - interval '5 minutes' where id = ${id}`
      const deletedOwner = await sql<{ id: string }[]>`
        insert into operation_account
          (group_id, identifier, name, encrypted_secret, deleted, proxy_id)
        values (${stock}, 'old', 'old', 's', true, ${id}) returning id`
      const { orderId } = await order("proxy", 1)
      await repository.shipOrder(actor, orderId, { ids: [id], sourceGroupId: stock })
      const rows = await sql`select * from operation_proxy where id = ${id}`
      expect(rows[0]).toMatchObject({
        encrypted_credentials: "secret-东京住宅",
        group_id: buyerA,
        note: "",
        probe_started_at: null,
        probe_token: null,
        tags: [],
      })
      const versions = await sql<{ revision: string }[]>`
        select revision from operation_proxy where id = ${id}`
      expect(Number(versions[0]?.revision)).toBe(2)
      expect(
        (
          await sql<{ proxyId: string | null }[]>`
            select proxy_id as "proxyId" from operation_account
            where id = ${deletedOwner[0]?.id ?? ""}`
        )[0]?.proxyId,
      ).toBeNull()
    },
    60000,
  )

  databaseTest(
    "refuses proxies that are bound, linked, expired or disabled",
    async () => {
      const { account, order, proxy, repository, sql } = await setup()
      const bound = await proxy("已绑定")
      await account("user", { proxyId: bound })
      const parent = await proxy("链路头")
      const turbo = await proxy("加速节点")
      await sql`insert into operation_proxy_accelerator (group_id, proxy_id, accelerator_id, position)
        values (${stock}, ${parent}, ${turbo}, 0)`
      const expired = await proxy("已过期", { expiredAt: "2020-01-01T00:00:00.000Z" })
      const disabled = await proxy("已停用", { status: "disabled" })
      const { orderId } = await order("proxy", 1)
      const ship = (id: string) =>
        repository.shipOrder(actor, orderId, { ids: [id], sourceGroupId: stock })
      expect((await expectCode(ship(bound), "resource_has_bindings")).items).toEqual(["已绑定"])
      await expectCode(ship(parent), "resource_accelerator_linked")
      await expectCode(ship(turbo), "resource_accelerator_linked")
      await expectCode(ship(expired), "resource_not_ready")
      await expectCode(ship(disabled), "resource_not_ready")

      const listed = await repository.listTransferable("proxy", {
        groupId: stock,
        page: 1,
        pageSize: 20,
      })
      const byName = new Map(listed.items.map((item) => [item.name, item]))
      expect(byName.get("已绑定")?.blockedBy).toBe("has_bindings")
      expect(byName.get("加速节点")?.blockedBy).toBe("accelerator_linked")
      expect(byName.get("已过期")).toMatchObject({ blockedBy: null, shippable: false })
      expect(byName.get("已绑定")?.detail).toBe("203.0.113.1:1080")
      expect(JSON.stringify(listed.items)).not.toContain("secret-")
    },
    60000,
  )
})

describe("transfers racing with other writers PostgreSQL", () => {
  const seedCode = async (
    sql: Awaited<ReturnType<typeof setup>>["sql"],
    hash: string,
    accountIds: readonly string[],
  ) => {
    const rows = await sql<{ id: string }[]>`
      insert into operation_account_transfer (group_id, created_by, code_hash, encrypted_code)
      values (${stock}, ${actor}, ${hash}, 'sealed') returning id`
    for (const [position, accountId] of accountIds.entries()) {
      await sql`insert into operation_account_transfer_item (transfer_id, account_id, position)
        values (${rows[0]?.id ?? ""}, ${accountId}, ${position})`
    }
  }

  /** 让发货卡在写转移记录这一步：账号或代理的锁已经拿到，事务还没提交。 */
  const holdTransferRecords = async (sql: Awaited<ReturnType<typeof setup>>["sql"]) => {
    let release = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const blocked = sql.begin(async (transaction) => {
      await transaction`lock table mall_resource_transfer in exclusive mode`
      await released
    })
    await Bun.sleep(100)
    return async () => {
      release()
      await blocked
    }
  }

  databaseTest(
    "does not let a pending redeem take an account that was just shipped",
    async () => {
      const { account, order, repository, sql } = await setup()
      const sold = await account("sold")
      const kept = await account("kept")
      await seedCode(sql, "code-1", [sold, kept])
      const { orderId } = await order("account", 1)
      const desk = createAccountDesk(sql)
      const unblock = await holdTransferRecords(sql)
      const ship = repository.shipOrder(actor, orderId, { ids: [sold], sourceGroupId: stock })
      await Bun.sleep(200)
      const redeem = desk.redeemTransfer(buyerB as never, "code-1")
      await Bun.sleep(200)
      await unblock()
      await ship
      expect(await redeem).toBe(1)
      expect(await groupOf(sql, "operation_account", sold)).toBe(buyerA)
      expect(await groupOf(sql, "operation_account", kept)).toBe(buyerB)
    },
    60000,
  )

  databaseTest(
    "reports a changed source when a redeem got there first",
    async () => {
      const { account, order, repository, sql } = await setup()
      const contested = await account("contested")
      await seedCode(sql, "code-1", [contested])
      const { orderId } = await order("account", 1)
      const desk = createAccountDesk(sql)
      let release = () => {}
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      // 先锁住账号，让兑换拿到转移码后停在账号锁上。
      const blocked = sql.begin(async (transaction) => {
        await transaction`select id from operation_account where id = ${contested} for update`
        await released
      })
      await Bun.sleep(100)
      const redeem = desk.redeemTransfer(buyerB as never, "code-1")
      await Bun.sleep(200)
      const ship = failure(
        repository.shipOrder(actor, orderId, { ids: [contested], sourceGroupId: stock }),
      )
      await Bun.sleep(200)
      release()
      await blocked
      expect(await redeem).toBe(1)
      expect((await ship).code).toBe("resource_changed")
      expect(await groupOf(sql, "operation_account", contested)).toBe(buyerB)
    },
    60000,
  )

  databaseTest(
    "never leaves a shipped account on an active transfer code",
    async () => {
      const { account, order, repository, sql } = await setup()
      const desk = createAccountDesk(sql)
      for (let round = 0; round < 5; round++) {
        const item = await account(`merge_${round}`)
        await seedCode(sql, `code-${round}`, [item])
        const { orderId } = await order("account", 1)
        const [shipped] = await Promise.allSettled([
          repository.shipOrder(actor, orderId, { ids: [item], sourceGroupId: stock }),
          desk.mergeTransfers(stock as never, actor, [`code-${round}`], {
            encryptedCode: "sealed",
            hash: `merged-${round}`,
          }),
        ])
        if (shipped?.status === "fulfilled") {
          expect(await groupOf(sql, "operation_account", item)).toBe(buyerA)
          expect(
            await sql`
              select 1 from operation_account_transfer_item item
              join operation_account_transfer transfer on transfer.id = item.transfer_id
              where item.account_id = ${item} and transfer.status = 'active'`,
          ).toHaveLength(0)
        }
      }
    },
    90000,
  )

  databaseTest(
    "auto-retries a failed task only while the account is still in the group",
    async () => {
      const { account, order, repository, sql } = await setup()
      const deviceId = crypto.randomUUID()
      await sql`insert into device(id, group_id, host, model, name)
        values (${deviceId}, ${stock}, '192.0.2.13', 'fixture', '任务机')`
      const instances = await sql<{ id: string }[]>`
        insert into device_instance(device_id, instance_index, label)
        values (${deviceId}, 1, '1') returning id`
      await sql`alter table operation_dispatch drop constraint operation_dispatch_chain_xor`
      const failedTask = async (accountId: string) => {
        const dispatches = await sql<{ id: string }[]>`
          insert into operation_dispatch (group_id, requester_id, name, selection, status)
          values (${stock}, ${actor}, '任务', '{}'::jsonb, 'started') returning id`
        const items = await sql<{ id: string }[]>`
          insert into operation_dispatch_item
            (dispatch_id, group_id, account_id, device_id, instance_index, instance_id, status)
          values (${dispatches[0]?.id ?? ""}, ${stock}, ${accountId}, ${deviceId}, 1,
            ${instances[0]?.id ?? ""}, 'started')
          returning id`
        const itemId = items[0]?.id ?? ""
        await sql`insert into operation_dispatch_step
            (item_id, sequence, skill, sources, scopes, parameters, fill_status, guards, after_ms)
          values (${itemId}, 0, 'LoginAccount', '{"password":"account.secret"}'::jsonb,
            '{"password":"external"}'::jsonb, '{"password":"sealed"}'::jsonb, 'complete',
            '[]'::jsonb, 0)`
        const taskId = crypto.randomUUID()
        await sql`insert into execution_task
            (id, group_id, requester_id, device_id, account_id, idempotency_key, fingerprint, name,
             executor_key, parameters, status, dispatch_item_id, auto_retry, auto_retry_limit,
             stage_position, repeat_index, repeat_count, stage_count)
          values (${taskId}, ${stock}, ${actor}, ${deviceId}, ${accountId}, ${`dispatch:${itemId}`},
            'fingerprint', '任务', 'box-agent', '[]'::jsonb, 'failed', ${itemId}, true, 3,
            0, 0, 1, 1)`
        return { itemId, taskId }
      }
      const dispatch = createDispatchRepository(sql, {
        decrypt: (value: string) => value,
        encrypt: (value: string) => value,
      })
      const tasksOf = async (itemId: string) =>
        sql`select id from execution_task where dispatch_item_id = ${itemId}`

      const kept = await failedTask(await account("kept"))
      await dispatch.autoReplay(stock, kept.taskId)
      expect(await tasksOf(kept.itemId)).toHaveLength(2)

      const soldId = await account("sold")
      const sold = await failedTask(soldId)
      const { orderId } = await order("account", 1)
      await repository.shipOrder(actor, orderId, { ids: [soldId], sourceGroupId: stock })
      await dispatch.autoReplay(stock, sold.taskId)
      expect(await tasksOf(sold.itemId)).toHaveLength(1)
    },
    60000,
  )

  databaseTest(
    "rejects binding a source account to a proxy being shipped",
    async () => {
      const { account, order, proxy, repository, sql } = await setup()
      const sold = await proxy("sold")
      const user = await account("user")
      const { orderId } = await order("proxy", 1)
      const unblock = await holdTransferRecords(sql)
      const ship = repository.shipOrder(actor, orderId, { ids: [sold], sourceGroupId: stock })
      await Bun.sleep(200)
      const bind = failureMessage(
        sql`update operation_account set proxy_id = ${sold} where id = ${user}`,
      )
      await Bun.sleep(200)
      await unblock()
      await ship
      expect(await bind).toContain("proxy does not belong")
      expect(await groupOf(sql, "operation_proxy", sold)).toBe(buyerA)
      const rows = await sql<{ proxyId: string | null }[]>`
        select proxy_id as "proxyId" from operation_account where id = ${user}`
      expect(rows[0]?.proxyId).toBeNull()
    },
    60000,
  )

  databaseTest(
    "refuses cross-group bindings but tolerates an old one on edit",
    async () => {
      const { account, proxy, sql } = await setup()
      const foreign = await proxy("foreign", { group: buyerA })
      const user = await account("user")
      expect(
        await failureMessage(
          sql`update operation_account set proxy_id = ${foreign} where id = ${user}`,
        ),
      ).toContain("proxy does not belong")
      expect(await failureMessage(account("inserted", { proxyId: foreign }))).toContain(
        "proxy does not belong",
      )
      await sql`alter table operation_account disable trigger operation_account_proxy_owner_update`
      await sql`update operation_account set proxy_id = ${foreign} where id = ${user}`
      await sql`alter table operation_account enable trigger operation_account_proxy_owner_update`
      await sql`update operation_account set proxy_id = ${foreign}, note = '普通编辑' where id = ${user}`
    },
    60000,
  )
})

describe("shipped order refunds PostgreSQL", () => {
  const shipped = async () => {
    const env = await setup()
    const first = await env.account("jp_001")
    const second = await env.account("jp_002")
    const { orderId, productId } = await env.order("account", 2)
    await env.repository.shipOrder(actor, orderId, { ids: [first, second], sourceGroupId: stock })
    return { ...env, first, orderId, productId, second }
  }
  const balanceOf = async (repository: Awaited<ReturnType<typeof setup>>["repository"]) =>
    (await repository.listWallets([buyerA]))[0]?.balance

  databaseTest(
    "returns the points and takes the items back to the source",
    async () => {
      const { first, orderId, productId, repository, sql } = await shipped()
      const before = await balanceOf(repository)
      const result = await repository.refundOrder(actor, orderId, {
        reason: "账号有问题",
        reclaim: true,
      })
      expect(result).toMatchObject({ points: 200, reclaimed: 2, replayed: false })
      expect(await balanceOf(repository)).toBe((before ?? 0) + 200)
      expect(await groupOf(sql, "operation_account", first)).toBe(stock)
      const orders = await repository.listOrders({
        groupId: buyerA,
        page: 1,
        pageSize: 20,
        type: "resource",
      })
      expect(orders.items[0]).toMatchObject({ cancelReason: "账号有问题", status: "refunded" })
      // 买家仍能看到当时发了什么，收回记录单独写，并说明来自哪笔退款。
      expect(await repository.listShipment(buyerA, orderId)).toHaveLength(2)
      const records = await repository.listTransfers({ kind: "account", page: 1, pageSize: 20 })
      expect(records.total).toBe(4)
      expect(records.items.filter((item) => item.reason.includes("退款收回"))).toHaveLength(2)
      // 收回的货不一定还能卖（买家可能改过密码），库存不自动加。
      const products = await repository.listProducts({ enabledOnly: false, page: 1, pageSize: 10 })
      expect(products.items.find((item) => item.id === productId)?.stock).toBe(98)
    },
    60000,
  )

  databaseTest(
    "refunds once on a retry and never for an unshipped order",
    async () => {
      const { account, order, orderId, repository } = await shipped()
      await repository.refundOrder(actor, orderId, { reason: "退", reclaim: true })
      const before = await balanceOf(repository)
      expect(
        await repository.refundOrder(actor, orderId, { reason: "退", reclaim: true }),
      ).toMatchObject({ reclaimed: 0, replayed: true })
      expect(await balanceOf(repository)).toBe(before)
      await account("other")
      const pending = await order("account", 1)
      await expectCode(
        repository.refundOrder(actor, pending.orderId, { reason: "退", reclaim: true }),
        "order_not_refundable",
      )
      await repository.cancelOrder(actor, pending.orderId, "缺货")
      await expectCode(
        repository.refundOrder(actor, pending.orderId, { reason: "退", reclaim: true }),
        "order_not_refundable",
      )
      await expectCode(
        repository.refundOrder(actor, crypto.randomUUID(), { reason: "退", reclaim: true }),
        "order_not_found",
      )
    },
    60000,
  )

  databaseTest(
    "moves nothing and refunds nothing when an item cannot come back",
    async () => {
      const { first, orderId, repository, second, sql } = await shipped()
      await sql`insert into operation_account_lease (account_id, group_id, leased_by_user_id)
        values (${first}, ${buyerA}, ${actor})`
      const before = await balanceOf(repository)
      const error = await expectCode(
        repository.refundOrder(actor, orderId, { reason: "退", reclaim: true }),
        "resource_in_use",
      )
      expect(error.items).toEqual(["jp_001"])
      expect(await balanceOf(repository)).toBe(before)
      expect(await groupOf(sql, "operation_account", second)).toBe(buyerA)

      // 操作人可以选择不收回，只退积分。
      await repository.refundOrder(actor, orderId, { reason: "退", reclaim: false })
      expect(await balanceOf(repository)).toBe((before ?? 0) + 200)
      expect(await groupOf(sql, "operation_account", second)).toBe(buyerA)
    },
    60000,
  )

  databaseTest(
    "does not take back an item that a later order delivered",
    async () => {
      const { first, order, orderId, repository, second, sql } = await shipped()
      await repository.transfer(actor, {
        ids: [first],
        kind: "account",
        sourceGroupId: buyerA,
        targetGroupId: stock,
      })
      const later = await order("account", 1)
      await repository.shipOrder(actor, later.orderId, { ids: [first], sourceGroupId: stock })
      const error = await expectCode(
        repository.refundOrder(actor, orderId, { reason: "退", reclaim: true }),
        "refund_items_moved",
      )
      expect(error.items).toEqual(["jp_001"])
      expect(await groupOf(sql, "operation_account", first)).toBe(buyerA)
      expect(await groupOf(sql, "operation_account", second)).toBe(buyerA)
      // 后来那笔照常能退，也只收回它自己发的。
      expect(
        await repository.refundOrder(actor, later.orderId, { reason: "退", reclaim: true }),
      ).toMatchObject({ reclaimed: 1 })
      expect(await groupOf(sql, "operation_account", first)).toBe(stock)
    },
    60000,
  )

  databaseTest(
    "asks to skip reclaiming when the source group is gone",
    async () => {
      const { orderId, repository, sql } = await shipped()
      await sql`update mall_resource_transfer set source_group_id = null where order_id = ${orderId}`
      await expectCode(
        repository.refundOrder(actor, orderId, { reason: "退", reclaim: true }),
        "refund_source_missing",
      )
    },
    60000,
  )
})

describe("product inventory PostgreSQL", () => {
  const boundProduct = async (env: Awaited<ReturnType<typeof setup>>, stockCount: number) =>
    env.repository.createProduct(actor, {
      enabled: true,
      inventoryGroupId: stock,
      kind: "account",
      minQuantity: 1,
      name: "绑定商品",
      pricePoints: 100,
      spec: "",
      stock: stockCount,
    })
  const buy = (env: Awaited<ReturnType<typeof setup>>, productId: string, quantity = 1) =>
    env.repository.purchase(actor, buyerA, {
      expectedUnitPoints: 100,
      idempotencyKey: crypto.randomUUID(),
      productId,
      quantity,
    })
  const fund = (env: Awaited<ReturnType<typeof setup>>) =>
    env.repository.recharge(actor, {
      amountYuan: "1000",
      groupId: buyerA,
      idempotencyKey: crypto.randomUUID(),
      remark: "打款",
    })

  databaseTest(
    "sells no more than the group can ship, counting orders not shipped yet",
    async () => {
      const env = await setup()
      await fund(env)
      const first = await env.account("a")
      await env.account("b")
      await env.account("banned", { status: "suspended" })
      const product = await boundProduct(env, 100)
      expect(product).toMatchObject({ available: 2, inventoryGroupName: "平台库存" })
      await expectCode(buy(env, product.id, 3), "insufficient_stock")
      const { orderId } = await buy(env, product.id, 1)
      const listed = await env.repository.listProducts({
        enabledOnly: false,
        page: 1,
        pageSize: 10,
      })
      expect(listed.items.find((item) => item.id === product.id)?.available).toBe(1)

      // 发货时可售和占用同时减少，可售数量不变。
      await env.repository.shipOrder(actor, orderId, { ids: [first], sourceGroupId: stock })
      const after = await env.repository.listProducts({ enabledOnly: false, page: 1, pageSize: 10 })
      expect(after.items.find((item) => item.id === product.id)?.available).toBe(1)
    },
    60000,
  )

  databaseTest(
    "does not oversell when several products share a group",
    async () => {
      const env = await setup()
      await fund(env)
      await env.account("a")
      await env.account("b")
      await env.account("c")
      const one = await boundProduct(env, 100)
      const two = await boundProduct(env, 100)
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, (_, index) => buy(env, index % 2 === 0 ? one.id : two.id)),
      )
      expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(3)
    },
    60000,
  )

  databaseTest(
    "does not sell a product to the group that holds its stock",
    async () => {
      const env = await setup()
      await env.account("a")
      await env.repository.recharge(actor, {
        amountYuan: "10",
        groupId: stock,
        idempotencyKey: crypto.randomUUID(),
        remark: "打款",
      })
      const product = await boundProduct(env, 100)
      await expectCode(
        env.repository.purchase(actor, stock, {
          expectedUnitPoints: 100,
          idempotencyKey: crypto.randomUUID(),
          productId: product.id,
          quantity: 1,
        }),
        "product_unavailable",
      )
    },
    60000,
  )

  databaseTest(
    "ships a bound product only from its group",
    async () => {
      const env = await setup()
      await fund(env)
      const item = await env.account("a")
      const elsewhere = await env.account("b", { group: buyerB })
      const product = await boundProduct(env, 100)
      const { orderId } = await buy(env, product.id)
      await expectCode(
        env.repository.shipOrder(actor, orderId, { ids: [elsewhere], sourceGroupId: buyerB }),
        "ship_source_mismatch",
      )
      await env.repository.shipOrder(actor, orderId, { ids: [item], sourceGroupId: stock })
      await expectCode(
        env.repository.createProduct(actor, {
          enabled: true,
          inventoryGroupId: crypto.randomUUID(),
          kind: "account",
          minQuantity: 1,
          name: "不存在的分组",
          pricePoints: 100,
          spec: "",
          stock: 1,
        }),
        "group_not_found",
      )
    },
    60000,
  )
})

describe("manual transfer PostgreSQL", () => {
  databaseTest(
    "moves anything idle, retries safely and records who did it",
    async () => {
      const { account, proxy, repository, sql } = await setup()
      const banned = await account("banned", { status: "suspended" })
      const disabled = await proxy("已停用", { status: "disabled" })
      expect(
        await repository.transfer(actor, {
          ids: [banned],
          kind: "account",
          sourceGroupId: stock,
          targetGroupId: buyerA,
        }),
      ).toEqual({ moved: 1, replayed: false })
      expect(await groupOf(sql, "operation_account", banned)).toBe(buyerA)
      await repository.transfer(actor, {
        ids: [disabled],
        kind: "proxy",
        sourceGroupId: stock,
        targetGroupId: buyerA,
      })
      expect(await groupOf(sql, "operation_proxy", disabled)).toBe(buyerA)
      expect(
        await repository.transfer(actor, {
          ids: [banned],
          kind: "account",
          sourceGroupId: stock,
          targetGroupId: buyerA,
        }),
      ).toEqual({ moved: 0, replayed: true })

      const accounts = await repository.listTransfers({ kind: "account", page: 1, pageSize: 20 })
      expect(accounts.total).toBe(1)
      expect(accounts.items[0]).toMatchObject({ displayName: "banned", orderNo: null })
    },
    60000,
  )

  databaseTest(
    "refuses a stale source, a missing item and bad targets",
    async () => {
      const { account, repository, sql } = await setup()
      const item = await account("jp_001", { group: buyerB })
      const move = (patch: { ids?: string[]; source?: string; target?: string }) =>
        repository.transfer(actor, {
          ids: patch.ids ?? [item],
          kind: "account",
          sourceGroupId: patch.source ?? stock,
          targetGroupId: patch.target ?? buyerA,
        })
      await expectCode(move({}), "resource_changed")
      await expectCode(move({ ids: [crypto.randomUUID()] }), "resource_not_found")
      await expectCode(move({ source: buyerA }), "transfer_same_group")
      await expectCode(move({ source: buyerB, target: unassignedGroup }), "group_not_found")
      await expectCode(move({ source: buyerB, target: crypto.randomUUID() }), "group_not_found")
      const recycled = await account("gone", { deleted: true })
      await expectCode(move({ ids: [recycled] }), "resource_not_found")
      expect(await groupOf(sql, "operation_account", item)).toBe(buyerB)
    },
    60000,
  )

  databaseTest(
    "keeps other groups out of a shipment list",
    async () => {
      const { account, order, repository } = await setup()
      const item = await account("jp_001")
      const { orderId } = await order("account", 1)
      await repository.shipOrder(actor, orderId, { ids: [item], sourceGroupId: stock })
      await expectCode(repository.listShipment(buyerB, orderId), "order_not_found")
    },
    60000,
  )
})
