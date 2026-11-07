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
const product = {
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
  quantity: 1,
  status: "pending_ship" as const,
  title: "资源购买",
  type: "resource" as const,
  unitPoints: 100,
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
  return { auditRepository, calls, send }
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
