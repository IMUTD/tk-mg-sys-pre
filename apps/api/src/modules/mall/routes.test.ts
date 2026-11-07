import { describe, expect, it } from "bun:test"

import { createApp } from "../../app"
import {
  createAccessScope,
  GroupIdSchema,
  Role,
  type Role as RoleName,
  UserIdSchema,
} from "../../lib/authorization"
import { createInMemoryAuditRepository } from "../audit/service"
import type { AuthService, SessionPrincipal } from "../auth/service"
import { MallError } from "./model"
import type { MallRepository } from "./repository"
import { createMallService } from "./service"

const ownGroup = "11111111-1111-4111-8111-111111111111"
const otherGroup = "22222222-2222-4222-8222-222222222222"
const key = "idempotency-key-1"

const principal = (
  token: string,
  role: RoleName,
  groupIds: readonly string[],
  restrictGroups = false,
): SessionPrincipal => ({
  displayName: token,
  email: `${token}@example.test`,
  scope: createAccessScope({
    groupIds: groupIds.map((id) => GroupIdSchema.parse(id)),
    restrictGroups,
    role,
  }),
  userId: UserIdSchema.parse(crypto.randomUUID()),
})

const principals: Readonly<Record<string, SessionPrincipal>> = {
  operator: principal("operator", Role.Operator, [ownGroup]),
  platform: principal("platform", Role.Administrator, []),
  sales: principal("sales", Role.Salesperson, [ownGroup]),
  tenant: principal("tenant", Role.Administrator, [ownGroup], true),
}

const authService = {
  session: async (token: string) => principals[token] ?? null,
} as AuthService

const ledgerEntry = {
  actorName: "平台人员",
  balance: 100,
  createdAt: "2026-11-07T00:00:00.000Z",
  delta: 100,
  groupId: ownGroup,
  groupName: "一组",
  id: "33333333-3333-4333-8333-333333333333",
  orderNo: "P1",
  remark: "打款",
  type: "recharge" as const,
}

const productId = "44444444-4444-4444-8444-444444444444"
const orderId = "55555555-5555-4555-8555-555555555555"
const resourceRecordId = "88888888-8888-4888-8888-888888888888"
const product = {
  available: null,
  inventoryGroupId: null,
  inventoryGroupName: null,
  createdAt: "2026-11-07T00:00:00.000Z",
  enabled: true,
  id: productId,
  kind: "account" as const,
  minQuantity: 1,
  name: "日本满季度白号",
  pricePoints: 100,
  spec: "100 个起售",
  stock: 5,
  updatedAt: "2026-11-07T00:00:00.000Z",
}
const orderRow = {
  amountCents: 0,
  buyerName: "内部姓名",
  cancelReason: "",
  cancelledAt: null,
  createdAt: "2026-11-07T00:00:00.000Z",
  description: "",
  groupId: ownGroup,
  groupName: "一组",
  id: orderId,
  orderNo: "M1",
  paidAt: "2026-11-07T00:00:00.000Z",
  points: 100,
  product: "日本满季度白号",
  productKind: "account" as const,
  inventoryGroupId: null,
  inventoryGroupName: null,
  quantity: 1,
  refundedAt: null,
  shippedAt: null,
  status: "pending_ship" as const,
  title: "资源购买",
  type: "resource" as const,
  unitPoints: 100,
}
const invoiceRow = {
  amountCents: 100,
  applicantName: "一组管理员",
  createdAt: "2026-11-07T00:00:00.000Z",
  groupId: ownGroup,
  groupName: "一组",
  hasFile: false,
  id: "99999999-1111-4111-8111-111111111111",
  invoiceNumber: "",
  invoiceType: "normal" as const,
  rejectReason: "",
  remark: "",
  reviewedAt: null,
  status: "pending" as const,
  taxNumber: "91310000MA1K123456",
  title: "上海某公司",
  titleType: "company" as const,
  updatedAt: "2026-11-07T00:00:00.000Z",
}

const purchaseBody = { expectedUnitPoints: 100, idempotencyKey: key, productId, quantity: 1 }

