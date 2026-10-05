import { afterEach, describe, expect, it } from "bun:test"

import { createProductionApp, type ProductionApp } from "../../composition"
import {
  createMigratedTestDatabase,
  getTestDatabaseUrl,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { Role, UserIdSchema } from "../../lib/authorization"
import { createPostgresAuditRepository } from "../audit/service"
import { createPostgresAuthRepository } from "./postgres-repository"

const databaseIntegrationTest = hasConfiguredTestDatabase ? it : it.skip
let activeDatabase: MigratedTestDatabase | null = null
let activeProductionApp: ProductionApp | null = null

afterEach(async () => {
  if (activeProductionApp !== null) {
    await activeProductionApp.close()
    activeProductionApp = null
  }
  if (activeDatabase !== null) {
    await activeDatabase.close()
    activeDatabase = null
  }
})

describe("createPostgresAuthRepository", () => {
  databaseIntegrationTest(
    "enforces database-backed role and group denials, then revokes the persisted session",
    async () => {
      // Given
      activeDatabase = await createMigratedTestDatabase()
      const client = activeDatabase.client
      const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      const password = "correct-horse-battery-staple"
      const passwordHash = await Bun.password.hash(password)
      const assignedGroupId = "11111111-1111-4111-8111-111111111111"
      const hiddenGroupId = "22222222-2222-4222-8222-222222222222"
      await client`insert into access_group (id, name) values (${assignedGroupId}, ${"Operators"})`
      await client`insert into access_group (id, name) values (${hiddenGroupId}, ${"Hidden"})`
      await client`
      insert into app_user (id, email, password_hash, role)
      values (${userId}, ${"operator@example.com"}, ${passwordHash}, ${Role.Operator})
    `
      await client`insert into user_group (user_id, group_id) values (${userId}, ${assignedGroupId})`
      activeProductionApp = createProductionApp({
        databaseUrl: getTestDatabaseUrl(),
        redisUrl: "redis://127.0.0.1:6379",
        secretEncryptionKey: "12345678901234567890123456789012",
        systemActorId: userId,
      })
      const app = activeProductionApp.app

      // When
      const loginResponse = await app.request("/api/auth/login", {
        body: JSON.stringify({ email: "operator@example.com", password }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      const cookie = loginResponse.headers.get("set-cookie")
      const response = await app.request("/api/foundation/configuration", {
        headers: { Cookie: cookie ?? "" },
      })
      const hiddenGroupResponse = await app.request(`/api/groups/${hiddenGroupId}/resources`, {
        headers: { Cookie: cookie ?? "" },
      })
      const logoutResponse = await app.request("/api/auth/logout", {
        headers: { Cookie: cookie ?? "" },
        method: "POST",
      })
      const sessionResponse = await app.request("/api/auth/session", {
        headers: { Cookie: cookie ?? "" },
      })
      const sessions = await client<{ readonly tokenHash: string }[]>`
      select token_hash as "tokenHash" from app_session
    `
      const revokedSessions = await client<{ readonly revokedAt: Date | null }[]>`
      select revoked_at as "revokedAt" from app_session
    `
      const auditEvents = await client<{ readonly action: string; readonly outcome: string }[]>`
      select action, outcome from audit_event
    `

      // Then
      expect(loginResponse.status).toBe(200)
      expect(response.status).toBe(403)
      expect(hiddenGroupResponse.status).toBe(404)
      expect(logoutResponse.status).toBe(204)
      expect(sessionResponse.status).toBe(401)
      expect(Array.from(sessions)).toHaveLength(1)
      expect(sessions[0]?.tokenHash).not.toContain(cookie ?? "")
      expect(revokedSessions[0]?.revokedAt).toBeInstanceOf(Date)
      expect(Array.from(auditEvents)).toEqual([
        { action: "configuration.write", outcome: "denied" },
        { action: "resource.export", outcome: "denied" },
      ])
    },
  )

  databaseIntegrationTest(
    "loads group-scoped users, persists opaque sessions, and appends audit events",
    async () => {
      // Given
      activeDatabase = await createMigratedTestDatabase()
      const client = activeDatabase.client
      const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      const groupId = "11111111-1111-4111-8111-111111111111"
      await client`insert into access_group (id, name) values (${groupId}, ${"Operators"})`
      await client`
      insert into app_user (id, email, password_hash, role)
      values (${userId}, ${"operator@example.com"}, ${"password-hash"}, ${Role.Operator})
    `
      await client`insert into user_group (user_id, group_id) values (${userId}, ${groupId})`
      const repository = createPostgresAuthRepository(client)
      const auditRepository = createPostgresAuditRepository(client)

      // When
      const user = await repository.findUserByEmail("operator@example.com")
      await repository.createSession({
        expiresAt: new Date(Date.now() + 60_000),
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        tokenHash: "opaque-session-hash",
        userId: UserIdSchema.parse(userId),
      })
      await auditRepository.append({
        action: "resource.export",
        actorId: userId,
        outcome: "allowed",
        target: `group:${groupId}`,
      })
      const session = await repository.findSessionByTokenHash("opaque-session-hash")

      // Then
      expect(user).toEqual(
        expect.objectContaining({
          email: "operator@example.com",
          scope: expect.objectContaining({ groupIds: [groupId], role: Role.Operator }),
        }),
      )
      expect(session).toEqual(
        expect.objectContaining({ revokedAt: null, userId: UserIdSchema.parse(userId) }),
      )
      const auditEvents = await client<{ readonly action: string; readonly outcome: string }[]>`
      select action, outcome from audit_event
    `
      expect(Array.from(auditEvents)).toEqual([{ action: "resource.export", outcome: "allowed" }])
    },
  )
})
