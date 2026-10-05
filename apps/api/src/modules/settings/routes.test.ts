import { describe, expect, it } from "bun:test"

import { createApp } from "../../app"
import { Permission, Role } from "../../lib/authorization"
import { createSecretCipher } from "../../lib/crypto"
import { createInMemoryAuditRepository } from "../audit/service"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import { createInMemorySettingsRepository } from "./repository"
import { createSettingsService } from "./service"

const administratorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const operatorId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

const createAuthenticatedApp = () => {
  const auditRepository = createInMemoryAuditRepository()
  const authService = createAuthService(
    createInMemoryAuthRepository([
      {
        email: "admin@example.com",
        groupIds: [],
        id: administratorId,
        password: "correct-horse-battery-staple",
        permissions: [Permission.ConfigurationWrite],
        role: Role.Administrator,
      },
      {
        email: "operator@example.com",
        groupIds: [],
        id: operatorId,
        password: "correct-horse-battery-staple",
        permissions: [Permission.OperationsRead],
        role: Role.Operator,
      },
    ]),
    async (password, passwordHash) => password === passwordHash,
  )
  const settingsService = createSettingsService({
    auditRepository,
    cipher: createSecretCipher("12345678901234567890123456789012"),
    repository: createInMemorySettingsRepository(),
  })
  return { app: createApp({ auditRepository, authService, settingsService }), auditRepository }
}

const login = async (app: ReturnType<typeof createApp>, email: string): Promise<string> => {
  const response = await app.request("/api/auth/login", {
    body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })
  return response.headers.get("set-cookie") ?? ""
}

describe("configuration routes", () => {
  it("allows an administrator to update task policy without returning a sensitive secret", async () => {
    // Given
    const { app } = createAuthenticatedApp()
    const cookie = await login(app, "admin@example.com")

    // When
    const response = await app.request("/api/settings/system", {
      body: JSON.stringify({
        notificationWebhookSecret: "secret-webhook-value",
        systemName: "研发运营中心",
        taskPolicy: { maxAttempts: 4, retryDelaySeconds: 90 },
      }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PATCH",
    })

    // Then
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      notificationWebhookConfigured: true,
      systemName: "研发运营中心",
      taskPolicy: { maxAttempts: 4, retryDelaySeconds: 90 },
    })
  })

  it("hides system settings from an operator and records the denied access", async () => {
    // Given
    const { app, auditRepository } = createAuthenticatedApp()
    const cookie = await login(app, "operator@example.com")

    // When
    const response = await app.request("/api/settings/system", { headers: { Cookie: cookie } })

    // Then
    expect(response.status).toBe(404)
    expect(auditRepository.all()).toContainEqual(
      expect.objectContaining({
        action: "settings.read",
        actorId: operatorId,
        outcome: "denied",
      }),
    )
  })
})
