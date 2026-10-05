import { describe, expect, it } from "bun:test"

import { createApp } from "../../app"
import { Permission, Role } from "../../lib/authorization"
import { createSecretCipher } from "../../lib/crypto"
import { createInMemoryAuditRepository } from "../audit/service"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import { createInMemoryStorageRepository } from "./repository"
import { createStorageService } from "./service"

const administratorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const operatorId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const groupId = "11111111-1111-4111-8111-111111111111"

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
        email: "engineer@example.com",
        groupIds: [groupId],
        id: operatorId,
        password: "correct-horse-battery-staple",
        permissions: [Permission.OperationsRead],
        role: Role.Engineer,
      },
      {
        email: "operator@example.com",
        groupIds: [groupId],
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        password: "correct-horse-battery-staple",
        permissions: [Permission.OperationsRead],
        role: Role.Operator,
      },
    ]),
    async (password, passwordHash) => password === passwordHash,
  )
  const storageService = createStorageService({
    auditRepository,
    cipher: createSecretCipher("12345678901234567890123456789012"),
    repository: createInMemoryStorageRepository(),
  })
  return { app: createApp({ auditRepository, authService, storageService }), auditRepository }
}

const login = async (app: ReturnType<typeof createApp>, email: string): Promise<string> => {
  const response = await app.request("/api/auth/login", {
    body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })
  return response.headers.get("set-cookie") ?? ""
}

describe("storage routes", () => {
  it("shows an unconfigured storage status to an authorized engineer", async () => {
    // Given
    const { app } = createAuthenticatedApp()
    const cookie = await login(app, "engineer@example.com")

    // When
    const response = await app.request("/api/storage/status", { headers: { Cookie: cookie } })

    // Then
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      configuration: null,
      credentialsConfigured: false,
      state: "unconfigured",
    })
  })

  it("allows only an administrator to save a redacted storage configuration", async () => {
    // Given
    const { app, auditRepository } = createAuthenticatedApp()
    const adminCookie = await login(app, "admin@example.com")
    const operatorCookie = await login(app, "operator@example.com")

    // When
    const saved = await app.request("/api/storage/configuration", {
      body: JSON.stringify({
        credentials: { password: "nas-password", username: "nas-user" },
        host: "nas.internal",
        protocol: "smb",
        rootPath: "/TK-MG",
      }),
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      method: "PATCH",
    })
    const hidden = await app.request("/api/storage/configuration", {
      headers: { Cookie: operatorCookie },
    })

    // Then
    expect(saved.status).toBe(200)
    expect(JSON.stringify(await saved.json())).not.toContain("nas-password")
    expect(hidden.status).toBe(404)
    expect(auditRepository.all()).toContainEqual(
      expect.objectContaining({
        action: "storage.configuration.read",
        actorId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        outcome: "denied",
      }),
    )
  })

  it("records the exact allowed audit event when an administrator saves storage configuration", async () => {
    // Given
    const { app, auditRepository } = createAuthenticatedApp()
    const cookie = await login(app, "admin@example.com")

    // When
    const response = await app.request("/api/storage/configuration", {
      body: JSON.stringify({
        credentials: { password: "nas-password", username: "nas-user" },
        host: "nas.internal",
        protocol: "smb",
        rootPath: "/TK-MG",
      }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PATCH",
    })

    // Then
    expect(response.status).toBe(200)
    expect(auditRepository.all()).toContainEqual(
      expect.objectContaining({
        action: "storage.configuration.update",
        actorId: administratorId,
        outcome: "allowed",
        target: "storage:private-cloud",
      }),
    )
  })

  it("rejects an undefined storage protocol", async () => {
    // Given
    const { app } = createAuthenticatedApp()
    const cookie = await login(app, "admin@example.com")

    // When
    const response = await app.request("/api/storage/configuration", {
      body: JSON.stringify({ host: "nas.internal", protocol: "ftp", rootPath: "/TK-MG" }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PATCH",
    })

    // Then
    expect(response.status).toBe(400)
  })
})
