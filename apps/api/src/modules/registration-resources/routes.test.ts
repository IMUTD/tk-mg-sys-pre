import { describe, expect, it } from "bun:test"

import { createApp } from "../../app"
import { type Permission, Role } from "../../lib/authorization"
import { createSecretCipher } from "../../lib/crypto"
import { createInMemoryAuditRepository } from "../audit/service"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import { createInMemoryRegistrationResourceRepository } from "./repository"
import { createRegistrationResourceService } from "./service"

const groupId = "11111111-1111-4111-8111-111111111111"
const hiddenGroupId = "22222222-2222-4222-8222-222222222222"

const createAuthenticatedApp = (
  permissions: readonly Permission[] = ["resources:read", "resources:write"],
) => {
  const auditRepository = createInMemoryAuditRepository()
  const authService = createAuthService(
    createInMemoryAuthRepository([
      {
        email: "operator@example.com",
        groupIds: [groupId],
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        password: "correct-horse-battery-staple",
        permissions,
        role: Role.Operator,
      },
    ]),
    async (password, passwordHash) => password === passwordHash,
  )
  const registrationResourceService = createRegistrationResourceService({
    auditRepository,
    cipher: createSecretCipher("12345678901234567890123456789012"),
    repository: createInMemoryRegistrationResourceRepository(auditRepository),
  })
  return {
    app: createApp({ auditRepository, authService, registrationResourceService }),
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

describe("registration resource routes", () => {
  it("previews, imports, and exports masked data inside an authorized group", async () => {
    // Given
    const { app } = createAuthenticatedApp()
    const cookie = await login(app)

    // When
    const preview = await app.request(
      `/api/groups/${groupId}/registration-resources/import/preview`,
      {
        body: JSON.stringify({ content: "person@gmail.com----secret" }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "POST",
      },
    )
    const imported = await app.request(`/api/groups/${groupId}/registration-resources/imports`, {
      body: JSON.stringify({ content: "person@gmail.com----secret", tags: ["gmail"] }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST",
    })
    const exported = await app.request(`/api/groups/${groupId}/registration-resources/export`, {
      headers: { Cookie: cookie },
    })

    // Then
    expect(preview.status).toBe(200)
    expect(imported.status).toBe(201)
    expect(JSON.stringify(await preview.clone().json())).not.toContain("secret")
    expect(JSON.stringify(await imported.clone().json())).not.toContain("secret")
    const csv = await exported.text()
    expect(csv).toContain("p***@gmail.com")
    expect(csv).not.toContain("secret")
  })

  it("denies resource mutations when an operator has only read permission", async () => {
    // Given
    const { app } = createAuthenticatedApp(["resources:read"])
    const cookie = await login(app)

    // When
    const response = await app.request(`/api/groups/${groupId}/registration-resources/imports`, {
      body: JSON.stringify({ content: "person@gmail.com----secret" }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST",
    })

    // Then
    expect(response.status).toBe(403)
  })

  it("hides a group outside the operator scope and audits the denied request", async () => {
    // Given
    const { app, auditRepository } = createAuthenticatedApp()
    const cookie = await login(app)

    // When
    const response = await app.request(`/api/groups/${hiddenGroupId}/registration-resources`, {
      headers: { Cookie: cookie },
    })

    // Then
    expect(response.status).toBe(404)
    expect(auditRepository.all()).toContainEqual(
      expect.objectContaining({ action: "registration-resource.list", outcome: "denied" }),
    )
  })
})
