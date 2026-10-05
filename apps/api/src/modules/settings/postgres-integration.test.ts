import { afterEach, describe, expect, it } from "bun:test"
import { z } from "zod"

import { createApp } from "../../app"
import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { createSecretCipher } from "../../lib/crypto"
import { createPostgresAuditRepository, writeAuditEvent } from "../audit/service"
import { createPostgresAuthRepository } from "../auth/postgres-repository"
import { createAuthService } from "../auth/service"
import { createPostgresPagePermissionRepository } from "../members/page-permission-repository"
import { createPostgresMemberRepository } from "../members/repository"
import { createMemberService } from "../members/service"
import { createPostgresSettingsRepository } from "./repository"
import { createSettingsService } from "./service"

const databaseIntegrationTest = hasConfiguredTestDatabase ? it : it.skip
const administratorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const auditActorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const groupId = "11111111-1111-4111-8111-111111111111"
const webhookSecret = "secret-webhook-value"
const CreatedMemberSchema = z.object({ id: z.string().uuid() })
const AuditPageSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), target: z.string() })),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
})
const MemberAuditPageSchema = z.object({
  items: z.array(
    z.object({
      metadata: z.object({ groupId: z.string().uuid() }),
      target: z.string(),
    }),
  ),
})
let activeDatabase: MigratedTestDatabase | null = null

afterEach(async () => {
  if (activeDatabase !== null) {
    await activeDatabase.close()
    activeDatabase = null
  }
})

