import { afterEach, describe, expect, it } from "bun:test"

import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { UserIdSchema } from "../../lib/authorization"
import { createSecretCipher } from "../../lib/crypto"
import { createPostgresAuditRepository } from "../audit/service"
import { createPostgresStorageRepository } from "./repository"
import { createStorageService } from "./service"

const databaseIntegrationTest = hasConfiguredTestDatabase ? it : it.skip
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const credentialPassword = "nas-password"
const credentialUsername = "nas-user"
const key = "12345678901234567890123456789012"
let activeDatabase: MigratedTestDatabase | null = null

afterEach(async () => {
  if (activeDatabase !== null) {
    await activeDatabase.close()
    activeDatabase = null
  }
})

describe("PostgreSQL storage repository", () => {
  databaseIntegrationTest(
    "encrypts NAS credentials at rest while retaining a redacted status",
    async () => {
      // Given
      activeDatabase = await createMigratedTestDatabase()
      const client = activeDatabase.client
      await client`
      insert into app_user (id, email, password_hash, role)
      values (${actorId}, ${"admin@example.com"}, ${"unused"}, ${"administrator"})
    `
      const cipher = createSecretCipher(key)
      const service = createStorageService({
        auditRepository: createPostgresAuditRepository(client),
        cipher,
        repository: createPostgresStorageRepository(client),
      })

      // When
      const status = await service.update(UserIdSchema.parse(actorId), {
        credentials: { password: credentialPassword, username: credentialUsername },
        host: "nas.internal",
        protocol: "smb",
        rootPath: "/TK-MG",
      })
      const rows = await client<{ readonly encryptedCredentials: string | null }[]>`
      select encrypted_credentials as "encryptedCredentials"
      from storage_setting
      where key = ${"private-cloud"}
    `
      const encryptedCredentials = rows[0]?.encryptedCredentials

      // Then
      expect(status).toEqual({
        configuration: { host: "nas.internal", protocol: "smb", rootPath: "/TK-MG" },
        credentialsConfigured: true,
        state: "unconfigured",
      })
      expect(encryptedCredentials).not.toBeNull()
      expect(encryptedCredentials ?? "").not.toContain(credentialPassword)
      expect(encryptedCredentials ?? "").not.toContain(credentialUsername)
      expect(cipher.decrypt(encryptedCredentials ?? "")).toBe(
        JSON.stringify({ password: credentialPassword, username: credentialUsername }),
      )
    },
  )
})
