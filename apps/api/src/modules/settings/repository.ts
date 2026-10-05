import type { Sql } from "postgres"
import { z } from "zod"

import type { UserId } from "../../lib/authorization"

const SystemSettingKey = "system"

export type StoredSystemSettings = {
  readonly encryptedNotificationWebhookSecret: string | null
  readonly systemName: string
  readonly taskMaxAttempts: number
  readonly taskRetryDelaySeconds: number
}

export type SystemSettingsWrite = StoredSystemSettings & { readonly updatedBy: UserId }

export interface SettingsRepository {
  get(): Promise<StoredSystemSettings | null>
  save(input: SystemSettingsWrite): Promise<StoredSystemSettings>
}

type SystemSettingRow = {
  readonly encryptedNotificationWebhookSecret: string | null
  readonly value: unknown
}

type SettingsValue = {
  readonly systemName: string
  readonly taskPolicy: { readonly maxAttempts: number; readonly retryDelaySeconds: number }
}

const SettingsValueSchema = z.preprocess(
  (value) => (typeof value === "string" ? JSON.parse(value) : value),
  z.object({
    systemName: z.string(),
    taskPolicy: z.object({
      maxAttempts: z.number().int(),
      retryDelaySeconds: z.number().int(),
    }),
  }),
)

const toStoredSystemSettings = (row: SystemSettingRow): StoredSystemSettings => {
  const value: SettingsValue = SettingsValueSchema.parse(row.value)
  return {
    encryptedNotificationWebhookSecret: row.encryptedNotificationWebhookSecret,
    systemName: value.systemName,
    taskMaxAttempts: value.taskPolicy.maxAttempts,
    taskRetryDelaySeconds: value.taskPolicy.retryDelaySeconds,
  }
}

export const createPostgresSettingsRepository = (client: Sql): SettingsRepository => ({
  get: async () => {
    const rows = await client<SystemSettingRow[]>`
      select encrypted_value as "encryptedNotificationWebhookSecret", value
      from system_setting
      where key = ${SystemSettingKey}
    `
    const row = rows[0]
    return row === undefined ? null : toStoredSystemSettings(row)
  },
  save: async (input) => {
    const value: SettingsValue = {
      systemName: input.systemName,
      taskPolicy: {
        maxAttempts: input.taskMaxAttempts,
        retryDelaySeconds: input.taskRetryDelaySeconds,
      },
    }
    const rows = await client<SystemSettingRow[]>`
      insert into system_setting (key, value, encrypted_value, updated_by)
      values (${SystemSettingKey}, ${JSON.stringify(value)}::jsonb, ${input.encryptedNotificationWebhookSecret}, ${input.updatedBy})
      on conflict (key) do update set
        value = excluded.value,
        encrypted_value = excluded.encrypted_value,
        updated_by = excluded.updated_by,
        updated_at = now()
      returning encrypted_value as "encryptedNotificationWebhookSecret", value
    `
    const row = rows[0]
    if (row === undefined) throw new SettingsPersistenceError()
    return toStoredSystemSettings(row)
  },
})

export const createInMemorySettingsRepository = (): SettingsRepository => {
  let current: StoredSystemSettings | null = null
  return {
    get: async () => current,
    save: async ({ updatedBy: _updatedBy, ...settings }) => {
      current = settings
      return settings
    },
  }
}

class SettingsPersistenceError extends Error {
  public constructor() {
    super("System settings persistence did not return a record")
    this.name = "SettingsPersistenceError"
  }
}