const setup = (overrides: Partial<MallRepository> = {}) => {
  const calls: { method: string; args: unknown }[] = []
  const repository: MallRepository = {
    adjust: async (_actor, input) => {
      calls.push({ args: input, method: "adjust" })
      return { balance: 1, delta: input.delta, replayed: false }
    },
    cancelOrder: async (_actor, orderId, reason) => {
      calls.push({ args: { orderId, reason }, method: "cancelOrder" })
      return { balance: 500, groupId: ownGroup, orderNo: "M1", points: 500, replayed: false }
    },
    createProduct: async (_actor, input) => {
      calls.push({ args: input, method: "createProduct" })
      return { ...product, ...input }
    },
    listAllWallets: async () => ({ items: [], total: 0 }),
    closeRecharge: async () => undefined,
    createInvoice: async (_actor, groupId, input) => {
      calls.push({ args: { groupId, input }, method: "createInvoice" })
      return { invoice: invoiceRow, replayed: false }
    },
    createRecharge: async (_actor, groupId, input) => {
      calls.push({ args: { groupId, input }, method: "createRecharge" })
      return { amountCents: 100, orderNo: "A1", points: 100, replayed: false, status: "unpaid" }
    },
    findRecharge: async () => ({ amountCents: 100, orderNo: "A1", points: 100, status: "unpaid" }),
    invoiceFile: async (invoiceId, groupId) => {
      calls.push({ args: { groupId, invoiceId }, method: "invoiceFile" })
      return { content: new TextEncoder().encode("%PDF-1"), fileName: "发票-1.pdf" }
    },
    invoiceQuota: async () => ({ availableCents: 100, invoicedCents: 0, paidCents: 100 }),
    issueInvoice: async (_actor, invoiceId, input) => {
      calls.push({ args: { input, invoiceId }, method: "issueInvoice" })
      return { invoice: invoiceRow, replayed: false }
    },
    listInvoices: async (filter) => {
      calls.push({ args: filter, method: "listInvoices" })
      return { items: [invoiceRow], total: 1 }
    },
    refundOrder: async (_actor, requestedOrder, input) => {
      calls.push({ args: { input, requestedOrder }, method: "refundOrder" })
      return {
        balance: 500,
        groupId: ownGroup,
        orderNo: "M1",
        points: 500,
        reclaimed: 1,
        replayed: false,
      }
    },
    rejectInvoice: async (_actor, invoiceId, reason) => {
      calls.push({ args: { invoiceId, reason }, method: "rejectInvoice" })
      return { invoice: invoiceRow, replayed: false }
    },
    settleRecharge: async () => ({ result: "already" }),
    staleRecharges: async () => [],
    listShipment: async (groupId, requestedOrder) => {
      calls.push({ args: { groupId, requestedOrder }, method: "listShipment" })
      return [{ id: resourceRecordId, kind: "account", name: "jp_001" }]
    },
    listTransferable: async (kind, filter) => {
      calls.push({ args: { filter, kind }, method: "listTransferable" })
      return { items: [], total: 0 }
    },
    listTransfers: async (filter) => {
      calls.push({ args: filter, method: "listTransfers" })
      return { items: [], total: 0 }
    },
    shipOrder: async (_actor, requestedOrder, input) => {
      calls.push({ args: { input, requestedOrder }, method: "shipOrder" })
      return { groupId: ownGroup, moved: 1, orderNo: "M1", replayed: false }
    },
    transfer: async (_actor, input) => {
      calls.push({ args: input, method: "transfer" })
      return { moved: input.ids.length, replayed: false }
    },
    listProducts: async (filter) => {
      calls.push({ args: filter, method: "listProducts" })
      return { items: [product], total: 1 }
    },
    purchase: async (_actor, groupId, input) => {
      calls.push({ args: { groupId, input }, method: "purchase" })
      return { balance: 1, orderId: "o", orderNo: "M1", points: 100, replayed: false }
    },
    updateProduct: async (productId, input) => {
      calls.push({ args: { input, productId }, method: "updateProduct" })
      return product
    },
    listLedger: async (filter) => {
      calls.push({ args: filter, method: "listLedger" })
      return { items: [ledgerEntry], total: 1 }
    },
    listOrders: async (filter) => {
      calls.push({ args: filter, method: "listOrders" })
      return { items: [], total: 0 }
    },
    listWallets: async (groupIds) => {
      calls.push({ args: groupIds, method: "listWallets" })
      return []
    },
    recharge: async (_actor, input) => {
      calls.push({ args: input, method: "recharge" })
      return { balance: 100, orderNo: "P1", points: 100, replayed: false }
    },
    ...overrides,
  }
  const auditRepository = createInMemoryAuditRepository()
  const app = createApp({
    auditRepository,
    authService,
    mallService: createMallService({ auditRepository, repository }),
  })
  const send = (path: string, token: string | null, body?: unknown, method = "POST") =>
    app.request(path, {
      ...(body === undefined ? {} : { body: JSON.stringify(body), method }),
      headers: {
        "Content-Type": "application/json",
        ...(token === null ? {} : { cookie: `tk_mg_session=${token}` }),
      },
    })
  const raw = (
    path: string,
    body: FormData | URLSearchParams,
    headers: Record<string, string> = {},
  ) =>
    app.request(path, {
      body,
      headers: { cookie: "tk_mg_session=platform", ...headers },
      method: "POST",
    })
  return { auditRepository, calls, raw, send }
}

