import { afterEach, describe, expect, it } from "bun:test"

import { createApp } from "../../app"
import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { Permission, Role, UserIdSchema } from "../../lib/authorization"
import { createSecretCipher } from "../../lib/crypto"
import { createPostgresAuditRepository } from "../audit/service"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import { createPostgresAccountRepository } from "./repository"
import { createAccountService } from "./service"

const databaseIntegrationTest = hasConfiguredTestDatabase ? it : it.skip
const groupId = "11111111-1111-4111-8111-111111111111"
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const accountSecret = "plain-account-secret"
let activeDatabase: MigratedTestDatabase | null = null

afterEach(async () => {
  if (activeDatabase !== null) {
    await activeDatabase.close()
    activeDatabase = null
  }
})

describe("PostgreSQL account repository", () => {
  databaseIntegrationTest(
    "encrypts an account secret at rest and masks it from the list API",
    async () => {
      // Given
      activeDatabase = await createMigratedTestDatabase()
      const client = activeDatabase.client
      await client`insert into access_group (id, name) values (${groupId}, ${"Operations"})`
      await client`
      insert into app_user (id, email, password_hash, role)
      values (${actorId}, ${"operator@example.com"}, ${"unused"}, ${"operator"})
    `
      const auditRepository = createPostgresAuditRepository(client)
      const accountService = createAccountService({
        auditRepository,
        cipher: createSecretCipher("12345678901234567890123456789012"),
        repository: createPostgresAccountRepository(client),
      })
      const authService = createAuthService(
        createInMemoryAuthRepository([
          {
            email: "operator@example.com",
            groupIds: [groupId],
            id: actorId,
            password: "correct-horse-battery-staple",
            permissions: [Permission.OperationsRead],
            role: Role.Operator,
          },
        ]),
        async (password, passwordHash) => password === passwordHash,
      )
      const app = createApp({ accountService, auditRepository, authService })
      await accountService.create(UserIdSchema.parse(actorId), groupId, {
        identifier: "account@example.com",
        name: "运营账号",
        note: "",
        secret: accountSecret,
        status: "ready",
        tags: ["华东"],
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
      const response = await app.request(`/api/groups/${groupId}/operations/accounts`, {
        headers: { Cookie: login.headers.get("set-cookie") ?? "" },
      })
      const body = await response.json()
      const stored = await client<{ readonly encryptedSecret: string }[]>`
      select encrypted_secret as "encryptedSecret" from operation_account
    `

      // Then
      expect(response.status).toBe(200)
      expect(JSON.stringify(body)).not.toContain(accountSecret)
      expect(body).toMatchObject({
        items: [
          expect.objectContaining({
            credentialState: "configured",
            identifier: "account@example.com",
          }),
        ],
      })
      expect(stored[0]?.encryptedSecret).not.toContain(accountSecret)
    },
  )
})
