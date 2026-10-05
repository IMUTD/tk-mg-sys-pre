import { describe, expect, it } from "bun:test"

import { createApp } from "../../app"
import { GroupIdSchema, Permission, Role } from "../../lib/authorization"
import { defaultPagesForRole, PageKey } from "../../lib/pages"
import { createInMemoryAuditRepository } from "../audit/service"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import { type AccountPage, type OperationAccount, OperationAccountIdSchema } from "./repository"
import type { AccountService } from "./service"

const groupId = "11111111-1111-4111-8111-111111111111"
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

const account: OperationAccount = {
  app: "tiktok",
  avatar: "",
  backupKey: "",
  backupSlot: "",
  backupType: "local",
  createdAt: new Date("2026-09-12T00:00:00.000Z"),
  credentialState: "configured",
  deleted: false,
  deletedAt: null,
  deviceId: null,
  deviceInstanceId: null,
  deviceName: null,
  extra: {},
  favorite: null,
  follower: 12,
  following: 3,
  groupId: GroupIdSchema.parse(groupId),
  hasPassword: true,
  hasTotp: false,
  hasTransferKey: false,
  id: OperationAccountIdSchema.parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  identifier: "account@example.com",
  instanceLabel: null,
  name: "运营账号",
  note: "",
  online: false,
  platformUid: "123",
  proxyId: null,
  proxyName: null,
  region: "",
  status: "ready",
  tags: [],
  transferred: false,
  updatedAt: new Date("2026-09-12T00:00:00.000Z"),
}

const recycled: string[] = []
const accountService: AccountService = {
  assignProxy: async () => 0,
  create: async () => account,
  delete: async () => 0,
  exportMasked: async function* () {
    yield "id\n"
  },
  list: async (): Promise<AccountPage> => ({ items: [account], page: 1, pageSize: 20, total: 1 }),
  recycle: async (_actorId, _groupId, ids) => {
    recycled.push(...ids)
    return ids.length
  },
  restore: async () => 0,
  update: async () => account,
  updateTags: async () => 0,
}

const createAuthenticatedApp = (canViewAccounts = true) => {
  const auditRepository = createInMemoryAuditRepository()
  const authService = createAuthService(
    createInMemoryAuthRepository([
      {
        email: "operator@example.com",
        groupIds: [groupId],
        id: actorId,
        pages: defaultPagesForRole(Role.Operator).map((page) =>
          page.key === PageKey.Accounts
            ? { ...page, canDelete: false, canView: canViewAccounts }
            : page,
        ),
        password: "correct-horse-battery-staple",
        permissions: [Permission.OperationsWrite],
        role: Role.Operator,
      },
    ]),
    async (password, passwordHash) => password === passwordHash,
  )
  return createApp({ accountService, auditRepository, authService })
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

describe("account routes", () => {
  it("returns a stable bad request for a malformed account ID", async () => {
    // Given
    const app = createAuthenticatedApp()
    const cookie = await login(app)

    // When
    const response = await app.request(`/api/groups/${groupId}/operations/accounts/not-a-uuid`, {
      body: JSON.stringify({ name: "更新账号" }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PATCH",
    })

    // Then
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "invalid_account_id" })
  })

  it("denies direct account list access when the account page is hidden", async () => {
    // Given
    const app = createAuthenticatedApp(false)
    const cookie = await login(app)

    // When
    const response = await app.request(`/api/groups/${groupId}/operations/accounts`, {
      headers: { Cookie: cookie },
    })

    // Then
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "permission_denied" })
  })

  it("recycles selected accounts instead of deleting them immediately", async () => {
    // Given
    recycled.length = 0
    const app = createAuthenticatedApp()
    const cookie = await login(app)

    // When
    const response = await app.request(`/api/groups/${groupId}/operations/accounts/recycle`, {
      body: JSON.stringify({ ids: [account.id] }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST",
    })

    // Then
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ affected: 1 })
    expect(recycled).toEqual([account.id])
  })
})
