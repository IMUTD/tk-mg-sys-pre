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
const credentialSecret = "nas-password"
const key = "12345678901234567890123456789012"
let activeDatabase: MigratedTestDatabase | null = null

afterEach(async () => {
  if (activeDatabase !== null) {
    await activeDatabase.close()
    activeDatabase = null
  }
})

describe("PostgreSQL storage repository", () => {
  databaseIntegrationTest("encrypts the NAS secret and returns it to the storage viewer", async () => {
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

    const cardId = "22222222-2222-4222-8222-222222222222"
    const status = await service.update(UserIdSchema.parse(actorId), {
      items: [
        {
          bucket: "backup",
          id: cardId,
          loginUrl: "http://192.168.76.19:8010",
          name: "机房",
          password: credentialSecret,
          username: "admin",
        },
      ],
    })
    const rows = await client<{ readonly encryptedCredentials: string | null }[]>`
      select encrypted_credentials as "encryptedCredentials"
      from storage_setting
      where key = ${`private-cloud:${actorId}`}
    `
    const encryptedCredentials = rows[0]?.encryptedCredentials
    const kept = await service.update(UserIdSchema.parse(actorId), {
      items: [
        {
          bucket: "backup",
          id: cardId,
          loginUrl: "http://192.168.76.19:8010",
          name: "机房",
          username: "admin",
        },
      ],
    })

    expect(status.items[0]?.password).toBe(credentialSecret)
    expect(kept.items[0]?.password).toBe(credentialSecret)
    expect(encryptedCredentials).not.toBeNull()
    expect(encryptedCredentials ?? "").not.toContain(credentialSecret)
    expect(cipher.decrypt(encryptedCredentials ?? "")).toContain(credentialSecret)
  })
})
