import { describe, expect, it } from "bun:test"
import { z } from "zod"

import { createApp } from "../../app"
import { Permission, Role } from "../../lib/authorization"
import { PageKey } from "../../lib/pages"
import { createInMemoryAuditRepository } from "../audit/service"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import { MEMBER_DISPLAY_NAMES } from "./display-names"
import { createInMemoryPagePermissionRepository } from "./page-permission-repository"
import { createInMemoryMemberRepository } from "./repository"
import { createMemberService } from "./service"

const administratorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const groupId = "11111111-1111-4111-8111-111111111111"
const CreatedMemberSchema = z.object({
  displayName: z.string(),
  id: z.string().uuid(),
})
const MemberListSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid() }).passthrough()),
})
const PageItemsSchema = z.object({
  items: z.array(z.object({ canDelete: z.boolean(), canView: z.boolean(), key: z.string() })),
})

const createAuthenticatedApp = () => {
  const auditRepository = createInMemoryAuditRepository()
  const authService = createAuthService(
    createInMemoryAuthRepository([
      {
        email: "admin@example.com",
        groupIds: [groupId],
        id: administratorId,
        password: "correct-horse-battery-staple",
        permissions: [Permission.ConfigurationWrite],
        role: Role.Administrator,
      },
    ]),
    async (password, passwordHash) => password === passwordHash,
  )
  const memberService = createMemberService({
    auditRepository,
    pagePermissions: createInMemoryPagePermissionRepository(),
    repository: createInMemoryMemberRepository(),
  })
  return createApp({ auditRepository, authService, memberService })
}

