import type { Sql } from "postgres"
import { z } from "zod"

import type { UserId } from "../../lib/authorization"

export const StorageProtocol = {
  Nfs: "nfs",
  Smb: "smb",
  WebDav: "webdav",
} as const

export const StorageProtocolSchema = z.enum([
  StorageProtocol.Nfs,
  StorageProtocol.Smb,
  StorageProtocol.WebDav,
])

export type StorageProtocol = z.infer<typeof StorageProtocolSchema>

export type StoredStorageConfiguration = {
  readonly encryptedCredentials: string | null
  readonly host: string
  readonly protocol: StorageProtocol
  readonly rootPath: string
}

export type StorageConfigurationWrite = StoredStorageConfiguration & { readonly updatedBy: UserId }

export interface StorageRepository {
  get(): Promise<StoredStorageConfiguration | null>
  save(input: StorageConfigurationWrite): Promise<StoredStorageConfiguration>
}

const StorageSettingKey = "private-cloud"

const StoredValueSchema = z.preprocess(
  (value) => (typeof value === "string" ? JSON.parse(value) : value),
  z.object({
    host: z.string(),
    protocol: StorageProtocolSchema,
    rootPath: z.string(),
  }),
)

type StorageSettingRow = {
  readonly encryptedCredentials: string | null
  readonly value: unknown
}

const toStoredConfiguration = (row: StorageSettingRow): StoredStorageConfiguration => {
  const value = StoredValueSchema.parse(row.value)
  return { encryptedCredentials: row.encryptedCredentials, ...value }
}

export const createPostgresStorageRepository = (client: Sql): StorageRepository => ({
  get: async () => {
    const rows = await client<StorageSettingRow[]>`
      select encrypted_credentials as "encryptedCredentials", value
      from storage_setting
      where key = ${StorageSettingKey}
    `
    const row = rows[0]
    return row === undefined ? null : toStoredConfiguration(row)
  },
  save: async (input) => {
    const value = { host: input.host, protocol: input.protocol, rootPath: input.rootPath }
    const rows = await client<StorageSettingRow[]>`
      insert into storage_setting (key, value, encrypted_credentials, updated_by)
      values (${StorageSettingKey}, ${JSON.stringify(value)}::jsonb, ${input.encryptedCredentials}, ${input.updatedBy})
      on conflict (key) do update set
        value = excluded.value,
        encrypted_credentials = excluded.encrypted_credentials,
        updated_by = excluded.updated_by,
        updated_at = now()
      returning encrypted_credentials as "encryptedCredentials", value
    `
    const row = rows[0]
    if (row === undefined) throw new StoragePersistenceError()
    return toStoredConfiguration(row)
  },
})

export const createInMemoryStorageRepository = (): StorageRepository => {
  let current: StoredStorageConfiguration | null = null
  return {
    get: async () => current,
    save: async ({ updatedBy: _updatedBy, ...configuration }) => {
      current = configuration
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