const rechargeBody = { amountYuan: "1", groupId: ownGroup, idempotencyKey: key, remark: "打款" }
const adjustBody = { delta: -5, groupId: ownGroup, idempotencyKey: key, remark: "冲正" }

describe("merchant routes", () => {
  it("hides every merchant endpoint from tenants and members and audits the denial", async () => {
    const { auditRepository, calls, send } = setup()
    for (const token of ["tenant", "sales", "operator"]) {
      expect((await send("/api/merchant/wallets", token)).status).toBe(404)
      expect((await send("/api/merchant/ledger", token)).status).toBe(404)
      expect((await send("/api/merchant/recharges", token, rechargeBody)).status).toBe(404)
      expect((await send("/api/merchant/wallet-adjustments", token, adjustBody)).status).toBe(404)
    }
    expect(calls).toEqual([])
    const denied = auditRepository.all().filter((event) => event.outcome === "denied")
    expect(denied).toHaveLength(12)
  })

  it("requires a session", async () => {
    const { send } = setup()
    expect((await send("/api/merchant/recharges", null, rechargeBody)).status).toBe(401)
    expect((await send("/api/mall/wallets", null)).status).toBe(401)
  })

  it("lets the platform recharge and writes one audit event", async () => {
    const { auditRepository, send } = setup()
    const response = await send("/api/merchant/recharges", "platform", rechargeBody)
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ balance: 100, orderNo: "P1" })
    const recharge = auditRepository.all().filter((event) => event.action === "mall.recharge")
    expect(recharge).toHaveLength(1)
    expect(recharge[0]?.outcome).toBe("allowed")
    expect(recharge[0]?.metadata).toEqual({ groupId: ownGroup, orderNo: "P1", points: "100" })
  })

  it("does not audit a replayed recharge twice", async () => {
    const { auditRepository, send } = setup({
      recharge: async () => ({ balance: 100, orderNo: "P1", points: 100, replayed: true }),
    })
    expect((await send("/api/merchant/recharges", "platform", rechargeBody)).status).toBe(201)
    expect(auditRepository.all().filter((event) => event.action === "mall.recharge")).toEqual([])
  })

  it.each([
    { ...rechargeBody, amountYuan: "0" },
    { ...rechargeBody, amountYuan: "-1" },
    { ...rechargeBody, amountYuan: "1.234" },
    { ...rechargeBody, amountYuan: 1 },
    { ...rechargeBody, remark: "  " },
    { ...rechargeBody, idempotencyKey: "short" },
    { ...rechargeBody, groupId: "not-a-uuid" },
  ])("rejects an invalid recharge %#", async (body) => {
    const { calls, send } = setup()
    expect((await send("/api/merchant/recharges", "platform", body)).status).toBe(400)
    expect(calls).toEqual([])
  })

  it.each([
    { ...adjustBody, delta: 0 },
    { ...adjustBody, delta: 1.5 },
    { ...adjustBody, remark: "" },
  ])("rejects an invalid adjustment %#", async (body) => {
    const { calls, send } = setup()
    expect((await send("/api/merchant/wallet-adjustments", "platform", body)).status).toBe(400)
    expect(calls).toEqual([])
  })

  it("maps repository failures to explicit errors", async () => {
    const failing = (code: "group_not_found" | "idempotency_conflict" | "insufficient_balance") =>
      setup({
        adjust: async () => {
          throw new MallError(code)
        },
      })
    const expectations = [
      ["group_not_found", 404],
      ["insufficient_balance", 409],
      ["idempotency_conflict", 409],
    ] as const
    for (const [code, status] of expectations) {
      const response = await failing(code).send(
        "/api/merchant/wallet-adjustments",
        "platform",
        adjustBody,
      )
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error: code })
    }
  })
})

