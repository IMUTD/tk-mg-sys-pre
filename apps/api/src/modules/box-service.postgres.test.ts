import { afterEach, beforeAll, describe, expect, it } from "bun:test"
import { createHash, createSign, generateKeyPairSync } from "node:crypto"

import { Hono } from "hono"

import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../db/test-database"
import { Role, UserIdSchema } from "../lib/authorization"
import { createPostgresAuditRepository } from "./audit/service"
import { boxNotifyUrl, paymentReturnUrl, registerBoxService } from "./box-service"
import { createPostgresPagePermissionRepository } from "./members/page-permission-repository"
import { createPostgresMemberRepository } from "./members/repository"
import { createMemberService, MemberCreateSchema } from "./members/service"

const databaseIntegrationTest = hasConfiguredTestDatabase ? it : it.skip

const platformId = "10000000-0000-4000-8000-000000000001"
const adminAId = "10000000-0000-4000-8000-00000000000a"
const adminBId = "10000000-0000-4000-8000-00000000000b"
const operatorId = "10000000-0000-4000-8000-0000000000a1"
const unmarkedAdminId = "10000000-0000-4000-8000-0000000000c1"
const groupAId = "20000000-0000-4000-8000-00000000000a"
const groupBId = "20000000-0000-4000-8000-00000000000b"
const unassignedGroupId = "20000000-0000-4000-8000-000000000000"

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 })
const privateKey = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString()
const publicKey = keys.publicKey.export({ format: "pem", type: "spki" }).toString()

let activeDatabase: MigratedTestDatabase | null = null

beforeAll(() => {
  process.env["ALIPAY_APP_ID"] = "test-app"
  process.env["ALIPAY_PRIVATE_KEY"] = privateKey
  process.env["ALIPAY_PUBLIC_KEY"] = publicKey
  process.env["ALIPAY_GATEWAY"] = "https://alipay.invalid/gateway.do"
  process.env["BOX_SERVICE_PRICE_1"] = "100.00"
})

afterEach(async () => {
  if (activeDatabase !== null) {
    await activeDatabase.close()
    activeDatabase = null
  }
})

type Fixture = {
  readonly database: MigratedTestDatabase
  readonly request: (token: string, path: string, init?: RequestInit) => Promise<Response>
  readonly sessionFor: (userId: string) => Promise<string>
  readonly sweep: () => Promise<void>
}

const setup = async (): Promise<Fixture> => {
  const database = await createMigratedTestDatabase()
  activeDatabase = database
  const sql = database.client
  await sql`
    insert into access_group (id, name) values
      (${groupAId}, 'group-a'), (${groupBId}, 'group-b'), (${unassignedGroupId}, 'unassigned')
  `
  await sql`
    insert into app_user (id, email, display_name, password_hash, role, provisioned_by, is_platform) values
      (${platformId}, 'platform@test.internal', '平台', 'x', 'administrator', 'sys', true),
      (${adminAId}, 'a@test.internal', '甲', 'x', 'administrator', 'init-tool', false),
      (${adminBId}, 'b@test.internal', '乙', 'x', 'administrator', 'init-tool', false)
  `
  await sql`
    insert into user_group (user_id, group_id) values (${adminAId}, ${groupAId}), (${adminBId}, ${groupBId})
  `
  await sql`
    insert into device (group_id, external_id, host, name, model, assignee_user_id) values
      (${groupAId}, 'box-a', '10.0.0.1', 'A1', 'm', ${adminAId}),
      (${groupBId}, 'box-b', '10.0.0.2', 'B1', 'm', ${adminBId}),
      (${unassignedGroupId}, 'box-free', '10.0.0.3', 'F1', 'm', null)
  `
  const app = new Hono()
  const service = registerBoxService(app, sql, createPostgresAuditRepository(sql))
  return {
    database,
    request: async (token, path, init) =>
      app.request(path, {
        ...init,
        headers: { ...(init?.headers ?? {}), cookie: `tk_mg_session=${token}` },
      }),
    sessionFor: async (userId) => {
      const token = crypto.randomUUID()
      const hash = createHash("sha256").update(token).digest("hex")
      await sql`
        insert into app_session (id, user_id, token_hash, expires_at)
        values (${crypto.randomUUID()}, ${userId}, ${hash}, now() + interval '1 hour')
      `
      return token
    },
    sweep: service.sweepPendingOrders,
  }
}

