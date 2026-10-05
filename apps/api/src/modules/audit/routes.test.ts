import { describe, expect, it } from "bun:test"

import { createApp } from "../../app"
import { Permission, Role } from "../../lib/authorization"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import { createInMemoryAuditRepository, writeAuditEvent } from "./service"

const administratorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const operatorId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const groupId = "11111111-1111-4111-8111-111111111111"

describe("audit explorer routes", () => {
  it("pages immutable audit events filtered by action and group", async () => {
    // Given
    const auditRepository = createInMemoryAuditRepository()
    await writeAuditEvent(auditRepository, {
      action: "member.update",
      actorId: administratorId,
      metadata: { groupId },
      outcome: "allowed",
      target: "member:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    })
    await writeAuditEvent(auditRepository, {
      action: "settings.update",
      actorId: administratorId,
      outcome: "allowed",
      target: "settings:system",
    })
    const app = createApp({
      auditExplorerRepository: auditRepository,
      auditRepository,
      authService: createAuthService(
        createInMemoryAuthRepository([
          {
            email: "admin@example.com",
            groupIds: [groupId],
            id: administratorId,
            password: "correct-horse-battery-staple",
            permissions: [Permission.ConfigurationWrite],
            role: Role.Administrator,
          },
          {
            email: "operator@example.com",
            groupIds: [groupId],
            id: operatorId,
            password: "correct-horse-battery-staple",
            permissions: [Permission.OperationsRead],
            role: Role.Operator,
          },
        ]),
        async (password, passwordHash) => password === passwordHash,
      ),
    })
    const login = await app.request("/api/auth/login", {
      body: JSON.stringify({
        email: "admin@example.com",
        password: "correct-horse-battery-staple",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })

    // When
    const response = await app.request(
      `/api/audit?action=member.update&groupId=${groupId}&page=1&pageSize=10`,
      {
        headers: { Cookie: login.headers.get("set-cookie") ?? "" },
      },
    )

    // Then
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ action: "member.update", metadata: { groupId } })],
      page: 1,
      pageSize: 10,
      total: 1,
    })
  })
})

describe("audit explorer authorization", () => {
  it("hides audit records from an operator and records the denial", async () => {
    // Given
    const auditRepository = createInMemoryAuditRepository()
    const app = createApp({
      auditExplorerRepository: auditRepository,
      auditRepository,
      authService: createAuthService(
        createInMemoryAuthRepository([
          {
            email: "operator@example.com",
            groupIds: [groupId],
            id: operatorId,
            password: "correct-horse-battery-staple",
            permissions: [Permission.OperationsRead],
            role: Role.Operator,
          },
        ]),
        async (password, passwordHash) => password === passwordHash,
      ),
    })
    const login = await app.request("/api/auth/login", {
      body: JSON.stringify({
        email: "operator@example.com",
        password: "correct-horse-battery-staple",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })

    // When
    const response = await app.request(`/api/audit?groupId=${groupId}`, {
      headers: { Cookie: login.headers.get("set-cookie") ?? "" },
    })

    // Then
    expect(response.status).toBe(404)
    expect(auditRepository.all()).toContainEqual(
      expect.objectContaining({ action: "audit.list", actorId: operatorId, outcome: "denied" }),
    )
  })
})
