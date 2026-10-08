import { describe, expect, it } from "bun:test"
import { createApp } from "../../app"
import { Permission, Role } from "../../lib/authorization"
import { PageKey } from "../../lib/pages"
import { createInMemoryAuditRepository } from "../audit/service"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import { PoolError, PoolSourceFilterSchema } from "./pool-model"
import type { PoolRepository } from "./pool-repository"
import { createPoolService } from "./pool-service"

const groupId = "11111111-1111-4111-8111-111111111111"
const otherGroup = "22222222-2222-4222-8222-222222222222"
const poolId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const root = `/api/groups/${groupId}/operations/account-pools`
const password = "pool-route-fixture"

const setup = async (permission: "write" | "read" = "write", accounts = true, canDelete = true) => {
  const auditRepository = createInMemoryAuditRepository()
  const authService = createAuthService(
    createInMemoryAuthRepository([
      {
        email: "pools@example.test",
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        password,
        groupIds: [groupId],
        role: Role.Operator,
        permissions:
          permission === "write"
            ? [Permission.OperationsRead, Permission.OperationsWrite]
            : [Permission.OperationsRead],
        pages: [PageKey.AccountPool, PageKey.Accounts, PageKey.Devices].map((key) => ({
          key,
          canDelete,
          canView: key !== PageKey.Accounts || accounts,
        })),
      },
    ]),
    async (submitted, stored) => submitted === stored,
  )
  let writes = 0
  const repository: PoolRepository = {
    list: async () => ({ items: [], total: 0, page: 1, pageSize: 10 }),
    devices: async () => [],
    sources: async () => ({ items: [], total: 0, groups: [] }),
    create: async () => {
      writes++
      throw new PoolError("account_pool_empty")
    },
    details: async () => {
      throw new PoolError("account_pool_not_found")
    },
    remove: async () => {
      writes++
      return 1
    },
    consume: async () => {
      writes++
    },
  }
  const app = createApp({
    auditRepository,
    authService,
    poolService: createPoolService(repository),
  })
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "pools@example.test", password }),
  })
  const headers = {
    Cookie: login.headers.get("set-cookie") ?? "",
    "Content-Type": "application/json",
  }
  return { app, headers, writes: () => writes }
}
describe("account pool catalog HTTP authorization", () => {
  it("requires authentication and hides foreign business groups", async () => {
    const { app, headers } = await setup()
    expect((await app.request(root)).status).toBe(401)
    expect(
      (await app.request(`/api/groups/${otherGroup}/operations/account-pools`, { headers })).status,
    ).toBe(404)
    expect((await app.request(root, { headers })).status).toBe(200)
    expect((await app.request(`${root}/${poolId}`, { headers })).status).toBe(404)
    expect((await app.request(`${root}/malformed`, { headers })).status).toBe(400)
  })
  it("does not allow pool-page access to reveal hidden source accounts", async () => {
    const { app, headers, writes } = await setup("write", false)
    for (const suffix of ["/sources", ""]) {
      expect(
        (
          await app.request(`${root}${suffix}`, {
            headers,
            method: "POST",
            body: JSON.stringify({ filter: PoolSourceFilterSchema.parse({ backType: "3" }) }),
          })
        ).status,
      ).toBe(403)
    }
    expect((await app.request(`${root}/${poolId}`, { headers })).status).toBe(403)
    expect(writes()).toBe(0)
  })
  it("rejects read-only mutations and separate page-delete denial", async () => {
    const readOnly = await setup("read")
    expect(
      (
        await readOnly.app.request(root, {
          headers: readOnly.headers,
          method: "POST",
          body: JSON.stringify({ filter: { backType: "3" } }),
        })
      ).status,
    ).toBe(403)
    expect(readOnly.writes()).toBe(0)
    const noDelete = await setup("write", true, false)
    expect(
      (
        await noDelete.app.request(`${root}/batch-delete`, {
          headers: noDelete.headers,
          method: "POST",
          body: JSON.stringify({ ids: [poolId] }),
        })
      ).status,
    ).toBe(403)
    expect(noDelete.writes()).toBe(0)
  })
  it("rejects malformed bodies and strips simulation origin from public consumption reports", async () => {
    const { app, headers, writes } = await setup()
    expect((await app.request(root, { headers, method: "POST", body: "{" })).status).toBe(400)
    expect(
      (
        await app.request(root, {
          headers,
          method: "POST",
          body: JSON.stringify({ filter: { backType: "3" }, times: 99 }),
        })
      ).status,
    ).toBe(400)
    const consume = await app.request(`${root}/${poolId}/consumption`, {
      headers,
      method: "POST",
      body: JSON.stringify({
        accountId: crypto.randomUUID(),
        round: 1,
        consumptionKey: "once",
        origin: "simulation",
      }),
    })
    expect(consume.status).toBe(204)
    expect(writes()).toBe(1)
  })
})