describe("mall routes", () => {
  it("returns only the caller's own groups from the wallet list", async () => {
    const { calls, send } = setup()
    expect((await send("/api/mall/wallets", "sales")).status).toBe(200)
    expect(calls).toEqual([{ args: [ownGroup], method: "listWallets" }])
  })

  it("hides wallets from roles without a mall page", async () => {
    const { calls, send } = setup()
    expect((await send("/api/mall/wallets", "operator")).status).toBe(404)
    expect(calls).toEqual([])
  })

  it("forces the ledger query onto the authorized group and hides the operator", async () => {
    const { calls, send } = setup()
    const response = await send(
      `/api/groups/${ownGroup}/mall/ledger?groupId=${otherGroup}`,
      "sales",
    )
    expect(response.status).toBe(200)
    expect(calls[0]?.args).toMatchObject({ groupId: ownGroup })
    const body = (await response.json()) as { items: Record<string, unknown>[] }
    expect(body.items[0]).not.toHaveProperty("actorName")
  })

  it("isolates tenants from other groups", async () => {
    const { calls, send } = setup()
    for (const resource of ["ledger", "orders"]) {
      expect((await send(`/api/groups/${otherGroup}/mall/${resource}`, "tenant")).status).toBe(404)
      expect((await send(`/api/groups/${otherGroup}/mall/${resource}`, "sales")).status).toBe(404)
      expect((await send(`/api/groups/${ownGroup}/mall/${resource}`, "operator")).status).toBe(404)
    }
    expect(calls).toEqual([])
  })

  it("rejects invalid list filters", async () => {
    const { send } = setup()
    const path = `/api/groups/${ownGroup}/mall`
    expect((await send(`${path}/ledger?type=gift`, "sales")).status).toBe(400)
    expect((await send(`${path}/orders?pageSize=1000`, "sales")).status).toBe(400)
  })
})

