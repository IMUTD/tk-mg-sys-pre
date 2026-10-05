import { afterEach, describe, expect, it } from "bun:test"

import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { GroupIdSchema, UserIdSchema } from "../../lib/authorization"
import { createPostgresAccountPoolRepository } from "./repository"

const databaseIntegrationTest = hasConfiguredTestDatabase ? it : it.skip
const groupId = "11111111-1111-4111-8111-111111111111"
const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const firstOperatorId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const secondOperatorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
let activeDatabase: MigratedTestDatabase | null = null

afterEach(async () => {
  if (activeDatabase !== null) {
    await activeDatabase.close()
    activeDatabase = null
  }
})

describe("PostgreSQL account pool repository", () => {
  databaseIntegrationTest("allows one concurrent active account lease", async () => {
    // Given
    activeDatabase = await createMigratedTestDatabase()
    const client = activeDatabase.client
    await client`insert into access_group (id, name) values (${groupId}, ${"Operations"})`
    await client`
      insert into app_user (id, email, password_hash, role) values
      (${firstOperatorId}, ${"first@example.com"}, ${"unused"}, ${"operator"}),
      (${secondOperatorId}, ${"second@example.com"}, ${"unused"}, ${"operator"})
    `
    await client`
      insert into operation_account (id, group_id, name, identifier, encrypted_secret)
      values (${accountId}, ${groupId}, ${"Pool Account"}, ${"pool@example.com"}, ${"v1.secret"})
    `
    const repository = createPostgresAccountPoolRepository(client)

    // When
    const leases = await Promise.all([
      repository.lease(
        GroupIdSchema.parse(groupId),
        accountId,
        UserIdSchema.parse(firstOperatorId),
        null,
      ),
      repository.lease(
        GroupIdSchema.parse(groupId),
        accountId,
        UserIdSchema.parse(secondOperatorId),
        null,
      ),
    ])

    // Then
    expect(leases.filter((lease) => lease !== null)).toHaveLength(1)
    const rows = await client<{ readonly id: string }[]>`
      select id from operation_account_lease where account_id = ${accountId} and released_at is null
    `
    expect(rows).toHaveLength(1)
  })

  databaseIntegrationTest(
    "allows an authorized reclaim to release another operator's active lease",
    async () => {
      // Given
      activeDatabase = await createMigratedTestDatabase()
      const client = activeDatabase.client
      await client`insert into access_group (id, name) values (${groupId}, ${"Operations"})`
      await client`
      insert into app_user (id, email, password_hash, role) values
      (${firstOperatorId}, ${"first@example.com"}, ${"unused"}, ${"operator"}),
      (${secondOperatorId}, ${"second@example.com"}, ${"unused"}, ${"administrator"})
    `
      await client`
      insert into operation_account (id, group_id, name, identifier, encrypted_secret)
      values (${accountId}, ${groupId}, ${"Pool Account"}, ${"pool@example.com"}, ${"v1.secret"})
    `
      const repository = createPostgresAccountPoolRepository(client)
      await repository.lease(
        GroupIdSchema.parse(groupId),
        accountId,
        UserIdSchema.parse(firstOperatorId),
        null,
      )

      // When
      const reclaimed = await repository.release(
        GroupIdSchema.parse(groupId),
        accountId,
        UserIdSchema.parse(secondOperatorId),
        true,
      )

      // Then
      expect(reclaimed).toBe(true)
      const rows = await client<{ readonly releasedAt: Date | null }[]>`
      select released_at as "releasedAt" from operation_account_lease where account_id = ${accountId}
    `
      expect(rows[0]?.releasedAt).toBeInstanceOf(Date)
    },
  )
})
