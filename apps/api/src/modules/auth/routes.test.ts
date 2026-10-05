import { describe, expect, it } from "bun:test"

import { createApp } from "../../app"
import { Role } from "../../lib/authorization"
import { createInMemoryAuditRepository } from "../audit/service"
import { createAuthService, createInMemoryAuthRepository } from "./service"

const verifyPlaintextForTest = async (password: string, passwordHash: string): Promise<boolean> =>
  password === passwordHash

describe("authentication routes", () => {
  it("rejects malformed login JSON without creating a session", async () => {
    // Given
    const repository = createInMemoryAuthRepository([])
    const app = createApp({
      auditRepository: createInMemoryAuditRepository(),
      authService: createAuthService(repository, verifyPlaintextForTest),
    })

    // When
    const response = await app.request("/api/auth/login", {
      body: "not-json",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })

    // Then
    expect(response.status).toBe(400)
  })

  it("creates a session at login and invalidates it at logout", async () => {
    // Given
    const repository = createInMemoryAuthRepository([
      {
        displayName: "考拉",
        email: "operator@example.com",
        groupIds: ["11111111-1111-4111-8111-111111111111"],
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        password: "correct-horse-battery-staple",
        permissions: ["resources:read"],
        role: Role.Operator,
      },
    ])
    const auditRepository = createInMemoryAuditRepository()
    const app = createApp({
      auditRepository,
      authService: createAuthService(repository, verifyPlaintextForTest),
    })

    // When
    const loginResponse = await app.request("/api/auth/login", {
      body: JSON.stringify({
        email: "operator@example.com",
        password: "correct-horse-battery-staple",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
    const cookie = loginResponse.headers.get("set-cookie")
    const logoutResponse = await app.request("/api/auth/logout", {
      headers: { Cookie: cookie ?? "" },
      method: "POST",
    })
    const sessionResponse = await app.request("/api/auth/session", {
      headers: { Cookie: cookie ?? "" },
    })

    // Then
    expect(loginResponse.status).toBe(200)
    await expect(loginResponse.json()).resolves.toMatchObject({
      user: { displayName: "考拉", email: "operator@example.com" },
    })
    expect(cookie).toContain("tk_mg_session=")
    expect(logoutResponse.status).toBe(204)
    expect(sessionResponse.status).toBe(401)
  })

  it("returns 404 and audits a group resource request outside an operator scope", async () => {
    // Given
    const repository = createInMemoryAuthRepository([
      {
        email: "operator@example.com",
        groupIds: ["11111111-1111-4111-8111-111111111111"],
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        password: "correct-horse-battery-staple",
        permissions: ["resources:read"],
        role: Role.Operator,
      },
    ])
    const auditRepository = createInMemoryAuditRepository()
    const app = createApp({
      auditRepository,
      authService: createAuthService(repository, verifyPlaintextForTest),
    })
    const loginResponse = await app.request("/api/auth/login", {
      body: JSON.stringify({
        email: "operator@example.com",
        password: "correct-horse-battery-staple",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
    const cookie = loginResponse.headers.get("set-cookie")

    // When
    const response = await app.request(
      "/api/groups/22222222-2222-4222-8222-222222222222/resources",
      {
        headers: { Cookie: cookie ?? "" },
      },
    )

    // Then
    expect(response.status).toBe(404)
    expect(auditRepository.all()).toContainEqual(
      expect.objectContaining({ action: "resource.export", outcome: "denied" }),
    )
  })
})
