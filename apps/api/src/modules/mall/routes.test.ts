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

const setup = (overrides: Partial<MallRepository> = {}) => {
  const calls: { method: string; args: unknown }[] = []
  const repository: MallRepository = {
    adjust: async (_actor, input) => {
      calls.push({ args: input, method: "adjust" })
      return { balance: 1, delta: input.delta, replayed: false }
    },
    listAllWallets: async () => ({ items: [], total: 0 }),
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
  const send = (path: string, token: string | null, body?: unknown) =>
    app.request(path, {
      ...(body === undefined ? {} : { body: JSON.stringify(body), method: "POST" as const }),
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
