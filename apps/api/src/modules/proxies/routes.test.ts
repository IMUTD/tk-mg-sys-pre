import { describe, expect, it } from "bun:test"

import { createApp } from "../../app"
import { GroupIdSchema, Permission, Role } from "../../lib/authorization"
import { createInMemoryAuditRepository } from "../audit/service"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import { type OperationProxy, ProxyIdSchema, type ProxyPage } from "./repository"
import type { ProxyService } from "./service"

const groupId = "11111111-1111-4111-8111-111111111111"
const hiddenGroupId = "22222222-2222-4222-8222-222222222222"
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

const proxy: OperationProxy = {
  createdAt: new Date("2026-09-12T00:00:00.000Z"),
  credentialState: "configured",
  endpoint: "10.0.0.5:8080",
  groupId: GroupIdSchema.parse(groupId),
  id: ProxyIdSchema.parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  name: "华东代理",
  note: "",
  status: "ready",
  tags: ["华东"],
  updatedAt: new Date("2026-09-12T00:00:00.000Z"),
}

const proxyService: ProxyService = {
  create: async () => proxy,
  delete: async () => 0,
  list: async (): Promise<ProxyPage> => ({ items: [proxy], page: 1, pageSize: 20, total: 1 }),
  update: async () => proxy,
}

const createAuthenticatedApp = (permissions: readonly Permission[]) => {
  const auditRepository = createInMemoryAuditRepository()
  const authService = createAuthService(
    createInMemoryAuthRepository([
      {
        email: "operator@example.com",
        groupIds: [groupId],
        id: actorId,
        password: "correct-horse-battery-staple",
        permissions,
        role: Role.Operator,
      },
    ]),
    async (password, passwordHash) => password === passwordHash,
  )
  return {
    app: createApp({ auditRepository, authService, proxyService }),
    auditRepository,
  }
}

const login = async (app: ReturnType<typeof createApp>): Promise<string> => {
  const response = await app.request("/api/auth/login", {
    body: JSON.stringify({
      email: "operator@example.com",
      password: "correct-horse-battery-staple",
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })
  return response.headers.get("set-cookie") ?? ""
}

describe("proxy routes", () => {
  it("hides a proxy group outside the operator scope and audits the denial", async () => {
    // Given
    const { app, auditRepository } = createAuthenticatedApp([Permission.OperationsRead])
    const cookie = await login(app)

    // When
    const response = await app.request(`/api/groups/${hiddenGroupId}/operations/proxies`, {
      headers: { Cookie: cookie },
    })

    // Then
    expect(response.status).toBe(404)
    expect(auditRepository.all()).toContainEqual(
      expect.objectContaining({ action: "proxy.list", outcome: "denied" }),
    )
  })

  it("denies a proxy mutation without operation write permission and audits the denial", async () => {
    // Given
    const { app, auditRepository } = createAuthenticatedApp([Permission.OperationsRead])
    const cookie = await login(app)

    // When
    const response = await app.request(`/api/groups/${groupId}/operations/proxies`, {
      body: JSON.stringify({
        credentials: "proxy-user:secret",
        endpoint: "10.0.0.5:8080",
        name: "华东代理",
      }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST",
    })

    // Then
    expect(response.status).toBe(403)
    expect(auditRepository.all()).toContainEqual(
      expect.objectContaining({ action: "proxy.create", outcome: "denied" }),
    )
  })

  it("returns a stable bad request for a malformed proxy ID", async () => {
    // Given
    const { app } = createAuthenticatedApp([Permission.OperationsWrite])
    const cookie = await login(app)

    // When
    const response = await app.request(`/api/groups/${groupId}/operations/proxies/not-a-uuid`, {
      body: JSON.stringify({ name: "更新代理" }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PATCH",
    })

    // Then
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "invalid_proxy_id" })
  })
})
