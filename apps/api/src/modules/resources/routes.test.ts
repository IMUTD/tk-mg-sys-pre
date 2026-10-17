import { describe, expect, it } from "bun:test"

import { createApp } from "../../app"
import { GroupIdSchema, Permission, Role } from "../../lib/authorization"
import { createInMemoryAuditRepository } from "../audit/service"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import { type OperationResource, OperationResourceIdSchema, type ResourcePage } from "./repository"
import type { ResourceService } from "./service"

const groupId = "11111111-1111-4111-8111-111111111111"
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const accountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

const resource: OperationResource = {
  category: "邮箱",
  createdAt: new Date("2026-09-12T00:00:00.000Z"),
  groupId: GroupIdSchema.parse(groupId),
  id: OperationResourceIdSchema.parse("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
  name: "研发邮箱",
  note: "",
  status: "available",
  tags: [],
  updatedAt: new Date("2026-09-12T00:00:00.000Z"),
}

const assigned: { ids?: readonly string[]; tags?: readonly string[] } = {}

const resourceService: ResourceService = {
  allocate: async () => null,
  assignTags: async (_actorId, _groupId, ids, tags) => {
    assigned.ids = ids
    assigned.tags = tags
    return ids.length === 0 ? 0 : 2
  },
  create: async () => resource,
  delete: async () => 0,
  deleteScope: async () => 0,
  importTexts: async () => [],
  history: async () => [],
  list: async (): Promise<ResourcePage> => ({ items: [resource], page: 1, pageSize: 20, total: 1 }),
  release: async () => false,
  update: async () => resource,
}

const createAuthenticatedApp = () => {
  const auditRepository = createInMemoryAuditRepository()
  const authService = createAuthService(
    createInMemoryAuthRepository([
      {
        email: "operator@example.com",
        groupIds: [groupId],
        id: actorId,
        password: "correct-horse-battery-staple",
        permissions: [Permission.OperationsRead, Permission.OperationsWrite],
        role: Role.Operator,
      },
    ]),
    async (password, passwordHash) => password === passwordHash,
  )
  return createApp({ auditRepository, authService, resourceService })
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

describe("resource routes", () => {
  it("rejects a create request that tries to create an orphan allocated resource", async () => {
    // Given
    const app = createAuthenticatedApp()
    const cookie = await login(app)

    // When
    const response = await app.request(`/api/groups/${groupId}/operations/resources`, {
      body: JSON.stringify({ category: "邮箱", name: "研发邮箱", status: "allocated" }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST",
    })

    // Then
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "invalid_resource_request" })
  })

  it("returns a stable bad request for a malformed resource ID on every single-resource route", async () => {
    // Given
    const app = createAuthenticatedApp()
    const cookie = await login(app)
    const basePath = `/api/groups/${groupId}/operations/resources/not-a-uuid`
    const jsonHeaders = { "Content-Type": "application/json", Cookie: cookie }

    // When
    const responses = await Promise.all([
      app.request(basePath, {
        body: JSON.stringify({ name: "更新资源" }),
        headers: jsonHeaders,
        method: "PATCH",
      }),
      app.request(`${basePath}/allocations`, { headers: { Cookie: cookie } }),
      app.request(`${basePath}/allocations`, {
        body: JSON.stringify({ accountId }),
        headers: jsonHeaders,
        method: "POST",
      }),
      app.request(`${basePath}/allocations`, { headers: { Cookie: cookie }, method: "DELETE" }),
    ])

    // Then
    for (const response of responses) {
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: "invalid_resource_id" })
    }
  })

  it("appends tags and treats an omitted list as no change", async () => {
    const app = createAuthenticatedApp()
    const cookie = await login(app)
    const headers = { "Content-Type": "application/json", Cookie: cookie }
    const path = `/api/groups/${groupId}/operations/resources/batch/assign`
    const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

    const rejected = await app.request(path, {
      body: JSON.stringify({ ids: [] }),
      headers,
      method: "POST",
    })
    expect(rejected.status).toBe(400)
    await expect(rejected.json()).resolves.toEqual({ error: "invalid_batch_request" })

    const skipped = await app.request(path, {
      body: JSON.stringify({ ids: [id] }),
      headers,
      method: "POST",
    })
    expect(skipped.status).toBe(200)
    await expect(skipped.json()).resolves.toEqual({ affected: 0 })

    const blank = await app.request(path, {
      body: JSON.stringify({ ids: [id], tags: ["  "] }),
      headers,
      method: "POST",
    })
    expect(blank.status).toBe(400)

    const cleared = await app.request(path, {
      body: JSON.stringify({ ids: [id], tags: [] }),
      headers,
      method: "POST",
    })
    expect(cleared.status).toBe(200)
    await expect(cleared.json()).resolves.toEqual({ affected: 2 })
    expect(assigned.tags).toEqual([])

    const named = await app.request(path, {
      body: JSON.stringify({ ids: [id], tags: [" 问候 ", "备用"] }),
      headers,
      method: "POST",
    })
    expect(named.status).toBe(200)
    expect(assigned.tags).toEqual(["问候", "备用"])
  })

  it("accepts an empty category on a single resource update", async () => {
    const app = createAuthenticatedApp()
    const cookie = await login(app)
    const response = await app.request(
      `/api/groups/${groupId}/operations/resources/cccccccc-cccc-4ccc-8ccc-cccccccccccc`,
      {
        body: JSON.stringify({ category: "" }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "PATCH",
      },
    )
    expect(response.status).toBe(200)
  })
})
