import { z } from "zod"

import type { UserId } from "../../lib/authorization"
import type { SecretCipher } from "../../lib/crypto"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import { bucketOk, nasAddress } from "./nas-place"
import {
  NasDocumentSchema,
  type NasItem,
  type StorageRepository,
  type StoredNasConfiguration,
} from "./repository"

const secretEnvelope = z.object({
  secrets: z.record(z.string(), z.string().min(1).max(4_000)),
})

const itemInput = z.object({
  bucket: z.string().trim().max(63).optional(),
  endpoint: z.string().trim().max(512).optional(),
  id: z.string().uuid(),
  loginUrl: z.string().trim().url().max(512),
  name: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(4_000).optional(),
  username: z.string().trim().min(1).max(256),
})

export const StorageConfigurationUpdateSchema = z.object({
  items: z.array(itemInput).max(50),
})

export type StorageConfigurationUpdate = z.infer<typeof StorageConfigurationUpdateSchema>

export type NasCardView = NasItem & {
  readonly password: string
  readonly prefix: string
}

export type StorageStatus = {
  readonly items: readonly NasCardView[]
  readonly prefix: string
}

export class StorageSecretRequiredError extends Error {
  public constructor() {
    super("NAS secret is required")
    this.name = "StorageSecretRequiredError"
  }
}

export class StorageConfigurationInvalidError extends Error {
  public constructor() {
    super("NAS configuration is invalid")
    this.name = "StorageConfigurationInvalidError"
  }
}

export interface StorageService {
  getStatus(actorId: UserId): Promise<StorageStatus>
  update(actorId: UserId, input: StorageConfigurationUpdate): Promise<StorageStatus>
}

type Dependencies = {
  readonly auditRepository: AuditRepository
  readonly cipher: SecretCipher
  readonly repository: StorageRepository
}

export const readStoredSecrets = (
  cipher: SecretCipher,
  encrypted: string | null,
): Readonly<Record<string, string>> => {
  if (encrypted === null || encrypted.length === 0) return {}
  try {
    const parsed = secretEnvelope.safeParse(JSON.parse(cipher.decrypt(encrypted)))
    return parsed.success ? parsed.data.secrets : {}
  } catch {
    return {}
  }
}

const toView = (
  cipher: SecretCipher,
  configuration: StoredNasConfiguration,
  actorId: UserId,
): readonly NasCardView[] => {
  const secrets = readStoredSecrets(cipher, configuration.encryptedCredentials)
  return configuration.items.map((item) => ({
    ...item,
    password: secrets[item.id] ?? "",
    prefix: `${actorId}/`,
  }))
}

export const createStorageService = (dependencies: Dependencies): StorageService => ({
  getStatus: async (actorId) => {
    const stored = await dependencies.repository.get(actorId)
    return { items: stored === null ? [] : toView(dependencies.cipher, stored, actorId), prefix: `${actorId}/` }
  },
  update: async (actorId, input) => {
    const current = await dependencies.repository.get(actorId)
    const previous = readStoredSecrets(dependencies.cipher, current?.encryptedCredentials ?? null)
    const secrets: Record<string, string> = {}
    const items: NasItem[] = []
    const seen = new Set<string>()
    const addresses = new Set<string>()
    for (const item of input.items) {
      if (seen.has(item.id)) throw new StorageSecretRequiredError()
      seen.add(item.id)
      const bucket = (item.bucket ?? "").trim()
      if (!bucketOk(bucket)) throw new StorageConfigurationInvalidError()
      const address = nasAddress(item.endpoint ?? "", item.loginUrl)
      const identity = `${address}\n${bucket}`
      if (addresses.has(identity)) throw new StorageConfigurationInvalidError()
      addresses.add(identity)
      const password = item.password ?? previous[item.id]
      if (password === undefined || password.length === 0) throw new StorageSecretRequiredError()
      secrets[item.id] = password
      items.push({
        bucket,
        endpoint: address,
        id: item.id,
        loginUrl: item.loginUrl.trim(),
        name: item.name,
        username: item.username,
      })
    }
    NasDocumentSchema.parse({ items })
    const stored = await dependencies.repository.save({
      encryptedCredentials: dependencies.cipher.encrypt(JSON.stringify({ secrets })),
      items,
      updatedBy: actorId,
    })
    await writeAuditEvent(dependencies.auditRepository, {
      action: "storage.configuration.update",
      actorId,
      outcome: "allowed",
      target: "storage:private-cloud",
    })
    return { items: toView(dependencies.cipher, stored, actorId), prefix: `${actorId}/` }
  },
})