type OrdersBody = {
  readonly orders: readonly { buyerEmail?: string; outTradeNo: string; status: string }[]
  readonly scope: string
  readonly total: number
}
type BoxesBody = { readonly boxes: readonly { externalId: string }[] }
type FeesBody = {
  readonly available: boolean
  readonly fees: readonly { amount: string; boxId: string; ownerEmail?: string }[]
  readonly scope: string
  readonly summary: { amount: string; count: number }
  readonly total: number
}

const readJson = async <Body>(response: Promise<Response>): Promise<Body> =>
  (await (await response).json()) as Body

const createBoxFeeTable = async (database: MigratedTestDatabase): Promise<void> => {
  // Same shape init-tool creates; this repository never creates it in production.
  await database.client`
    create table box_fee (
      id uuid primary key default gen_random_uuid(),
      box_id text not null,
      amount_yuan int not null,
      note text not null default '',
      created_at timestamptz not null default now()
    )
  `
  await database.client`
    insert into box_fee (box_id, amount_yuan, note) values
      ('box-a', 30, 'a fee'), ('box-b', 50, 'b fee'), ('box-free', 70, 'free fee')
  `
}

const insertOrder = async (
  database: MigratedTestDatabase,
  outTradeNo: string,
  buyer: string,
  externalId: string,
  status = "pending",
): Promise<void> => {
  await database.client`
    insert into box_service_order (out_trade_no, external_id, buyer_user_id, months, amount, status)
    values (${outTradeNo}, ${externalId}, ${buyer}, 1, '100.00', ${status})
  `
}

const signedNotify = (params: Record<string, string>): string => {
  const content = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&")
  const signer = createSign("RSA-SHA256")
  signer.update(content, "utf8")
  return new URLSearchParams({
    ...params,
    sign: signer.sign(privateKey, "base64"),
    sign_type: "RSA2",
  }).toString()
}

