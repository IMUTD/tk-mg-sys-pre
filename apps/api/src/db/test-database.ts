import { fileURLToPath } from "node:url"

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import type { Sql } from "postgres"

import { createSqlClient } from "./client"

const AdvisoryLockId = 705_203_901
const TestDatabasePrefix = "tk_mg_test_"
const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url))

class MissingTestDatabaseUrlError extends Error {
  public constructor() {
    super("TEST_DATABASE_URL is required for PostgreSQL integration tests")
    this.name = "MissingTestDatabaseUrlError"
  }
}

class UnsafeTestDatabaseUrlError extends Error {
  public constructor() {
    super(`TEST_DATABASE_URL must target a database starting with ${TestDatabasePrefix}`)
    this.name = "UnsafeTestDatabaseUrlError"
  }
}

const validateTestDatabaseUrl = (url: string): string => {
  const databaseName = new URL(url).pathname.slice(1)
  if (!databaseName.startsWith(TestDatabasePrefix)) {
    throw new UnsafeTestDatabaseUrlError()
  }
  return url
}

const { TEST_DATABASE_URL: testDatabaseUrl } = Bun.env
const configuredTestDatabaseUrl = testDatabaseUrl ? validateTestDatabaseUrl(testDatabaseUrl) : null

export const hasConfiguredTestDatabase = configuredTestDatabaseUrl !== null

export const getTestDatabaseUrl = (): string => {
  if (configuredTestDatabaseUrl === null) {
    throw new MissingTestDatabaseUrlError()
  }
  return configuredTestDatabaseUrl
}

export type MigratedTestDatabase = {
  readonly client: Sql
  readonly close: () => Promise<void>
}

export const createMigratedTestDatabase = async (): Promise<MigratedTestDatabase> => {
  const migrationClient = createSqlClient(getTestDatabaseUrl())
  try {
    await migrationClient`select pg_advisory_lock(${AdvisoryLockId})`
    await migrationClient`drop schema if exists public cascade`
    await migrationClient`create schema public`
    await migrationClient`drop schema if exists drizzle cascade`
    await migrate(drizzle(migrationClient), { migrationsFolder })

    const client = createSqlClient(getTestDatabaseUrl())
    return {
      client,
      close: async () => {
        await client.end()
        await migrationClient.end()
      },
    }
  } catch (error) {
    await migrationClient.end()
    throw error
  }
}
