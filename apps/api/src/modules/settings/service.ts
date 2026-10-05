import { z } from "zod"

import type { UserId } from "../../lib/authorization"
import type { SecretCipher } from "../../lib/crypto"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import type { SettingsRepository, StoredSystemSettings } from "./repository"

const DefaultSystemSettings = {
  notificationWebhookConfigured: false,
  systemName: "TK-MG 运营中心",
  taskPolicy: { maxAttempts: 3, retryDelaySeconds: 60 },
} as const

export const SystemSettingsUpdateSchema = z.object({
  notificationWebhookSecret: z.string().min(1).max(10_000).optional(),
  systemName: z.string().trim().min(1).max(120),
  taskPolicy: z.object({
    maxAttempts: z.number().int().min(1).max(10),
    retryDelaySeconds: z.number().int().min(1).max(86_400),
  }),
})

export type SystemSettingsUpdate = z.infer<typeof SystemSettingsUpdateSchema>
export type PublicSystemSettings = {
  readonly notificationWebhookConfigured: boolean
  readonly systemName: string
  readonly taskPolicy: { readonly maxAttempts: number; readonly retryDelaySeconds: number }
}

export interface SettingsService {
  get(): Promise<PublicSystemSettings>
  update(actorId: UserId, input: SystemSettingsUpdate): Promise<PublicSystemSettings>
}

type Dependencies = {
  readonly auditRepository: AuditRepository
  readonly cipher: SecretCipher
  readonly repository: SettingsRepository
}

const toPublicSettings = (stored: StoredSystemSettings | null): PublicSystemSettings =>
  stored === null
    ? DefaultSystemSettings
    : {
        notificationWebhookConfigured: stored.encryptedNotificationWebhookSecret !== null,
        systemName: stored.systemName,
        taskPolicy: {
          maxAttempts: stored.taskMaxAttempts,
          retryDelaySeconds: stored.taskRetryDelaySeconds,
        },
      }

export const createSettingsService = (dependencies: Dependencies): SettingsService => ({
  get: async () => toPublicSettings(await dependencies.repository.get()),
  update: async (actorId, input) => {
    const current = await dependencies.repository.get()
    const secret =
      input.notificationWebhookSecret === undefined
        ? (current?.encryptedNotificationWebhookSecret ?? null)
        : dependencies.cipher.encrypt(input.notificationWebhookSecret)
    const stored = await dependencies.repository.save({
      encryptedNotificationWebhookSecret: secret,
      systemName: input.systemName,
      taskMaxAttempts: input.taskPolicy.maxAttempts,
      taskRetryDelaySeconds: input.taskPolicy.retryDelaySeconds,
      updatedBy: actorId,
    })
    await writeAuditEvent(dependencies.auditRepository, {
      action: "settings.update",
      actorId,
      outcome: "allowed",
      target: "settings:system",
    })
    return toPublicSettings(stored)
  },
})