describe("product and purchase routes", () => {
  it("hides product management and order handling from everyone but the platform", async () => {
    const { calls, send } = setup()
    const productBody = { kind: "account", name: "新品", pricePoints: 10 }
    for (const token of ["tenant", "sales", "operator"]) {
      expect((await send("/api/merchant/products", token)).status).toBe(404)
      expect((await send("/api/merchant/products", token, productBody)).status).toBe(404)
      expect(
        (await send(`/api/merchant/products/${productId}`, token, { stockDelta: 5 }, "PATCH"))
          .status,
      ).toBe(404)
      expect((await send("/api/merchant/orders", token)).status).toBe(404)
      expect(
        (await send(`/api/merchant/orders/${orderId}/cancel`, token, { reason: "x" })).status,
      ).toBe(404)
    }
    expect(calls).toEqual([])
  })

  it("shows buyers only enabled products and the platform all of them", async () => {
    const { calls, send } = setup()
    expect((await send("/api/mall/products", "sales")).status).toBe(200)
    expect(calls.at(-1)?.args).toMatchObject({ enabledOnly: true })
    expect((await send("/api/mall/products?enabledOnly=false", "sales")).status).toBe(200)
    expect(calls.at(-1)?.args).toMatchObject({ enabledOnly: true })
    expect((await send("/api/merchant/products", "platform")).status).toBe(200)
    expect(calls.at(-1)?.args).toMatchObject({ enabledOnly: false })
    expect((await send("/api/mall/products", "operator")).status).toBe(404)
  })

  it("lets group members buy and audits the purchase", async () => {
    const { auditRepository, calls, send } = setup()
    const response = await send(`/api/groups/${ownGroup}/mall/orders`, "sales", purchaseBody)
    expect(response.status).toBe(201)
    expect(calls).toEqual([
      { args: { groupId: ownGroup, input: purchaseBody }, method: "purchase" },
    ])
    expect(auditRepository.all().filter((event) => event.action === "mall.purchase")).toHaveLength(
      1,
    )
  })

  it("does not let anyone spend another group's points", async () => {
    const { calls, send } = setup()
    const path = `/api/groups/${otherGroup}/mall/orders`
    expect((await send(path, "tenant", purchaseBody)).status).toBe(404)
    expect((await send(path, "sales", purchaseBody)).status).toBe(404)
    // 平台方能看任意分组，但不是成员就不能替分组花积分。
    expect((await send(path, "platform", purchaseBody)).status).toBe(404)
    expect(
      (await send(`/api/groups/${ownGroup}/mall/orders`, "operator", purchaseBody)).status,
    ).toBe(404)
    expect(calls).toEqual([])
  })

  it.each([
    { ...purchaseBody, quantity: 0 },
    { ...purchaseBody, quantity: 1.5 },
    { ...purchaseBody, quantity: 100_001 },
    { ...purchaseBody, expectedUnitPoints: 0 },
    { ...purchaseBody, productId: "nope" },
    { ...purchaseBody, idempotencyKey: "x" },
  ])("rejects an invalid purchase %#", async (body) => {
    const { calls, send } = setup()
    expect((await send(`/api/groups/${ownGroup}/mall/orders`, "sales", body)).status).toBe(400)
    expect(calls).toEqual([])
  })

  it("maps purchase failures to explicit errors", async () => {
    const expectations = [
      ["product_not_found", 404],
      ["product_unavailable", 409],
      ["price_changed", 409],
      ["invalid_quantity", 409],
      ["insufficient_stock", 409],
      ["insufficient_balance", 409],
    ] as const
    for (const [code, status] of expectations) {
      const { send } = setup({
        purchase: async () => {
          throw new MallError(code)
        },
      })
      const response = await send(`/api/groups/${ownGroup}/mall/orders`, "sales", purchaseBody)
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error: code })
    }
  })

  it("hides the buyer's internal name from buyer order lists but not from the platform", async () => {
    const listOrders: MallRepository["listOrders"] = async () => ({ items: [orderRow], total: 1 })
    const { send } = setup({ listOrders })
    const buyer = (await (await send(`/api/groups/${ownGroup}/mall/orders`, "sales")).json()) as {
      items: Record<string, unknown>[]
    }
    expect(buyer.items[0]).not.toHaveProperty("buyerName")
    const platform = (await (await send("/api/merchant/orders", "platform")).json()) as {
      items: Record<string, unknown>[]
    }
    expect(platform.items[0]).toHaveProperty("buyerName", "内部姓名")
  })

  it("requires a reason to cancel and audits it once", async () => {
    const { auditRepository, calls, send } = setup()
    const path = `/api/merchant/orders/${orderId}/cancel`
    expect((await send(path, "platform", { reason: "  " })).status).toBe(400)
    expect(calls).toEqual([])
    expect((await send(path, "platform", { reason: "缺货" })).status).toBe(200)
    expect(calls).toEqual([{ args: { orderId, reason: "缺货" }, method: "cancelOrder" }])
    const events = auditRepository.all().filter((event) => event.action === "mall.order.cancel")
    expect(events).toHaveLength(1)
    expect(events[0]?.target).toBe(`order:${orderId}`)
  })

  it("rejects an empty product update and a malformed id", async () => {
    const { calls, send } = setup()
    const path = `/api/merchant/products/${productId}`
    expect((await send(path, "platform", {}, "PATCH")).status).toBe(400)
    expect((await send(path, "platform", { pricePoints: 0 }, "PATCH")).status).toBe(400)
    expect(
      (await send("/api/merchant/products/x", "platform", { stockDelta: 1 }, "PATCH")).status,
    ).toBe(404)
    expect(calls).toEqual([])
  })
})

