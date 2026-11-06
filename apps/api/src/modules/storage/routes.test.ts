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

const cardId = "22222222-2222-4222-8222-222222222222"
const nasBody = {
  items: [
    {
      bucket: "backup",
      id: cardId,
      loginUrl: "http://192.168.76.19:8010",
      name: "机房",
      password: "nas-password",
      username: "admin",
    },
  ],
}

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
    const { app } = createAuthenticatedApp()
    const cookie = await login(app, "engineer@example.com")

    const response = await app.request("/api/storage/status", { headers: { Cookie: cookie } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [], prefix: `${operatorId}/` })
  })

  it("returns the secret to a storage viewer and hides it from the audit log", async () => {
    const { app, auditRepository } = createAuthenticatedApp()
    const adminCookie = await login(app, "admin@example.com")
    const operatorCookie = await login(app, "operator@example.com")

    const saved = await app.request("/api/storage/configuration", {
      body: JSON.stringify(nasBody),
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      method: "PATCH",
    })
    const again = await app.request("/api/storage/configuration", { headers: { Cookie: adminCookie } })
    const hidden = await app.request("/api/storage/configuration", { headers: { Cookie: operatorCookie } })

    expect(saved.status).toBe(200)
    await expect(saved.json()).resolves.toEqual({
      items: [
        {
          bucket: "backup",
          endpoint: "http://192.168.76.19:8010",
          id: cardId,
          loginUrl: "http://192.168.76.19:8010",
          name: "机房",
          password: "nas-password",
          prefix: `${administratorId}/`,
          username: "admin",
        },
      ],
      prefix: `${administratorId}/`,
    })
    await expect(again.json()).resolves.toMatchObject({
      items: [{ id: cardId, password: "nas-password", prefix: `${administratorId}/` }],
    })
    expect(hidden.status).toBe(404)
    expect(JSON.stringify(auditRepository.all())).not.toContain("nas-password")
    expect(auditRepository.all()).toContainEqual(
      expect.objectContaining({
        action: "storage.configuration.read",
        actorId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        outcome: "denied",
      }),
    )
  })

  it("records the exact allowed audit event when an administrator saves storage configuration", async () => {
    const { app, auditRepository } = createAuthenticatedApp()
    const cookie = await login(app, "admin@example.com")

    const response = await app.request("/api/storage/configuration", {
      body: JSON.stringify(nasBody),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PATCH",
    })

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

  it("rejects a new card that has no password", async () => {
    const { app } = createAuthenticatedApp()
    const cookie = await login(app, "admin@example.com")

    const missing = await app.request("/api/storage/configuration", {
      body: JSON.stringify({
        items: [{ bucket: "backup", id: cardId, loginUrl: "http://192.168.76.19:8010", name: "机房", username: "admin" }],
      }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PATCH",
    })

    expect(missing.status).toBe(400)
  })

  it("keeps one card per address and bucket, and hides another administrator", async () => {
    const { app } = createAuthenticatedApp()
    const cookie = await login(app, "admin@example.com")
    const first = await app.request("/api/storage/configuration", {
      body: JSON.stringify(nasBody),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PATCH",
    })
    const duplicate = await app.request("/api/storage/configuration", {
      body: JSON.stringify({
        items: [
          ...nasBody.items,
          {
            bucket: "backup",
            id: "33333333-3333-4333-8333-333333333333",
            loginUrl: "http://192.168.76.19:8010",
            name: "另一张",
            password: "nas-password",
            username: "admin",
          },
        ],
      }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PATCH",
    })
    expect(first.status).toBe(200)
    expect(duplicate.status).toBe(400)
  })
})