const notify = (fixture: Fixture, params: Record<string, string>) =>
  fixture.request("", "/api/pay/alipay/notify", {
    body: signedNotify({ app_id: "test-app", ...params }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  })

// Answers every gateway call with one signed reply, the way Alipay signs its response node.
const stubAlipay = (method: string, reply: Record<string, string>): (() => string[]) => {
  const node = JSON.stringify(reply)
  const signer = createSign("RSA-SHA256")
  signer.update(node, "utf8")
  const body = `{"${method.replaceAll(".", "_")}_response":${node},"sign":"${signer.sign(privateKey, "base64")}"}`
  const sent: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = Object.assign(
    async (_input: string | URL | Request, init?: RequestInit) => {
      sent.push(String(init?.body ?? ""))
      return new Response(body, { headers: { "content-type": "application/json;charset=utf-8" } })
    },
    { preconnect: original.preconnect },
  )
  restoreFetch = () => {
    globalThis.fetch = original
  }
  return () => sent
}

let restoreFetch: (() => void) | null = null

// Every gateway call fails the way a timeout does.
const failAlipay = (): void => {
  const original = globalThis.fetch
  globalThis.fetch = Object.assign(
    async () => {
      throw new DOMException("The operation timed out.", "TimeoutError")
    },
    { preconnect: original.preconnect },
  )
  restoreFetch = () => {
    globalThis.fetch = original
  }
}

afterEach(() => {
  restoreFetch?.()
  restoreFetch = null
})

const refund = (fixture: Fixture, token: string, outTradeNo: string, reason = "买错了") =>
  fixture.request(token, `/api/box-service/orders/${outTradeNo}/refund`, {
    body: JSON.stringify({ reason }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })

const serviceUntil = async (database: MigratedTestDatabase, externalId: string) =>
  (
    await database.client<{ until: Date | null }[]>`
      select service_until as until from device where external_id = ${externalId}
    `
  )[0]?.until ?? null

describe("box service PostgreSQL integration", () => {
  databaseIntegrationTest("records the creator as parent of a new member", async () => {
    // Given
    const fixture = await setup()
    const service = createMemberService({
      auditRepository: createPostgresAuditRepository(fixture.database.client),
      pagePermissions: createPostgresPagePermissionRepository(fixture.database.client),
      repository: createPostgresMemberRepository(fixture.database.client),
    })

    // When
    const member = await service.create(
      UserIdSchema.parse(adminAId),
      MemberCreateSchema.parse({
        email: "operator@test.internal",
        password: "Password123!",
        role: Role.Operator,
      }),
    )

    // Then
    const rows = await fixture.database.client<{ parent: string | null; provisioned: string }[]>`
      select parent_user_id::text as parent, provisioned_by as provisioned
      from app_user where id = ${member.id}
    `
    expect(rows[0]).toEqual({ parent: adminAId, provisioned: "sys" })
  })

  databaseIntegrationTest("lets a second-level user buy time on their admin's boxes", async () => {
    // Given: admin A creates a member the way the members page does.
    const fixture = await setup()
    const service = createMemberService({
      auditRepository: createPostgresAuditRepository(fixture.database.client),
      pagePermissions: createPostgresPagePermissionRepository(fixture.database.client),
      repository: createPostgresMemberRepository(fixture.database.client),
    })
    const member = await service.create(
      UserIdSchema.parse(adminAId),
      MemberCreateSchema.parse({
        email: "second@test.internal",
        password: "Password123!",
        role: Role.Operator,
      }),
    )
    const token = await fixture.sessionFor(member.id)
    const order = (externalId: string) =>
      fixture.request(token, "/api/box-service/orders", {
        body: JSON.stringify({ externalId, months: 1 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })

    // When
    const boxes = await readJson<BoxesBody>(fixture.request(token, "/api/box-service"))
    const own = await order("box-a")
    const other = await order("box-b")
    const orders = await readJson<OrdersBody>(fixture.request(token, "/api/box-service/orders"))
    const adminOrders = await readJson<OrdersBody>(
      fixture.request(await fixture.sessionFor(adminAId), "/api/box-service/orders"),
    )

    // Then
    expect(boxes.boxes.map((box) => box.externalId)).toEqual(["box-a"])
    expect(own.status).toBe(200)
    expect(other.status).toBe(404)
    expect(orders.scope).toBe("own")
    expect(orders.total).toBe(1)
    // The admin sees what their second-level user bought.
    expect(adminOrders.total).toBe(1)
  })

  databaseIntegrationTest(
    "treats only the marked platform account as the platform for orders and boxes",
    async () => {
      // Given
      const fixture = await setup()
      await fixture.database.client`
        insert into app_user (id, email, display_name, password_hash, role, provisioned_by, parent_user_id)
        values (${operatorId}, 'op@test.internal', '运营', 'x', 'operator', 'sys', ${adminAId})
      `
      // A system-created administrator is not the platform unless it is marked as one.
      await fixture.database.client`
        insert into app_user (id, email, display_name, password_hash, role, provisioned_by, is_platform)
        values (${unmarkedAdminId}, 'sys-admin@test.internal', '系统建管理员', 'x', 'administrator', 'sys', false)
      `
      const unmarked = await fixture.sessionFor(unmarkedAdminId)
      await insertOrder(fixture.database, "order-a", adminAId, "box-a")
      await insertOrder(fixture.database, "order-b", adminBId, "box-b")
      await insertOrder(fixture.database, "order-op", operatorId, "box-a")
      const platform = await fixture.sessionFor(platformId)
      const operator = await fixture.sessionFor(operatorId)
      const adminA = await fixture.sessionFor(adminAId)

      // When
      const platformOrders = await readJson<OrdersBody>(
        fixture.request(platform, "/api/box-service/orders"),
      )
      const operatorOrders = await readJson<OrdersBody>(
        fixture.request(operator, "/api/box-service/orders"),
      )
      const platformBoxes = await readJson<BoxesBody>(fixture.request(platform, "/api/box-service"))
      const adminBoxes = await readJson<BoxesBody>(fixture.request(adminA, "/api/box-service"))
      const adminOrders = await readJson<OrdersBody>(
        fixture.request(adminA, "/api/box-service/orders"),
      )

      const unmarkedOrders = await readJson<OrdersBody>(
        fixture.request(unmarked, "/api/box-service/orders"),
      )

      // Then
      expect(unmarkedOrders.scope).toBe("own")
      expect(unmarkedOrders.total).toBe(0)
      expect(platformOrders.scope).toBe("all")
      expect(platformOrders.total).toBe(3)
      expect(operatorOrders.scope).toBe("own")
      expect(operatorOrders.orders.map((row) => row.outTradeNo)).toEqual(["order-op"])
      expect(adminOrders.orders.map((row) => row.outTradeNo).sort()).toEqual([
        "order-a",
        "order-op",
      ])
      expect(operatorOrders.orders[0]?.buyerEmail).toBeUndefined()
      expect(
        platformBoxes.boxes.map((box: { externalId: string }) => box.externalId).sort(),
      ).toEqual(["box-a", "box-b", "box-free"])
      expect(adminBoxes.boxes.map((box: { externalId: string }) => box.externalId)).toEqual([
        "box-a",
      ])
    },
  )

  databaseIntegrationTest("refuses to sell time on boxes outside the buyer's scope", async () => {
    // Given
    const fixture = await setup()
    const adminA = await fixture.sessionFor(adminAId)
    const buy = (externalId: string) =>
      fixture.request(adminA, "/api/box-service/orders", {
        body: JSON.stringify({ externalId, months: 1 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })

    // When
    const other = await buy("box-b")
    const unassigned = await buy("box-free")
    const own = await buy("box-a")

    // Then
    expect(other.status).toBe(404)
    expect(unassigned.status).toBe(404)
    expect(own.status).toBe(200)
    const body = (await own.json()) as { outTradeNo: string; payUrl: string }
    const content = new URL(body.payUrl).searchParams.get("biz_content") ?? ""
    expect(JSON.parse(content).timeout_express).toBe("30m")
    const audit = await fixture.database.client`
        select 1 from audit_event
        where action = 'box_service.order.create' and target = ${`box_service_order:${body.outTradeNo}`}
      `
    expect(audit.length).toBe(1)
  })

  databaseIntegrationTest("grants time once, even after the order was closed locally", async () => {
    // Given
    const fixture = await setup()
    await insertOrder(fixture.database, "order-late", adminAId, "box-a", "closed")
    const paid = {
      out_trade_no: "order-late",
      total_amount: "100.00",
      trade_no: "alipay-1",
      trade_status: "TRADE_SUCCESS",
    }

    // When
    const first = await (await notify(fixture, paid)).text()
    const second = await (await notify(fixture, paid)).text()

    // Then
    expect([first, second]).toEqual(["success", "success"])
    const order = await fixture.database.client<{ status: string }[]>`
        select status from box_service_order where out_trade_no = 'order-late'
      `
    expect(order[0]?.status).toBe("paid")
    const device = await fixture.database.client<{ until: Date | null }[]>`
        select service_until as until from device where external_id = 'box-a'
      `
    const days = ((device[0]?.until?.getTime() ?? 0) - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(27)
    expect(days).toBeLessThan(32)
    const audit = await fixture.database.client`
        select 1 from audit_event where action = 'box_service.order.paid'
      `
    expect(audit.length).toBe(1)
  })

  databaseIntegrationTest("rejects unsigned or mismatched payment notices", async () => {
    // Given
    const fixture = await setup()
    await insertOrder(fixture.database, "order-a", adminAId, "box-a")

    // When
    const forged = await fixture.request("", "/api/pay/alipay/notify", {
      body: new URLSearchParams({
        app_id: "test-app",
        out_trade_no: "order-a",
        sign: "bad",
        total_amount: "100.00",
        trade_status: "TRADE_SUCCESS",
      }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    })
    const cheaper = await notify(fixture, {
      out_trade_no: "order-a",
      total_amount: "0.01",
      trade_no: "alipay-2",
      trade_status: "TRADE_SUCCESS",
    })
    const closed = await notify(fixture, { out_trade_no: "order-a", trade_status: "TRADE_CLOSED" })

    // Then
    expect(await forged.text()).toBe("failure")
    expect(await cheaper.text()).toBe("failure")
    expect(await closed.text()).toBe("success")
    const order = await fixture.database.client<{ status: string }[]>`
      select status from box_service_order where out_trade_no = 'order-a'
    `
    expect(order[0]?.status).toBe("closed")
  })

  databaseIntegrationTest("closes stale orders only once Alipay says unpaid", async () => {
    // Given
    const fixture = await setup()
    await insertOrder(fixture.database, "order-old", adminAId, "box-a")
    await insertOrder(fixture.database, "order-window", adminAId, "box-a")
    await insertOrder(fixture.database, "order-new", adminAId, "box-a")
    await fixture.database.client`
      update box_service_order set created_at = now() - interval '3 hours'
      where out_trade_no = 'order-old'
    `
    await fixture.database.client`
      update box_service_order set created_at = now() - interval '1 hour'
      where out_trade_no = 'order-window'
    `
    const sent = stubAlipay("alipay.trade.query", {
      code: "40004",
      msg: "Business Failed",
      sub_code: "ACQ.TRADE_NOT_EXIST",
    })

    // When
    await fixture.sweep()

    // Then
    const rows = await fixture.database.client<{ out_trade_no: string; status: string }[]>`
      select out_trade_no, status from box_service_order
    `
    const statuses = Object.fromEntries(rows.map((row) => [row.out_trade_no, row.status]))
    expect(statuses).toEqual({
      "order-new": "pending",
      "order-old": "closed",
      "order-window": "pending",
    })
    expect(sent().length).toBe(2)
  })

  databaseIntegrationTest("recovers a payment whose notify never arrived", async () => {
    // Given
    const fixture = await setup()
    await insertOrder(fixture.database, "order-lost", adminAId, "box-a")
    await fixture.database.client`
      update box_service_order set created_at = now() - interval '3 hours'
      where out_trade_no = 'order-lost'
    `
    stubAlipay("alipay.trade.query", {
      code: "10000",
      msg: "Success",
      out_trade_no: "order-lost",
      total_amount: "100.00",
      trade_no: "alipay-lost",
      trade_status: "TRADE_SUCCESS",
    })

    // When
    await fixture.sweep()

    // Then
    const order = await fixture.database.client<{ alipay_trade_no: string; status: string }[]>`
      select status, alipay_trade_no from box_service_order where out_trade_no = 'order-lost'
    `
    expect(order[0]).toEqual({ alipay_trade_no: "alipay-lost", status: "paid" })
    const days = ((await serviceUntil(fixture.database, "box-a"))?.getTime() ?? 0) - Date.now()
    expect(days / 86_400_000).toBeGreaterThan(27)
    const audit = await fixture.database.client<{ metadata: { source: string } }[]>`
      select metadata from audit_event where action = 'box_service.order.paid'
    `
    expect(audit[0]?.metadata.source).toBe("sweep")
  })

  databaseIntegrationTest("keeps stale orders pending while Alipay cannot be reached", async () => {
    // Given
    const fixture = await setup()
    await insertOrder(fixture.database, "order-old", adminAId, "box-a")
    await insertOrder(fixture.database, "order-ancient", adminAId, "box-a")
    await fixture.database.client`
      update box_service_order set created_at = now() - interval '3 hours'
      where out_trade_no = 'order-old'
    `
    await fixture.database.client`
      update box_service_order set created_at = now() - interval '2 days'
      where out_trade_no = 'order-ancient'
    `
    failAlipay()
    const platform = await fixture.sessionFor(platformId)

    // When
    await fixture.sweep()
    const reconcile = await fixture.request(platform, "/api/box-service/orders/reconcile", {
      body: JSON.stringify({ outTradeNo: "order-old" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })

    // Then
    const rows = await fixture.database.client<{ out_trade_no: string; status: string }[]>`
      select out_trade_no, status from box_service_order
    `
    const statuses = Object.fromEntries(rows.map((row) => [row.out_trade_no, row.status]))
    expect(statuses).toEqual({ "order-ancient": "closed", "order-old": "pending" })
    expect(reconcile.status).toBe(409)
    // The page keeps asking instead of reporting a failed payment.
    expect(((await reconcile.json()) as { pending?: boolean }).pending).toBe(true)
  })

  databaseIntegrationTest("confirms at once when the notify landed before the buyer", async () => {
    // Given
    const fixture = await setup()
    await insertOrder(fixture.database, "order-early", adminAId, "box-a", "paid")
    failAlipay()
    const admin = await fixture.sessionFor(adminAId)

    // When
    const reconcile = await fixture.request(admin, "/api/box-service/orders/reconcile", {
      body: JSON.stringify({ outTradeNo: "order-early" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })

    // Then
    expect(reconcile.status).toBe(200)
  })

  databaseIntegrationTest("sends box payments back here, not to the mall", async () => {
    // Given
    const fixture = await setup()
    const admin = await fixture.sessionFor(adminAId)
    const keys = [
      "ALIPAY_NOTIFY_URL",
      "ALIPAY_RETURN_URL",
      "BOX_SERVICE_ALIPAY_NOTIFY_URL",
      "BOX_SERVICE_ALIPAY_RETURN_URL",
    ]
    const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
    // The mall owns these two; box orders must not follow them.
    process.env["ALIPAY_NOTIFY_URL"] = "https://mg.example.com/api/pay/alipay/mall/notify"
    process.env["ALIPAY_RETURN_URL"] = "https://mg.example.com/mall/recharge"
    process.env["BOX_SERVICE_ALIPAY_RETURN_URL"] = "https://mg.example.com/operations/box-service"
    delete process.env["BOX_SERVICE_ALIPAY_NOTIFY_URL"]

    try {
      // When
      const created = await readJson<{ outTradeNo: string; payUrl: string }>(
        fixture.request(admin, "/api/box-service/orders", {
          body: JSON.stringify({ externalId: "box-a", months: 1 }),
          headers: { "content-type": "application/json", origin: "https://other.example.com" },
          method: "POST",
        }),
      )

      // Then
      const pay = new URL(created.payUrl).searchParams
      expect(pay.get("notify_url")).toBe("https://mg.example.com/api/pay/alipay/notify")
      const returnUrl = new URL(pay.get("return_url") ?? "")
      expect(`${returnUrl.origin}${returnUrl.pathname}`).toBe(
        "https://mg.example.com/operations/box-service",
      )
      expect(returnUrl.searchParams.get("outTradeNo")).toBe(created.outTradeNo)
    } finally {
      for (const key of keys) {
        const value = saved[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  databaseIntegrationTest("keeps a payment for a deleted box and flags it", async () => {
    // Given
    const fixture = await setup()
    await insertOrder(fixture.database, "order-gone", adminAId, "box-gone")
    const platform = await fixture.sessionFor(platformId)

    // When
    const answer = await notify(fixture, {
      out_trade_no: "order-gone",
      total_amount: "100.00",
      trade_no: "alipay-gone",
      trade_status: "TRADE_SUCCESS",
    })
    const list = await readJson<{
      orders: readonly { deviceMissing: boolean; outTradeNo: string; status: string }[]
    }>(fixture.request(platform, "/api/box-service/orders"))

    // Then
    expect(await answer.text()).toBe("success")
    expect(list.orders[0]).toMatchObject({
      deviceMissing: true,
      outTradeNo: "order-gone",
      status: "paid",
    })
    const audit = await fixture.database.client`
      select 1 from audit_event
      where action = 'box_service.order.device_missing' and outcome = 'failed'
    `
    expect(audit.length).toBe(1)
  })

  databaseIntegrationTest("does not flag a box deleted after its time was added", async () => {
    // Given
    const fixture = await setup()
    await insertOrder(fixture.database, "order-landed", adminAId, "box-a")
    const platform = await fixture.sessionFor(platformId)
    await notify(fixture, {
      out_trade_no: "order-landed",
      total_amount: "100.00",
      trade_no: "alipay-landed",
      trade_status: "TRADE_SUCCESS",
    })

    // When
    await fixture.database.client`delete from device where external_id = 'box-a'`
    const list = await readJson<{
      orders: readonly { deviceMissing: boolean; outTradeNo: string }[]
    }>(fixture.request(platform, "/api/box-service/orders"))

    // Then
    expect(list.orders[0]).toMatchObject({ deviceMissing: false, outTradeNo: "order-landed" })
  })

  databaseIntegrationTest("scopes fee records to the box's current administrator", async () => {
    // Given
    const fixture = await setup()
    const platform = await fixture.sessionFor(platformId)
    const adminA = await fixture.sessionFor(adminAId)
    const missing = await readJson<FeesBody>(fixture.request(platform, "/api/box-service/fees"))
    await createBoxFeeTable(fixture.database)

    // When
    const all = await readJson<FeesBody>(fixture.request(platform, "/api/box-service/fees"))
    const own = await readJson<FeesBody>(fixture.request(adminA, "/api/box-service/fees"))
    const searched = await readJson<FeesBody>(
      fixture.request(platform, "/api/box-service/fees?q=%E4%B9%99"),
    )

    // Then
    expect(missing).toMatchObject({ available: false, total: 0 })
    expect(all).toMatchObject({ available: true, scope: "all", total: 3 })
    expect(all.summary).toEqual({ amount: "150.00", count: 3 })
    expect(own).toMatchObject({ scope: "own", total: 1 })
    expect(own.fees[0]).toMatchObject({ amount: "30.00", boxId: "box-a" })
    expect(own.fees[0]?.ownerEmail).toBeUndefined()
    expect(searched.fees.map((row: { boxId: string }) => row.boxId)).toEqual(["box-b"])
  })

  databaseIntegrationTest("refunds a paid order once and takes its time back", async () => {
    // Given
    const fixture = await setup()
    const sql = fixture.database.client
    await insertOrder(fixture.database, "order-a", adminAId, "box-a", "paid")
    await sql`
      update device set service_until = now() + interval '2 months' where external_id = 'box-a'
    `
    const before = await serviceUntil(fixture.database, "box-a")
    const sent = stubAlipay("alipay.trade.refund", {
      code: "10000",
      fund_change: "Y",
      msg: "Success",
      out_trade_no: "order-a",
      refund_fee: "100.00",
    })
    const platform = await fixture.sessionFor(platformId)
    const adminA = await fixture.sessionFor(adminAId)

    // When
    const denied = await refund(fixture, adminA, "order-a")
    const done = await refund(fixture, platform, "order-a")
    const again = await refund(fixture, platform, "order-a")
    const lateNotice = await (
      await notify(fixture, {
        out_trade_no: "order-a",
        total_amount: "100.00",
        trade_no: "T1",
        trade_status: "TRADE_SUCCESS",
      })
    ).text()

    // Then
    expect(denied.status).toBe(403)
    expect(done.status).toBe(200)
    expect(again.status).toBe(200)
    expect(lateNotice).toBe("success")
    expect(sent()).toHaveLength(1)
    const request = new URLSearchParams(sent()[0])
    expect(request.get("method")).toBe("alipay.trade.refund")
    expect(JSON.parse(request.get("biz_content") ?? "{}")).toMatchObject({
      out_request_no: "order-a-refund",
      out_trade_no: "order-a",
      refund_amount: "100.00",
    })
    const order = await sql<{ refund_reason: string; refunded_by: string; status: string }[]>`
      select status, refund_reason, refunded_by::text from box_service_order
      where out_trade_no = 'order-a'
    `
    expect(order[0]).toEqual({
      refund_reason: "买错了",
      refunded_by: platformId,
      status: "refunded",
    })
    const after = await serviceUntil(fixture.database, "box-a")
    const shifted = await sql<{ expected: Date }[]>`
      select (${before}::timestamptz - interval '1 month') as expected
    `
    expect(after?.getTime()).toBe(shifted[0]?.expected.getTime())
    const audits = await sql<{ outcome: string }[]>`
      select outcome from audit_event where action = 'box_service.order.refund'
    `
    expect([...audits]).toEqual([{ outcome: "allowed" }])
    const list = await readJson<OrdersBody & { summary: { refundedCount: number } }>(
      fixture.request(platform, "/api/box-service/orders?status=refunded"),
    )
    expect(list.total).toBe(1)
    expect(list.summary.refundedCount).toBe(1)
  })

  databaseIntegrationTest("keeps the order paid when Alipay refuses the refund", async () => {
    // Given
    const fixture = await setup()
    await insertOrder(fixture.database, "order-a", adminAId, "box-a", "paid")
    await insertOrder(fixture.database, "order-wait", adminAId, "box-a")
    await fixture.database.client`
      update device set service_until = now() + interval '1 month' where external_id = 'box-a'
    `
    const before = await serviceUntil(fixture.database, "box-a")
    stubAlipay("alipay.trade.refund", {
      code: "40004",
      msg: "Business Failed",
      sub_code: "ACQ.SELLER_BALANCE_NOT_ENOUGH",
      sub_msg: "卖家余额不足",
    })
    const platform = await fixture.sessionFor(platformId)

    // When
    const refused = await refund(fixture, platform, "order-a")
    const unpaid = await refund(fixture, platform, "order-wait")
    const blank = await refund(fixture, platform, "order-a", " ")

    // Then
    expect(refused.status).toBe(502)
    expect(await refused.json()).toEqual({ error: "卖家余额不足" })
    expect(unpaid.status).toBe(409)
    expect(blank.status).toBe(400)
    const status = await fixture.database.client<{ status: string }[]>`
      select status from box_service_order where out_trade_no = 'order-a'
    `
    expect(status[0]?.status).toBe("paid")
    expect((await serviceUntil(fixture.database, "box-a"))?.getTime()).toBe(before?.getTime())
    const audits = await fixture.database.client<{ outcome: string }[]>`
      select outcome from audit_event where action = 'box_service.order.refund'
    `
    expect([...audits]).toEqual([{ outcome: "failed" }])
  })
})

describe("box payment notify address", () => {
  it("prefers its own address, else the mall's host with this module's path", () => {
    expect(boxNotifyUrl("https://pay.example.com/box", "https://mg.example.com/x")).toBe(
      "https://pay.example.com/box",
    )
    expect(boxNotifyUrl("", "https://mg.example.com/api/pay/alipay/mall/notify")).toBe(
      "https://mg.example.com/api/pay/alipay/notify",
    )
    expect(boxNotifyUrl("", "")).toBe("")
  })
})

describe("payment return address", () => {
  it("always carries the order number", () => {
    expect(paymentReturnUrl("", "https://mg.example.com", "bs1")).toBe(
      "https://mg.example.com/operations/box-service?outTradeNo=bs1",
    )
    expect(paymentReturnUrl("https://mg.example.com/pay?from=alipay", "", "bs2")).toBe(
      "https://mg.example.com/pay?from=alipay&outTradeNo=bs2",
    )
    expect(paymentReturnUrl("", "", "bs3")).toBe("")
  })
})