describe("transfer and shipping routes", () => {
  const sourceGroup = "66666666-6666-4666-8666-666666666666"
  const resourceId = "77777777-7777-4777-8777-777777777777"
  const shipBody = { ids: [resourceId], sourceGroupId: sourceGroup }
  const transferBody = { ...shipBody, kind: "account", targetGroupId: ownGroup }
  const shipPath = `/api/merchant/orders/${orderId}/ship`

  it("hides the merchant endpoints from non-platform users", async () => {
    for (const token of ["operator", "sales", "tenant"]) {
      const { auditRepository, calls, send } = setup()
      const list = `/api/merchant/transferable/accounts?groupId=${sourceGroup}`
      expect((await send(shipPath, token, shipBody)).status).toBe(404)
      expect((await send("/api/merchant/transfers", token, transferBody)).status).toBe(404)
      expect((await send(list, token, undefined, "GET")).status).toBe(404)
      expect((await send("/api/merchant/transfers", token, undefined, "GET")).status).toBe(404)
      expect(calls).toEqual([])
      expect(auditRepository.all().map((event) => event.outcome)).toEqual([
        "denied",
        "denied",
        "denied",
        "denied",
      ])
    }
  })

  it("requires a login", async () => {
    const { calls, send } = setup()
    expect((await send(shipPath, null, shipBody)).status).toBe(401)
    expect((await send("/api/merchant/transfers", null, transferBody)).status).toBe(401)
    expect(calls).toEqual([])
  })

  it("ships an order and audits it once, not on a retry", async () => {
    const { auditRepository, calls, send } = setup()
    expect((await send(shipPath, "platform", shipBody)).status).toBe(200)
    expect(calls).toEqual([
      { args: { input: shipBody, requestedOrder: orderId }, method: "shipOrder" },
    ])
    const events = auditRepository.all().filter((event) => event.action === "mall.order.ship")
    expect(events).toHaveLength(1)
    expect(events[0]?.metadata).toMatchObject({ groupId: ownGroup, sourceGroupId: sourceGroup })

    const replay = setup({
      shipOrder: async () => ({ groupId: ownGroup, moved: 0, orderNo: "M1", replayed: true }),
    })
    expect((await replay.send(shipPath, "platform", shipBody)).status).toBe(200)
    expect(replay.auditRepository.all()).toEqual([])
  })

  it("transfers resources and audits the target group", async () => {
    const { auditRepository, calls, send } = setup()
    expect((await send("/api/merchant/transfers", "platform", transferBody)).status).toBe(200)
    expect(calls).toEqual([{ args: transferBody, method: "transfer" }])
    const events = auditRepository
      .all()
      .filter((event) => event.action === "mall.resource.transfer")
    expect(events[0]?.metadata).toMatchObject({ count: "1", groupId: ownGroup, kind: "account" })
  })

  it.each([
    { ...shipBody, ids: [] },
    { ...shipBody, ids: [resourceId, resourceId] },
    { ...shipBody, ids: ["x"] },
    { ...shipBody, ids: Array.from({ length: 1001 }, () => crypto.randomUUID()) },
    { ids: [resourceId] },
  ])("rejects an invalid shipment %#", async (body) => {
    const { calls, send } = setup()
    expect((await send(shipPath, "platform", body)).status).toBe(400)
    expect(calls).toEqual([])
  })

  it("rejects a malformed transfer and requires a source group to list", async () => {
    const { calls, send } = setup()
    const bad = { ...transferBody, kind: "device" }
    expect((await send("/api/merchant/transfers", "platform", bad)).status).toBe(400)
    expect(
      (await send("/api/merchant/transferable/accounts", "platform", undefined, "GET")).status,
    ).toBe(400)
    expect((await send("/api/merchant/orders/x/ship", "platform", shipBody)).status).toBe(404)
    expect(calls).toEqual([])
  })

  it("lists each kind from its own path", async () => {
    const { calls, send } = setup()
    const query = `?groupId=${sourceGroup}&shippableOnly=true`
    for (const path of ["accounts", "proxies"]) {
      const response = await send(
        `/api/merchant/transferable/${path}${query}`,
        "platform",
        undefined,
        "GET",
      )
      expect(response.status).toBe(200)
    }
    expect(calls.map((call) => (call.args as { kind: string }).kind)).toEqual(["account", "proxy"])
    expect(calls[0]?.args).toMatchObject({ filter: { groupId: sourceGroup, shippableOnly: true } })
  })

  it("returns which items blocked the move", async () => {
    const { send } = setup({
      transfer: async () => {
        throw new MallError("resource_in_use", ["jp_001"])
      },
    })
    const response = await send("/api/merchant/transfers", "platform", transferBody)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "resource_in_use", items: ["jp_001"] })
  })

  it("tells the operator to retry after a deadlock", async () => {
    const { send } = setup({
      shipOrder: async () => {
        throw Object.assign(new Error("deadlock detected"), { code: "40P01" })
      },
    })
    const response = await send(shipPath, "platform", shipBody)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "resource_busy" })
  })

  it("shows buyers their shipped items only inside their own group", async () => {
    const { calls, send } = setup()
    const path = (group: string) => `/api/groups/${group}/mall/orders/${orderId}/items`
    const response = await send(path(ownGroup), "tenant", undefined, "GET")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      items: [{ id: resourceRecordId, kind: "account", name: "jp_001" }],
    })
    expect(calls).toEqual([
      { args: { groupId: ownGroup, requestedOrder: orderId }, method: "listShipment" },
    ])
    expect((await send(path(otherGroup), "tenant", undefined, "GET")).status).toBe(404)
  })
})