describe("configuration, members, and audit PostgreSQL integration", () => {
  databaseIntegrationTest(
    "encrypts settings, disables member sessions, and lists filtered immutable audit events",
    async () => {
      // Given
      activeDatabase = await createMigratedTestDatabase()
      const client = activeDatabase.client
      await client`insert into access_group (id, name) values (${groupId}, ${"Operations"})`
      await client`
        insert into app_user (id, email, password_hash, role, enabled)
        values (
          ${administratorId},
          ${"admin@example.com"},
          ${await Bun.password.hash("correct-horse-battery-staple")},
          ${"administrator"},
          true
        )
      `
      await client`
        insert into app_user (id, email, password_hash, role, enabled)
        values (${auditActorId}, ${"auditor@example.com"}, ${"unused"}, ${"operator"}, true)
      `
      const auditRepository = createPostgresAuditRepository(client)
      const authService = createAuthService(createPostgresAuthRepository(client))
      const settingsService = createSettingsService({
        auditRepository,
        cipher: createSecretCipher("12345678901234567890123456789012"),
        repository: createPostgresSettingsRepository(client),
      })
      const app = createApp({
        auditExplorerRepository: auditRepository,
        auditRepository,
        authService,
        memberService: createMemberService({
          auditRepository,
          pagePermissions: createPostgresPagePermissionRepository(client),
          repository: createPostgresMemberRepository(client),
        }),
        settingsService,
      })
      const login = await app.request("/api/auth/login", {
        body: JSON.stringify({
          email: "admin@example.com",
          password: "correct-horse-battery-staple",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      const cookie = login.headers.get("set-cookie") ?? ""

      // When
      const settings = await app.request("/api/settings/system", {
        body: JSON.stringify({
          notificationWebhookSecret: webhookSecret,
          systemName: "研发运营中心",
          taskPolicy: { maxAttempts: 4, retryDelaySeconds: 90 },
        }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "PATCH",
      })
      const created = await app.request("/api/members", {
        body: JSON.stringify({
          email: "operator@example.com",
          groupIds: [groupId],
          password: "operator-password-123",
          role: "operator",
        }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "POST",
      })
      const member = CreatedMemberSchema.parse(await created.json())
      const memberLogin = await app.request("/api/auth/login", {
        body: JSON.stringify({ email: "operator@example.com", password: "operator-password-123" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      const memberCookie = memberLogin.headers.get("set-cookie") ?? ""
      const disabled = await app.request(`/api/members/${member.id}`, {
        body: JSON.stringify({ enabled: false, groupIds: [groupId], role: "operator" }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "PATCH",
      })
      const oldSessionAfterDisable = await app.request("/api/auth/session", {
        headers: { Cookie: memberCookie },
      })
      const enabled = await app.request(`/api/members/${member.id}`, {
        body: JSON.stringify({ enabled: true, groupIds: [groupId], role: "operator" }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "PATCH",
      })
      const oldSessionAfterEnable = await app.request("/api/auth/session", {
        headers: { Cookie: memberCookie },
      })
      const enabledMemberLogin = await app.request("/api/auth/login", {
        body: JSON.stringify({ email: "operator@example.com", password: "operator-password-123" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      const roleChanged = await app.request(`/api/members/${member.id}`, {
        body: JSON.stringify({ enabled: true, groupIds: [groupId], role: "administrator" }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "PATCH",
      })
      const oldSessionAfterRoleChange = await app.request("/api/auth/session", {
        headers: { Cookie: enabledMemberLogin.headers.get("set-cookie") ?? "" },
      })
      const roleChangedMemberLogin = await app.request("/api/auth/login", {
        body: JSON.stringify({ email: "operator@example.com", password: "operator-password-123" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      const groupsChanged = await app.request(`/api/members/${member.id}`, {
        body: JSON.stringify({ enabled: true, groupIds: [], role: "administrator" }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "PATCH",
      })
      const oldSessionAfterGroupChange = await app.request("/api/auth/session", {
        headers: { Cookie: roleChangedMemberLogin.headers.get("set-cookie") ?? "" },
      })
      const memberCreateAudit = await app.request(
        `/api/audit?action=member.create&groupId=${groupId}`,
        {
          headers: { Cookie: cookie },
        },
      )
      const memberUpdateAudit = await app.request(
        `/api/audit?action=member.update&groupId=${groupId}`,
        {
          headers: { Cookie: cookie },
        },
      )
      await writeAuditEvent(auditRepository, {
        action: "resource.allocate",
        actorId: administratorId,
        metadata: { groupId },
        outcome: "allowed",
        target: "resource:demo",
      })
      const audit = await app.request(`/api/audit?action=resource.allocate&groupId=${groupId}`, {
        headers: { Cookie: cookie },
      })
      const firstAuditId = crypto.randomUUID()
      const secondAuditId = crypto.randomUUID()
      const ignoredAuditId = crypto.randomUUID()
      await client`
        insert into audit_event (id, actor_id, action, outcome, target, metadata, created_at)
        values
          (${firstAuditId}, ${auditActorId}, ${"task.retry"}, ${"allowed"}, ${"task:target"}, ${client.json({ groupId })}, ${new Date("2026-09-12T00:00:00.000Z")}),
          (${secondAuditId}, ${auditActorId}, ${"task.retry"}, ${"allowed"}, ${"task:target"}, ${client.json({ groupId })}, ${new Date("2026-09-12T01:00:00.000Z")}),
          (${ignoredAuditId}, ${administratorId}, ${"task.retry"}, ${"allowed"}, ${"task:target"}, ${client.json({ groupId })}, ${new Date("2026-09-12T01:00:00.000Z")})
      `
      const auditFilters = new URLSearchParams({
        actorId: auditActorId,
        createdAfter: "2026-09-11T23:00:00.000Z",
        createdBefore: "2026-09-12T02:00:00.000Z",
        page: "2",
        pageSize: "1",
        target: "task:target",
      })
      const pagedAudit = await app.request(`/api/audit?${auditFilters}`, {
        headers: { Cookie: cookie },
      })
      const stored = await client<{ readonly encryptedValue: string }[]>`
        select encrypted_value as "encryptedValue" from system_setting where key = ${"system"}
      `

      // Then
      expect(settings.status).toBe(200)
      expect(JSON.stringify(await settings.json())).not.toContain(webhookSecret)
      expect(created.status).toBe(201)
      expect(memberLogin.status).toBe(200)
      expect(disabled.status).toBe(200)
      expect(oldSessionAfterDisable.status).toBe(401)
      expect(enabled.status).toBe(200)
      expect(oldSessionAfterEnable.status).toBe(401)
      expect(enabledMemberLogin.status).toBe(200)
      expect(roleChanged.status).toBe(200)
      expect(oldSessionAfterRoleChange.status).toBe(401)
      expect(roleChangedMemberLogin.status).toBe(200)
      expect(groupsChanged.status).toBe(200)
      expect(oldSessionAfterGroupChange.status).toBe(401)
      expect(stored[0]?.encryptedValue).not.toContain(webhookSecret)
      expect((await settingsService.get()).taskPolicy).toEqual({
        maxAttempts: 4,
        retryDelaySeconds: 90,
      })
      await expect(audit.json()).resolves.toMatchObject({
        items: [expect.objectContaining({ action: "resource.allocate", metadata: { groupId } })],
      })
      expect(memberCreateAudit.status).toBe(200)
      expect(MemberAuditPageSchema.parse(await memberCreateAudit.json()).items).toContainEqual({
        metadata: { groupId },
        target: `member:${member.id}`,
      })
      expect(memberUpdateAudit.status).toBe(200)
      expect(MemberAuditPageSchema.parse(await memberUpdateAudit.json()).items).toContainEqual({
        metadata: { groupId },
        target: `member:${member.id}`,
      })
      expect(pagedAudit.status).toBe(200)
      expect(AuditPageSchema.parse(await pagedAudit.json())).toEqual({
        items: [{ id: firstAuditId, target: "task:target" }],
        page: 2,
        pageSize: 1,
        total: 2,
      })
    },
  )
})
