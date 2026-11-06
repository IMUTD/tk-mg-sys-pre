import type { Sql } from "postgres"
import { z } from "zod"

import type { UserId } from "../../lib/authorization"

export const NasItemSchema = z.object({
  bucket: z.string().trim().max(63).default(""),
  endpoint: z.string().trim().max(512).default(""),
  id: z.string().uuid(),
  loginUrl: z.string().trim().url().max(512),
  name: z.string().trim().min(1).max(64),
  username: z.string().trim().min(1).max(256),
})

export type NasItem = z.infer<typeof NasItemSchema>

export const NasDocumentSchema = z.object({
  items: z.array(NasItemSchema).max(50),
})

export type NasDocument = z.infer<typeof NasDocumentSchema>

export type StoredNasConfiguration = NasDocument & {
  readonly encryptedCredentials: string | null
}

export type NasConfigurationWrite = StoredNasConfiguration & { readonly updatedBy: UserId }

export interface StorageRepository {
  get(administratorId: UserId): Promise<StoredNasConfiguration | null>
  save(input: NasConfigurationWrite): Promise<StoredNasConfiguration>
}

export const storageSettingKey = (administratorId: string): string => `private-cloud:${administratorId}`

const StoredValueSchema = z.preprocess((value) => {
  const parsed = typeof value === "string" ? JSON.parse(value) : value
  if (typeof parsed === "object" && parsed !== null && !("items" in parsed)) return { items: [] }
  return parsed
}, NasDocumentSchema)

type StorageSettingRow = {
  readonly encryptedCredentials: string | null
  readonly value: unknown
}

const toStoredConfiguration = (row: StorageSettingRow): StoredNasConfiguration | null => {
  const parsed = StoredValueSchema.safeParse(row.value)
  if (!parsed.success) return { encryptedCredentials: row.encryptedCredentials, items: [] }
  return { encryptedCredentials: row.encryptedCredentials, ...parsed.data }
}

export const createPostgresStorageRepository = (client: Sql): StorageRepository => ({
  get: async (administratorId) => {
    const rows = await client<StorageSettingRow[]>`
      select encrypted_credentials as "encryptedCredentials", value
      from storage_setting
      where key = ${storageSettingKey(administratorId)}
    `
    const row = rows[0]
    return row === undefined ? null : toStoredConfiguration(row)
  },
  save: async (input) => {
    const value: NasDocument = { items: input.items }
    const rows = await client<StorageSettingRow[]>`
      insert into storage_setting (key, value, encrypted_credentials, updated_by)
      values (${storageSettingKey(input.updatedBy)}, ${client.json(value)}, ${input.encryptedCredentials}, ${input.updatedBy})
      on conflict (key) do update set
        value = excluded.value,
        encrypted_credentials = excluded.encrypted_credentials,
        updated_by = excluded.updated_by,
        updated_at = now()
      returning encrypted_credentials as "encryptedCredentials", value
    `
    const row = rows[0]
    if (row === undefined) throw new StoragePersistenceError()
    const stored = toStoredConfiguration(row)
    if (stored === null) throw new StoragePersistenceError()
    return stored
  },
})

export const createInMemoryStorageRepository = (): StorageRepository => {
  const rows = new Map<string, StoredNasConfiguration>()
  return {
    get: async (administratorId) => rows.get(administratorId) ?? null,
    save: async ({ updatedBy, ...configuration }) => {
      rows.set(updatedBy, configuration)
      return configuration
    },
  }
}

class StoragePersistenceError extends Error {
  public constructor() {
    super("Storage configuration persistence did not return a record")
    this.name = "StoragePersistenceError"
  }
}
