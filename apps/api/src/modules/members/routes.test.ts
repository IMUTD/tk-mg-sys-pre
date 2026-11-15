import { describe, expect, it } from "bun:test"
import { z } from "zod"

import { createApp } from "../../app"
import { GroupIdSchema, Permission, Role } from "../../lib/authorization"
import { defaultPagesForRole, PageKey } from "../../lib/pages"
import { createInMemoryAuditRepository } from "../audit/service"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import { MEMBER_DISPLAY_NAMES } from "./display-names"
import { createInMemoryPagePermissionRepository } from "./page-permission-repository"
import { createInMemoryMemberRepository, MemberIdSchema } from "./repository"
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

const createAuthenticatedApp = (repository = createInMemoryMemberRepository()) => {
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
    repository,
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
    const rejectedPromotion = await app.request(`/api/members/${member.id}`, {
      body: JSON.stringify({ enabled: false, role: "administrator" }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PATCH",
    })
    expect(rejectedPromotion.status).toBe(409)
    await expect(rejectedPromotion.json()).resolves.toEqual({
      error: "administrator_only_in_init_tool",
    })
    const updated = await app.request(`/api/members/${member.id}`, {
      body: JSON.stringify({ enabled: false, role: "operator" }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PATCH",
    })
    expect(updated.status).toBe(200)
    await expect(updated.json()).resolves.toMatchObject({
      email: "new.operator@example.com",
      enabled: false,
      role: "operator",
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
    const repository = createInMemoryMemberRepository()
    const member = await repository.create({
      displayName: "Existing administrator",
      email: "second.admin@example.com",
      groupIds: [],
      passwordHash: "unused",
      role: Role.Administrator,
    })
    expect(MemberIdSchema.safeParse(member.id).success).toBe(true)
    const app = createAuthenticatedApp(repository)
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
    expect(created.status).toBe(409)
    await expect(created.json()).resolves.toEqual({ error: "administrator_only_in_init_tool" })
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

  describe("account levels", () => {
    const otherGroup = "22222222-2222-4222-8222-222222222222"
    const password = "correct-horse-battery-staple"

    const levelApp = async () => {
      const repository = createInMemoryMemberRepository()
      const primary = await repository.create({
        displayName: "客户一级",
        email: "primary@example.com",
        groupIds: [GroupIdSchema.parse(groupId)],
        passwordHash: "unused",
        role: Role.Administrator,
      })
      const secondary = await repository.create({
        displayName: "客户二级",
        email: "secondary@example.com",
        groupIds: [GroupIdSchema.parse(groupId)],
        passwordHash: "unused",
        role: Role.Operator,
      })
      const elsewhere = await repository.create({
        displayName: "别家二级",
        email: "elsewhere@example.com",
        groupIds: [GroupIdSchema.parse(otherGroup)],
        passwordHash: "unused",
        role: Role.Operator,
      })
      const auditRepository = createInMemoryAuditRepository()
      const memberPages = defaultPagesForRole(Role.Operator).map((page) =>
        page.key === PageKey.Members ? { ...page, canView: true } : page,
      )
      const authService = createAuthService(
        createInMemoryAuthRepository([
          {
            email: "platform@example.com",
            groupIds: [],
            id: administratorId,
            password,
            permissions: [Permission.ConfigurationWrite],
            role: Role.Administrator,
          },
          {
            email: primary.email,
            groupIds: [groupId],
            id: primary.id,
            password,
            permissions: [Permission.ConfigurationWrite],
            restrictGroups: true,
            role: Role.Administrator,
          },
          {
            email: secondary.email,
            groupIds: [groupId],
            id: secondary.id,
            pages: memberPages,
            password,
            permissions: [Permission.ConfigurationWrite],
            role: Role.Operator,
          },
        ]),
        async (input, passwordHash) => input === passwordHash,
      )
      const memberService = createMemberService({
        auditRepository,
        pagePermissions: createInMemoryPagePermissionRepository(),
        repository,
      })
      const app = createApp({ auditRepository, authService, memberService })
      const cookieFor = async (email: string): Promise<string> => {
        const response = await app.request("/api/auth/login", {
          body: JSON.stringify({ email, password }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
        return response.headers.get("set-cookie") ?? ""
      }
      return { app, cookieFor, elsewhere, primary, secondary }
    }

    const listLevels = async (
      app: ReturnType<typeof createApp>,
      cookie: string,
    ): Promise<Record<string, string>> => {
      const response = await app.request("/api/members", { headers: { Cookie: cookie } })
      expect(response.status).toBe(200)
      const body = z
        .object({ items: z.array(z.object({ email: z.string(), level: z.string() })) })
        .parse(await response.json())
      return Object.fromEntries(body.items.map((item) => [item.email, item.level]))
    }

    it("shows the platform every user with their level, including init-tool administrators", async () => {
      const { app, cookieFor } = await levelApp()
      expect(await listLevels(app, await cookieFor("platform@example.com"))).toEqual({
        "elsewhere@example.com": "secondary",
        "primary@example.com": "primary",
        "secondary@example.com": "secondary",
      })
    })

    it("keeps a primary user to its own group's members", async () => {
      const { app, cookieFor } = await levelApp()
      expect(await listLevels(app, await cookieFor("primary@example.com"))).toEqual({
        "primary@example.com": "primary",
        "secondary@example.com": "secondary",
      })
    })

    it("lets a primary user create secondary users but not a secondary user", async () => {
      const { app, cookieFor } = await levelApp()
      const create = (cookie: string, email: string) =>
        app.request("/api/members", {
          body: JSON.stringify({ email, password: "member-password", role: "operator" }),
          headers: { "Content-Type": "application/json", Cookie: cookie },
          method: "POST",
        })
      const byPrimary = await create(await cookieFor("primary@example.com"), "child@example.com")
      expect(byPrimary.status).toBe(201)
      const bySecondary = await create(
        await cookieFor("secondary@example.com"),
        "grandchild@example.com",
      )
      expect(bySecondary.status).toBe(403)
      await expect(bySecondary.json()).resolves.toEqual({ error: "secondary_cannot_create" })
    })

    it("does not let a secondary user with the members page touch another customer's members", async () => {
      const { app, cookieFor, elsewhere } = await levelApp()
      const cookie = await cookieFor("secondary@example.com")
      const patched = await app.request(`/api/members/${elsewhere.id}`, {
        body: JSON.stringify({ enabled: false, role: "operator" }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "PATCH",
      })
      expect(patched.status).toBe(404)
      const removed = await app.request(`/api/members/${elsewhere.id}`, {
        headers: { Cookie: cookie },
        method: "DELETE",
      })
      expect(removed.status).toBe(404)
    })
  })
})
