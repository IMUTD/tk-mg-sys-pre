import { afterEach, describe, expect, it } from "bun:test"

import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { createSecretCipher } from "../../lib/crypto"
import { createPostgresAuditRepository } from "../audit/service"
import { createPostgresRegistrationResourceRepository } from "./postgres-repository"
import { createRegistrationResourceService } from "./service"

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

describe("PostgreSQL registration resource repository", () => {
  databaseIntegrationTest(
    "rolls back the imported resource when the import audit record cannot be persisted",
    async () => {
      // Given
      activeDatabase = await createMigratedTestDatabase()
      const client = activeDatabase.client
      await client`insert into access_group (id, name) values (${groupId}, ${"Registration"})`
      const service = createRegistrationResourceService({
        auditRepository: createPostgresAuditRepository(client),
        cipher: createSecretCipher("12345678901234567890123456789012"),
        repository: createPostgresRegistrationResourceRepository(client),
      })

      // When
      const imported = service.confirmImport({
        actorId,
        content: "person@gmail.com----plain-password",
        groupId,
        note: "",
        tags: ["gmail"],
      })

      // Then
      await expect(imported).rejects.toHaveProperty("code", "23503")
      const rows = await client<{ readonly id: string }[]>`select id from registration_resource`
      expect(rows).toHaveLength(0)
    },
  )

  databaseIntegrationTest(
    "persists encrypted credentials once when the same resource is imported twice",
    async () => {
      // Given
      activeDatabase = await createMigratedTestDatabase()
      const client = activeDatabase.client
      await client`insert into access_group (id, name) values (${groupId}, ${"Registration"})`
      await client`
        insert into app_user (id, email, password_hash, role)
        values (${actorId}, ${"operator@example.com"}, ${"not-used"}, ${"operator"})
      `
      const service = createRegistrationResourceService({
        auditRepository: createPostgresAuditRepository(client),
        cipher: createSecretCipher("12345678901234567890123456789012"),
        repository: createPostgresRegistrationResourceRepository(client),
      })
      const input = {
        actorId,
        content: "person@gmail.com----plain-password",
        groupId,
        note: "",
        tags: ["gmail"],
      }

      // When
      const first = await service.confirmImport(input)
      const repeated = await service.confirmImport(input)
      const rows = await client<{ readonly encryptedSecret: string }[]>`
        select encrypted_secret as "encryptedSecret" from registration_resource
      `

      // Then
      expect(first.created).toHaveLength(1)
      expect(repeated).toMatchObject({ duplicates: 1 })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.encryptedSecret).not.toContain("plain-password")
    },
  )
})
