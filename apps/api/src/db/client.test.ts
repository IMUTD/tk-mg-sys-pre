import { describe, expect, it } from "bun:test"

import { createSqlClient } from "./client"
import { getTestDatabaseUrl, hasConfiguredTestDatabase } from "./test-database"

const databaseIntegrationTest = hasConfiguredTestDatabase ? it : it.skip

describe("createSqlClient", () => {
  databaseIntegrationTest(
    "executes a query against the configured PostgreSQL database",
    async () => {
      // Given
      const client = createSqlClient(getTestDatabaseUrl())

      // When
      const rows = await client<{ readonly value: number }[]>`select 1 as value`

      // Then
      expect(rows[0]?.value).toBe(1)

      await client.end()
    },
  )
})
