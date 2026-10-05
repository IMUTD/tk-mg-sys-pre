import { describe, expect, it } from "bun:test"

import { createApp } from "../../app"
import { Permission, Role } from "../../lib/authorization"
import { createInMemoryAuditRepository } from "../audit/service"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import { createInMemoryAccountPoolRepository } from "./repository"
import { createAccountPoolService } from "./service"

const groupId = "11111111-1111-4111-8111-111111111111"
const accountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const operatorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const otherOperatorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const administratorId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const password = "correct-horse-battery-staple"

const createAuthenticatedApp = () => {
  const auditRepository = createInMemoryAuditRepository()
  const authService = createAuthService(
    createInMemoryAuthRepository([
      {
        email: "operator@example.com",
        groupIds: [groupId],
        id: operatorId,
        password,
        permissions: [Permission.OperationsWrite],
        role: Role.Operator,
      },
      {
        email: "other@example.com",
        groupIds: [groupId],
        id: otherOperatorId,
        password,
        permissions: [Permission.OperationsWrite],
        role: Role.Operator,
      },
      {
        email: "admin@example.com",
        groupIds: [],
        id: administratorId,
        password,
        permissions: [],
        role: Role.Administrator,
      },
    ]),
    async (submitted, passwordHash) => submitted === passwordHash,
  )
  const accountPoolService = createAccountPoolService(
    createInMemoryAccountPoolRepository([{ accountId, groupId }]),
  )
  return createApp({ accountPoolService, auditRepository, authService })
}

const login = async (app: ReturnType<typeof createApp>, email: string): Promise<string> => {
  const response = await app.request("/api/auth/login", {
    body: JSON.stringify({ email, password }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })
  return response.headers.get("set-cookie") ?? ""
}

describe("account-pool routes", () => {
  it("allows only an administrator to reclaim another operator's lease", async () => {
    // Given
    const app = createAuthenticatedApp()
    const operatorCookie = await login(app, "operator@example.com")
    const otherOperatorCookie = await login(app, "other@example.com")
    const administratorCookie = await login(app, "admin@example.com")
    const path = `/api/groups/${groupId}/operations/account-pool/${accountId}/leases`
    await app.request(path, {
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json", Cookie: operatorCookie },
      method: "POST",
    })

    // When
    const operatorRelease = await app.request(path, {
      headers: { Cookie: otherOperatorCookie },
      method: "DELETE",
    })
    const administratorReclaim = await app.request(path, {
      headers: { Cookie: administratorCookie },
      method: "DELETE",
    })

    // Then
    expect(operatorRelease.status).toBe(404)
    expect(administratorReclaim.status).toBe(204)
  })

  it("returns a stable bad request for malformed account IDs on lease routes", async () => {
    // Given
    const app = createAuthenticatedApp()
    const cookie = await login(app, "operator@example.com")
    const path = `/api/groups/${groupId}/operations/account-pool/not-a-uuid/leases`

    // When
    const [lease, release] = await Promise.all([
      app.request(path, {
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "POST",
      }),
      app.request(path, { headers: { Cookie: cookie }, method: "DELETE" }),
    ])

    // Then
    for (const response of [lease, release]) {
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: "invalid_account_id" })
    }
  })
})