const login = async (app: ReturnType<typeof createApp>): Promise<string> => {
  const response = await app.request("/api/auth/login", {
    body: JSON.stringify({
      email: "admin@example.com",
      password: "correct-horse-battery-staple",
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })
  return response.headers.get("set-cookie") ?? ""
}

describe("member routes", () => {
  it("creates a member with a random display name and seeded page permissions without returning the password", async () => {
    const app = createAuthenticatedApp()
    const cookie = await login(app)
    const created = await app.request("/api/members", {
      body: JSON.stringify({
        email: "new.operator@example.com",
        password: "member-password",
        role: "operator",
      }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST",
    })
    expect(created.status).toBe(201)
    const createdBody = await created.json()
    expect(JSON.stringify(createdBody)).not.toContain("member-password")
    expect(createdBody).not.toHaveProperty("password")
    const member = CreatedMemberSchema.parse(createdBody)
    expect(MEMBER_DISPLAY_NAMES).toContain(member.displayName)
    const listed = await app.request(`/api/members/${member.id}/permissions`, {
      headers: { Cookie: cookie },
    })
    expect(listed.status).toBe(200)
    const seeded = PageItemsSchema.parse(await listed.json())
    expect(seeded.items.find((item) => item.key === PageKey.Devices)).toEqual({
      canDelete: false,
      canView: true,
      key: PageKey.Devices,
    })
    expect(seeded.items.find((item) => item.key === PageKey.StudioVideoPool)).toEqual({
      canDelete: false,
      canView: true,
      key: PageKey.StudioVideoPool,
    })
    expect(seeded.items.find((item) => item.key === PageKey.WorkLogs)).toEqual({
      canDelete: false,
      canView: false,
      key: PageKey.WorkLogs,
    })
    expect(seeded.items.find((item) => item.key === PageKey.Overview)).toEqual({
      canDelete: false,
      canView: true,
      key: PageKey.Overview,
    })
    expect(seeded.items.find((item) => item.key === PageKey.Members)).toEqual({
      canDelete: false,
      canView: false,
      key: PageKey.Members,
    })
    const updated = await app.request(`/api/members/${member.id}`, {
      body: JSON.stringify({ enabled: false, role: "administrator" }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PATCH",
    })
    await expect(updated.json()).resolves.toMatchObject({
      email: "new.operator@example.com",
      enabled: false,
      role: "administrator",
    })
    const list = await app.request("/api/members", { headers: { Cookie: cookie } })
    expect(list.status).toBe(200)
    const listedMembers = await list.json()
    expect(JSON.stringify(listedMembers)).not.toContain("member-password")
    expect(MemberListSchema.parse(listedMembers).items[0]).not.toHaveProperty("password")
  })

  it("lets an administrator fine-tune a member's final page permissions after create", async () => {
    const app = createAuthenticatedApp()
    const cookie = await login(app)
    const created = await app.request("/api/members", {
      body: JSON.stringify({
        email: "new.operator@example.com",
        password: "member-password",
        role: "operator",
      }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST",
    })
    const member = CreatedMemberSchema.parse(await created.json())
    const updated = await app.request(`/api/members/${member.id}/permissions`, {
      body: JSON.stringify({
        pages: [{ canDelete: true, canView: true, key: PageKey.Devices }],
      }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PUT",
    })
    expect(updated.status).toBe(200)
    const body = PageItemsSchema.parse(await updated.json())
    expect(body.items.find((item) => item.key === PageKey.Devices)).toEqual({
      canDelete: true,
      canView: true,
      key: PageKey.Devices,
    })
    expect(body.items.find((item) => item.key === PageKey.WorkLogs)).toEqual({
      canDelete: false,
      canView: false,
      key: PageKey.WorkLogs,
    })
    expect(body.items.find((item) => item.key === PageKey.Overview)).toEqual({
      canDelete: false,
      canView: true,
      key: PageKey.Overview,
    })
    expect(body.items.find((item) => item.key === PageKey.Members)).toEqual({
      canDelete: false,
      canView: false,
      key: PageKey.Members,
    })
  })

  it("suggests an unused display name for the create dialog", async () => {
    const app = createAuthenticatedApp()
    const cookie = await login(app)
    const response = await app.request("/api/members/display-name", {
      headers: { Cookie: cookie },
    })
    expect(response.status).toBe(200)
    const body = z.object({ displayName: z.string().min(1) }).parse(await response.json())
    expect(MEMBER_DISPLAY_NAMES).toContain(body.displayName)
  })

  it("rejects fine-tuning an administrator's page permissions", async () => {
    const app = createAuthenticatedApp()
    const cookie = await login(app)
    const created = await app.request("/api/members", {
      body: JSON.stringify({
        email: "second.admin@example.com",
        password: "member-password",
        role: "administrator",
      }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST",
    })
    const member = CreatedMemberSchema.parse(await created.json())
    const updated = await app.request(`/api/members/${member.id}/permissions`, {
      body: JSON.stringify({
        pages: [{ canDelete: false, canView: false, key: PageKey.Devices }],
      }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PUT",
    })
    expect(updated.status).toBe(409)
    await expect(updated.json()).resolves.toMatchObject({ error: "cannot_configure_administrator" })
  })

  it("creates a group, rejects duplicate emails, and deletes a member", async () => {
    const app = createAuthenticatedApp()
    const cookie = await login(app)
    const group = await app.request("/api/members/groups", {
      body: JSON.stringify({ name: "运营一组" }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST",
    })
    expect(group.status).toBe(201)
    const created = await app.request("/api/members", {
      body: JSON.stringify({
        email: "dup.operator@example.com",
        password: "member-password",
        role: "salesperson",
      }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST",
    })
    expect(created.status).toBe(201)
    const duplicate = await app.request("/api/members", {
      body: JSON.stringify({
        email: "dup.operator@example.com",
        password: "member-password",
        role: "operator",
      }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST",
    })
    expect(duplicate.status).toBe(409)
    const member = CreatedMemberSchema.parse(await created.json())
    const removed = await app.request(`/api/members/${member.id}`, {
      headers: { Cookie: cookie },
      method: "DELETE",
    })
    expect(removed.status).toBe(204)
    const self = await app.request(`/api/members/${administratorId}`, {
      headers: { Cookie: cookie },
      method: "DELETE",
    })
    expect(self.status).toBe(409)
  })
})
