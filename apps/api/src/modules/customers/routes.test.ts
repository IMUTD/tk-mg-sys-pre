import { describe, expect, it } from "bun:test"

import { createApp } from "../../app"
import { Permission, Role } from "../../lib/authorization"
import { createInMemoryAuditRepository } from "../audit/service"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import {
  type Customer,
  CustomerConflictError,
  type CustomerCreateInput,
  type CustomerRepository,
} from "./repository"
import { registerCustomerRoutes } from "./routes"

const platformId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const tenantId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const password = "correct-horse-battery-staple"

const fakeRepository = () => {
  const customers = new Map<string, Customer>()
  const created: CustomerCreateInput[] = []
  const repository: CustomerRepository = {
    create: async (input) => {
      created.push(input)
      if ([...customers.values()].some((item) => item.email === input.email))
        throw new CustomerConflictError("email_taken")
      const customer: Customer = {
        boxAdminCount: 0,
        boxCount: 0,
        createdAt: new Date("2026-11-18T00:00:00Z"),
        displayName: input.displayName,
        email: input.email,
        enabled: true,
        groupId: crypto.randomUUID(),
        id: crypto.randomUUID(),
      }
      customers.set(customer.id, customer)
      return customer
    },
    list: async () => [...customers.values()],
    update: async (customerId, input) => {
      const existing = customers.get(customerId)
      if (existing === undefined) return null
      const next = { ...existing, enabled: input.enabled ?? existing.enabled }
      customers.set(customerId, next)
      return next
    },
  }
  return { created, repository }
}

const setup = () => {
  const auditRepository = createInMemoryAuditRepository()
  const authService = createAuthService(
    createInMemoryAuthRepository([
      {
        email: "platform@example.com",
        groupIds: [],
        id: platformId,
        password,
        permissions: [Permission.ConfigurationWrite],
        role: Role.Administrator,
      },
      {
        email: "tenant@example.com",
        groupIds: ["11111111-1111-4111-8111-111111111111"],
        id: tenantId,
        password,
        permissions: [Permission.ConfigurationWrite],
        restrictGroups: true,
        role: Role.Administrator,
      },
    ]),
    async (input, passwordHash) => input === passwordHash,
  )
  const app = createApp({ auditRepository, authService })
  const { created, repository } = fakeRepository()
  registerCustomerRoutes(app, authService, auditRepository, repository)
  const cookieFor = async (email: string): Promise<string> => {
    const response = await app.request("/api/auth/login", {
      body: JSON.stringify({ email, password }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
    return response.headers.get("set-cookie") ?? ""
  }
  const send = (cookie: string, method: string, path: string, body?: unknown) =>
    app.request(path, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method,
    })
  return { cookieFor, created, send }
}

describe("customer management", () => {
  it("lets the platform create, list and disable customers", async () => {
    const { cookieFor, created, send } = setup()
    const cookie = await cookieFor("platform@example.com")
    const response = await send(cookie, "POST", "/api/customers", {
      displayName: " 客户甲 ",
      email: "Customer@Example.com",
      password: "customer-pass",
    })
    expect(response.status).toBe(201)
    const customer = (await response.json()) as Customer
    expect(customer.email).toBe("customer@example.com")
    expect(customer.displayName).toBe("客户甲")
    // 密码只存哈希，记下是平台方建的。
    expect(created[0]?.passwordHash).not.toBe("customer-pass")
    expect(created[0]?.platformUserId).toBe(platformId)

    const listed = await send(cookie, "GET", "/api/customers")
    expect(((await listed.json()) as { items: Customer[] }).items).toHaveLength(1)

    const disabled = await send(cookie, "PATCH", `/api/customers/${customer.id}`, {
      enabled: false,
    })
    expect(disabled.status).toBe(200)
    expect(((await disabled.json()) as Customer).enabled).toBe(false)
  })

  it("rejects short passwords, duplicate emails and unknown customers", async () => {
    const { cookieFor, send } = setup()
    const cookie = await cookieFor("platform@example.com")
    const short = await send(cookie, "POST", "/api/customers", {
      displayName: "客户乙",
      email: "b@example.com",
      password: "short",
    })
    expect(short.status).toBe(400)
    const input = { displayName: "客户乙", email: "b@example.com", password: "long-enough" }
    expect((await send(cookie, "POST", "/api/customers", input)).status).toBe(201)
    const duplicate = await send(cookie, "POST", "/api/customers", input)
    expect(duplicate.status).toBe(409)
    await expect(duplicate.json()).resolves.toEqual({ error: "email_taken" })
    const missing = await send(cookie, "PATCH", `/api/customers/${tenantId}`, { enabled: true })
    expect(missing.status).toBe(404)
    const empty = await send(cookie, "PATCH", `/api/customers/${tenantId}`, {})
    expect(empty.status).toBe(400)
  })

  it("hides the API from anyone but the platform", async () => {
    const { cookieFor, created, send } = setup()
    const cookie = await cookieFor("tenant@example.com")
    expect((await send(cookie, "GET", "/api/customers")).status).toBe(404)
    const create = await send(cookie, "POST", "/api/customers", {
      displayName: "越权",
      email: "x@example.com",
      password: "long-enough",
    })
    expect(create.status).toBe(404)
    expect(created).toHaveLength(0)
    expect((await send("", "GET", "/api/customers")).status).toBe(401)
  })
})
