import { afterEach, describe, expect, it } from "bun:test"

import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { Role } from "../../lib/authorization"
import { createUserRepository } from "./user-repository"

const databaseIntegrationTest = hasConfiguredTestDatabase ? it : it.skip
let activeDatabase: MigratedTestDatabase | null = null

afterEach(async () => {
  if (activeDatabase !== null) {
    await activeDatabase.close()
    activeDatabase = null
  }
})

describe("createUserRepository", () => {
  databaseIntegrationTest("rejects invalid roles at the database schema boundary", async () => {
    // Given
    activeDatabase = await createMigratedTestDatabase()
    const client = activeDatabase.client

    // When
    const write = Promise.resolve(client`
        insert into app_user (id, email, password_hash, role)
        values (
          ${"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
          ${"invalid-database-role@example.com"},
          ${"argon2id$server-generated-hash"},
          ${"invalid"}
        )
      `)

    // Then
    await expect(write).rejects.toHaveProperty("code", "22P02")
  })

  databaseIntegrationTest("rejects an invalid role before writing the user", async () => {
    // Given
    activeDatabase = await createMigratedTestDatabase()
    const repository = createUserRepository(activeDatabase.client)

    // When
    const write = repository.create({
      email: "invalid-role@example.com",
      passwordHash: "argon2id$server-generated-hash",
      role: "invalid",
    })

    // Then
    await expect(write).rejects.toHaveProperty("name", "InvalidUserRoleError")
  })

  databaseIntegrationTest("persists a password hash into the migrated user table", async () => {
    // Given
    activeDatabase = await createMigratedTestDatabase()
    const client = activeDatabase.client
    const repository = createUserRepository(client)

    // When
    const created = await repository.create({
      email: "operator@example.com",
      passwordHash: "argon2id$server-generated-hash",
      role: Role.Operator,
    })

    // Then
    expect(created).toEqual({
      email: "operator@example.com",
      role: Role.Operator,
    })
    const rows = await client<{ readonly passwordHash: string }[]>`
      select password_hash as "passwordHash" from app_user where email = ${"operator@example.com"}
    `
    expect(rows[0]?.passwordHash).toBe("argon2id$server-generated-hash")
  })
})
