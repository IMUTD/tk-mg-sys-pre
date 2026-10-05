import { createUnconfiguredStorageAdapter, type StorageAdapter } from "@tk-mg/storage-adapter"
import { z } from "zod"

import type { UserId } from "../../lib/authorization"
import type { SecretCipher } from "../../lib/crypto"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import {
  type StorageProtocol,
  StorageProtocolSchema,
  type StorageRepository,
  type StoredStorageConfiguration,
} from "./repository"

export const StorageConfigurationUpdateSchema = z.object({
  credentials: z
    .object({
      password: z.string().min(1).max(4_000),
      username: z.string().trim().min(1).max(512),
    })
    .optional(),
  host: z.string().trim().min(1).max(512),
  protocol: StorageProtocolSchema,
  rootPath: z.string().trim().min(1).max(1_024),
})

export type StorageConfigurationUpdate = z.infer<typeof StorageConfigurationUpdateSchema>

type PublicStorageConfiguration = {
  readonly host: string
  readonly protocol: StorageProtocol
  readonly rootPath: string
}

export type StorageStatus = {
  readonly configuration: PublicStorageConfiguration | null
  readonly credentialsConfigured: boolean
  readonly state: "available" | "unavailable" | "unconfigured"
}

export interface StorageService {
  getStatus(): Promise<StorageStatus>
  update(actorId: UserId, input: StorageConfigurationUpdate): Promise<StorageStatus>
}

type Dependencies = {
  readonly adapter?: StorageAdapter
  readonly auditRepository: AuditRepository
  readonly cipher: SecretCipher
  readonly repository: StorageRepository
}

const toPublicConfiguration = (
  configuration: StoredStorageConfiguration,
): PublicStorageConfiguration => ({
  host: configuration.host,
  protocol: configuration.protocol,
  rootPath: configuration.rootPath,
})

const publicStatus = async (
  adapter: StorageAdapter,
  configuration: StoredStorageConfiguration | null,
): Promise<StorageStatus> => {
  const health = await adapter.health()
  return {
    configuration: configuration === null ? null : toPublicConfiguration(configuration),
    credentialsConfigured: configuration !== null && configuration.encryptedCredentials !== null,
    state: health.kind,
  }
}

export const createStorageService = (dependencies: Dependencies): StorageService => {
  const adapter = dependencies.adapter ?? createUnconfiguredStorageAdapter()
  return {
    getStatus: async () => publicStatus(adapter, await dependencies.repository.get()),
    update: async (actorId, input) => {
      const current = await dependencies.repository.get()
      const encryptedCredentials =
        input.credentials === undefined
          ? (current?.encryptedCredentials ?? null)
          : dependencies.cipher.encrypt(JSON.stringify(input.credentials))
      const stored = await dependencies.repository.save({
        encryptedCredentials,
        host: input.host,
        protocol: input.protocol,
        rootPath: input.rootPath,
        updatedBy: actorId,
      })
      await writeAuditEvent(dependencies.auditRepository, {
        action: "storage.configuration.update",
        actorId,
        outcome: "allowed",
        target: "storage:private-cloud",
      })
      return publicStatus(adapter, stored)
    },
  }
}