describe("invoice, refund and payment routes", () => {
  const invoiceId = invoiceRow.id
  const company = {
    amountYuan: "1.00",
    idempotencyKey: key,
    invoiceType: "normal",
    taxNumber: "91310000ma1k123456",
    title: "上海某公司",
    titleType: "company",
  }
  const invoicesPath = `/api/groups/${ownGroup}/mall/invoices`

  it("requires a valid tax number for a company and normalises its case", async () => {
    const { calls, send } = setup()
    expect((await send(invoicesPath, "tenant", { ...company, taxNumber: "" })).status).toBe(400)
    expect((await send(invoicesPath, "tenant", { ...company, taxNumber: "abc" })).status).toBe(400)
    // 只有 15、17、18、20 位是真实存在的长度。
    expect(
      (await send(invoicesPath, "tenant", { ...company, taxNumber: "1234567890123456" })).status,
    ).toBe(400)
    expect(calls).toEqual([])
    expect((await send(invoicesPath, "tenant", company)).status).toBe(201)
    expect(calls[0]?.args).toMatchObject({ input: { taxNumber: "91310000MA1K123456" } })
  })

  it("does not let a person request a tax number or a special invoice", async () => {
    const { calls, send } = setup()
    const person = { ...company, taxNumber: "", titleType: "personal" }
    expect((await send(invoicesPath, "tenant", { ...person, invoiceType: "special" })).status).toBe(
      400,
    )
    expect(
      (await send(invoicesPath, "tenant", { ...person, taxNumber: "91310000MA1K123456" })).status,
    ).toBe(400)
    expect(calls).toEqual([])
    expect((await send(invoicesPath, "tenant", person)).status).toBe(201)
  })

  it("lets only group members apply, and hides review from everyone but the platform", async () => {
    const { auditRepository, calls, send } = setup()
    expect((await send(invoicesPath, "platform", company)).status).toBe(404)
    for (const token of ["sales", "tenant"]) {
      const list = await send("/api/merchant/invoices", token, undefined, "GET")
      expect(list.status).toBe(404)
      const reject = `/api/merchant/invoices/${invoiceId}/reject`
      expect((await send(reject, token, { reason: "x" })).status).toBe(404)
      const refund = `/api/merchant/orders/${orderId}/refund`
      expect((await send(refund, token, { reason: "x", reclaim: true })).status).toBe(404)
      const file = `/api/merchant/invoices/${invoiceId}/file`
      expect((await send(file, token, undefined, "GET")).status).toBe(404)
    }
    expect(calls).toEqual([])
    expect(auditRepository.all().every((event) => event.outcome === "denied")).toBe(true)
  })

  const issue = (
    app: ReturnType<typeof setup>,
    fields: Record<string, string | File>,
    headers: Record<string, string> = {},
  ) => {
    const form = new FormData()
    for (const [name, value] of Object.entries(fields)) form.append(name, value)
    return app.raw(`/api/merchant/invoices/${invoiceId}/issue`, form, headers)
  }

  it("issues with a number and an optional PDF only", async () => {
    const app = setup()
    expect((await issue(app, {})).status).toBe(400)
    const fake = new File(["not a pdf"], "a.pdf", { type: "application/pdf" })
    expect((await issue(app, { file: fake, invoiceNumber: "N1" })).status).toBe(400)
    const big = new File(["%PDF-", "x".repeat(5 * 1024 * 1024)], "a.pdf")
    expect((await issue(app, { file: big, invoiceNumber: "N1" })).status).toBe(413)
    expect(app.calls).toEqual([])

    const pdf = new File(["%PDF-1.7"], "../../etc/passwd.pdf", { type: "application/pdf" })
    expect((await issue(app, { file: pdf, invoiceNumber: "N1" })).status).toBe(200)
    const args = app.calls[0]?.args as { input: { file: { fileName: string } } }
    // 文件名由服务端生成，不信任上传的名字。
    expect(args.input.file.fileName).toBe("发票-N1.pdf")
    expect(app.auditRepository.all().map((event) => event.action)).toContain("mall.invoice.issue")
  })

  it("refuses an oversized upload before reading it", async () => {
    const app = setup()
    const response = await issue(
      app,
      { invoiceNumber: "N1" },
      { "content-length": String(6 * 1024 * 1024) },
    )
    expect(response.status).toBe(413)
    expect(app.calls).toEqual([])
  })

  it("serves the file as a download scoped to the group", async () => {
    const { calls, send } = setup()
    const path = `/api/groups/${ownGroup}/mall/invoices/${invoiceId}/file`
    const response = await send(path, "tenant", undefined, "GET")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/pdf")
    expect(response.headers.get("content-disposition")).toContain("attachment")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(calls).toEqual([{ args: { groupId: ownGroup, invoiceId }, method: "invoiceFile" }])
    const other = `/api/groups/${otherGroup}/mall/invoices/${invoiceId}/file`
    expect((await send(other, "tenant", undefined, "GET")).status).toBe(404)
  })

  it("requires a reason to refund and audits it once", async () => {
    const { auditRepository, calls, send } = setup()
    const path = `/api/merchant/orders/${orderId}/refund`
    expect((await send(path, "platform", { reason: " ", reclaim: true })).status).toBe(400)
    expect((await send(path, "platform", { reason: "退货" })).status).toBe(400)
    expect(calls).toEqual([])
    expect((await send(path, "platform", { reason: "退货", reclaim: false })).status).toBe(200)
    const events = auditRepository.all().filter((event) => event.action === "mall.order.refund")
    expect(events).toHaveLength(1)
  })

  it("hides stock locations from buyers and caps stock at what can ship", async () => {
    const { send } = setup({
      listProducts: async () => ({
        items: [
          {
            ...product,
            available: 2,
            inventoryGroupId: otherGroup,
            inventoryGroupName: "平台库存",
            stock: 5,
          },
        ],
        total: 1,
      }),
    })
    const buyer = await send("/api/mall/products", "tenant", undefined, "GET")
    const items = ((await buyer.json()) as { items: Record<string, unknown>[] }).items
    expect(items[0]?.["stock"]).toBe(2)
    expect(items[0]).not.toHaveProperty("inventoryGroupName")
    expect(items[0]).not.toHaveProperty("available")
    const merchant = await send("/api/merchant/products", "platform", undefined, "GET")
    const raw = ((await merchant.json()) as { items: Record<string, unknown>[] }).items
    expect(raw[0]).toMatchObject({ available: 2, inventoryGroupName: "平台库存", stock: 5 })
  })

  it("reports payment as unavailable until Alipay is configured", async () => {
    const { calls, send } = setup()
    const config = await send("/api/mall/payment-config", "tenant", undefined, "GET")
    expect(await config.json()).toEqual({ alipay: false })
    const path = `/api/groups/${ownGroup}/mall/recharges`
    const response = await send(path, "tenant", { amountYuan: "1", idempotencyKey: key })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "alipay_unavailable" })
    expect(calls).toEqual([])
  })

  it("does not let a non-member recharge a group", async () => {
    const { send } = setup()
    const path = `/api/groups/${ownGroup}/mall/recharges`
    expect((await send(path, "platform", { amountYuan: "1", idempotencyKey: key })).status).toBe(
      404,
    )
  })

  it("answers an unsigned notify with failure, without logging in", async () => {
    const { raw } = setup()
    const form = new URLSearchParams({
      out_trade_no: "A1",
      total_amount: "1.00",
      trade_status: "TRADE_SUCCESS",
    })
    const response = await raw("/api/pay/alipay/mall/notify", form, {
      "content-type": "application/x-www-form-urlencoded",
    })
    expect(await response.text()).toBe("failure")
  })
})
