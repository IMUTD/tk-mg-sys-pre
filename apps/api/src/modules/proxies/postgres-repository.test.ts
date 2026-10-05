import { afterEach, describe, expect, it } from "bun:test"

import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { UserIdSchema } from "../../lib/authorization"
import { createSecretCipher } from "../../lib/crypto"
import { createPostgresAuditRepository } from "../audit/service"
import { createPostgresProxyRepository } from "./repository"
import { createProxyService } from "./service"

const databaseIntegrationTest = hasConfiguredTestDatabase ? it : it.skip
const groupId = "11111111-1111-4111-8111-111111111111"
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
let activeDatabase: MigratedTestDatabase | null = null

afterEach(async () => {
  if (activeDatabase !== null) {
    await activeDatabase.close()
    activeDatabase = null
  }
})

describe("PostgreSQL proxy repository", () => {
  databaseIntegrationTest(
    "encrypts proxy credentials and omits them from list responses",
    async () => {
      // Given
      activeDatabase = await createMigratedTestDatabase()
      const client = activeDatabase.client
      await client`insert into access_group (id, name) values (${groupId}, ${"Operations"})`
      await client`
      insert into app_user (id, email, password_hash, role)
      values (${actorId}, ${"operator@example.com"}, ${"unused"}, ${"operator"})
    `
      const service = createProxyService({
        auditRepository: createPostgresAuditRepository(client),
        cipher: createSecretCipher("12345678901234567890123456789012"),
        repository: createPostgresProxyRepository(client),
      })

      // When
      await service.create(UserIdSchema.parse(actorId), groupId, {
        credentials: "proxy-user:proxy-secret",
        endpoint: "10.0.0.5:8080",
        name: "华东代理",
        note: "",
        status: "ready",
        tags: ["华东"],
      })
      const listed = await service.list({ groupId, page: 1, pageSize: 20 })
      const stored = await client<{ readonly encryptedCredentials: string }[]>`
      select encrypted_credentials as "encryptedCredentials" from operation_proxy
    `

      // Then
      expect(JSON.stringify(listed)).not.toContain("proxy-secret")
      expect(listed.items[0]).toEqual(expect.objectContaining({ credentialState: "configured" }))
      expect(stored[0]?.encryptedCredentials).not.toContain("proxy-secret")
    },
  )
})
