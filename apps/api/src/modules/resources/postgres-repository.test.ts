import { afterEach, describe, expect, it } from "bun:test"

import { createApp } from "../../app"
import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { Permission, Role, UserIdSchema } from "../../lib/authorization"
import { createPostgresAuditRepository } from "../audit/service"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import { createPostgresResourceRepository, ResourceStatusConflictError } from "./repository"
import { createResourceService } from "./service"

const databaseIntegrationTest = hasConfiguredTestDatabase ? it : it.skip
const groupId = "11111111-1111-4111-8111-111111111111"
const otherGroupId = "22222222-2222-4222-8222-222222222222"
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const accountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
let activeDatabase: MigratedTestDatabase | null = null

afterEach(async () => {
  if (activeDatabase !== null) {
    await activeDatabase.close()
    activeDatabase = null
  }
})

describe("PostgreSQL resource repository", () => {
  databaseIntegrationTest("does not persist an orphan allocated resource", async () => {
    // Given
    activeDatabase = await createMigratedTestDatabase()
    const client = activeDatabase.client
    await client`insert into access_group (id, name) values (${groupId}, ${"Operations"})`
    const resourceService = createResourceService({
      auditRepository: createPostgresAuditRepository(client),
      repository: createPostgresResourceRepository(client),
    })

    // When
    const create = resourceService.create(UserIdSchema.parse(actorId), groupId, {
      category: "邮箱",
      name: "不应分配",
      note: "",
      status: "allocated",
      tags: [],
    })

    // Then
    await expect(create).rejects.toBeInstanceOf(ResourceStatusConflictError)
    const rows = await client<{ readonly id: string }[]>`select id from operation_resource`
    expect(rows).toHaveLength(0)
  })

  databaseIntegrationTest(
    "persists resource allocation history and scopes it to its group",
    async () => {
      // Given
      activeDatabase = await createMigratedTestDatabase()
      const client = activeDatabase.client
      await client`
      insert into access_group (id, name) values
      (${groupId}, ${"Operations"}),
      (${otherGroupId}, ${"Other Operations"})
    `
      await client`
      insert into app_user (id, email, password_hash, role)
      values (${actorId}, ${"operator@example.com"}, ${"unused"}, ${"operator"})
    `
      await client`
      insert into operation_account (id, group_id, name, identifier, encrypted_secret)
      values (${accountId}, ${groupId}, ${"Assigned Account"}, ${"account@example.com"}, ${"v1.secret"})
    `
      const resourceService = createResourceService({
        auditRepository: createPostgresAuditRepository(client),
        repository: createPostgresResourceRepository(client),
      })
      const actor = UserIdSchema.parse(actorId)
      const resource = await resourceService.create(actor, groupId, {
        category: "邮箱",
        name: "研发邮箱",
        note: "",
        status: "available",
        tags: ["研发"],
      })

      // When
      const allocation = await resourceService.allocate(actor, groupId, resource.id, accountId)
      const activeHistory = await resourceService.history(groupId, resource.id)
      const crossGroupHistory = await resourceService.history(otherGroupId, resource.id)
      const released = await resourceService.release(actor, groupId, resource.id)
      const releasedHistory = await resourceService.history(groupId, resource.id)
      const stored = await client<{ readonly groupId: string; readonly releasedAt: Date | null }[]>`
      select group_id as "groupId", released_at as "releasedAt"
      from operation_resource_allocation where resource_id = ${resource.id}
    `

      // Then
      expect(allocation).toEqual(
        expect.objectContaining({ accountId, releasedAt: null, resourceId: resource.id }),
      )
      expect(activeHistory).toEqual([expect.objectContaining({ accountId, releasedAt: null })])
      expect(crossGroupHistory).toEqual([])
      expect(released).toBe(true)
      expect(releasedHistory[0]).toEqual(
        expect.objectContaining({ accountId, releasedAt: expect.any(Date) }),
      )
      expect(stored).toHaveLength(1)
      expect(stored[0]).toEqual({ groupId, releasedAt: expect.any(Date) })
      expect(
        await resourceService.list({ groupId: otherGroupId, page: 1, pageSize: 20 }),
      ).toMatchObject({
        items: [],
        total: 0,
      })
      expect(await resourceService.list({ groupId, page: 1, pageSize: 20 })).toMatchObject({
        items: [expect.objectContaining({ id: resource.id, status: "available" })],
        total: 1,
      })
    },
  )

  databaseIntegrationTest(
    "rejects a manual status change while an allocation is active without corrupting its history",
    async () => {
      // Given
      activeDatabase = await createMigratedTestDatabase()
      const client = activeDatabase.client
      await client`insert into access_group (id, name) values (${groupId}, ${"Operations"})`
      await client`
        insert into app_user (id, email, password_hash, role)
        values (${actorId}, ${"operator@example.com"}, ${"unused"}, ${"operator"})
      `
      await client`
        insert into operation_account (id, group_id, name, identifier, encrypted_secret)
        values (${accountId}, ${groupId}, ${"Assigned Account"}, ${"account@example.com"}, ${"v1.secret"})
      `
      const auditRepository = createPostgresAuditRepository(client)
      const resourceService = createResourceService({
        auditRepository,
        repository: createPostgresResourceRepository(client),
      })
      const actor = UserIdSchema.parse(actorId)
      const resource = await resourceService.create(actor, groupId, {
        category: "邮箱",
        name: "研发邮箱",
        note: "",
        status: "available",
        tags: [],
      })
      await resourceService.allocate(actor, groupId, resource.id, accountId)
      const authService = createAuthService(
        createInMemoryAuthRepository([
          {
            email: "operator@example.com",
            groupIds: [groupId],
            id: actorId,
            password: "correct-horse-battery-staple",
            permissions: [Permission.OperationsWrite],
            role: Role.Operator,
          },
        ]),
        async (password, passwordHash) => password === passwordHash,
      )
      const app = createApp({ auditRepository, authService, resourceService })
      const login = await app.request("/api/auth/login", {
        body: JSON.stringify({
          email: "operator@example.com",
          password: "correct-horse-battery-staple",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })

      // When
      const response = await app.request(
        `/api/groups/${groupId}/operations/resources/${resource.id}`,
        {
          body: JSON.stringify({ status: "available" }),
          headers: {
            "Content-Type": "application/json",
            Cookie: login.headers.get("set-cookie") ?? "",
          },
          method: "PATCH",
        },
      )

      // Then
      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toEqual({ error: "resource_allocation_active" })
      expect(await resourceService.history(groupId, resource.id)).toEqual([
        expect.objectContaining({ accountId, releasedAt: null }),
      ])
      expect(await resourceService.list({ groupId, page: 1, pageSize: 20 })).toMatchObject({
        items: [expect.objectContaining({ id: resource.id, status: "allocated" })],
      })
    },
  )
})
