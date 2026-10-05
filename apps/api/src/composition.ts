import { createUnconfiguredDeviceAdapter, type DeviceAdapter } from "@tk-mg/device-adapter"
import { checkSystemActorReadiness } from "@tk-mg/task-execution"
import type { Hono } from "hono"
import Redis from "ioredis"
import { createApp } from "./app"
import { createSqlClient } from "./db/client"
import { purgeExpiredOperationalRows } from "./db/retention"
import { createSecretCipher } from "./lib/crypto"
import { createPostgresAccountPoolRepository } from "./modules/account-pool/repository"
import { createAccountPoolService } from "./modules/account-pool/service"
import { createPostgresAccountRepository } from "./modules/accounts/repository"
import { createAccountService } from "./modules/accounts/service"
import { createPostgresAuditRepository } from "./modules/audit/service"
import { createPostgresAuthRepository } from "./modules/auth/postgres-repository"
import { createAuthService } from "./modules/auth/service"
import { createPostgresDeviceCommandRepository } from "./modules/device-commands/postgres-repository"
import { createDeviceCommandService } from "./modules/device-commands/service"
import { createPostgresDeviceRepository } from "./modules/devices/postgres-repository"
import { createDeviceService } from "./modules/devices/service"
import { createPostgresPagePermissionRepository } from "./modules/members/page-permission-repository"
import { createPostgresMemberRepository } from "./modules/members/repository"
import { createMemberService } from "./modules/members/service"
import { createPostgresProxyRepository } from "./modules/proxies/repository"
import { createProxyService } from "./modules/proxies/service"
import { createPostgresRegistrationResourceRepository } from "./modules/registration-resources/postgres-repository"
import { createRegistrationResourceService } from "./modules/registration-resources/service"
import { createPostgresResourceRepository } from "./modules/resources/repository"
import { createResourceService } from "./modules/resources/service"
import { createPostgresSettingsRepository } from "./modules/settings/repository"
import { createSettingsService } from "./modules/settings/service"
import { createPostgresStorageRepository } from "./modules/storage/repository"
import { createStorageService } from "./modules/storage/service"
import { createPostgresExecutionTaskRepository } from "./modules/task-execution/postgres-repository"
import { registerBoxLink } from "./modules/box-link"
import { createTaskExecutionService } from "./modules/task-execution/service"

export type ProductionAppConfig = {
  readonly databaseUrl: string
  readonly redisUrl: string
  readonly secretEncryptionKey: string
  readonly systemActorId: string
  readonly deviceAdapter?: DeviceAdapter
}

export type ProductionApp = {
  readonly app: Hono
  readonly checkReadiness: () => Promise<void>
  readonly close: () => Promise<void>
  readonly purgeExpiredRows: () => Promise<void>
}

export const createProductionApp = (config: ProductionAppConfig): ProductionApp => {
  const client = createSqlClient(config.databaseUrl)
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null })
  const authRepository = createPostgresAuthRepository(client)
  const auditRepository = createPostgresAuditRepository(client)
  const cipher = createSecretCipher(config.secretEncryptionKey)
  const registrationResourceService = createRegistrationResourceService({
    auditRepository,
    cipher,
    repository: createPostgresRegistrationResourceRepository(client),
  })
  const deviceRepository = createPostgresDeviceRepository(client)
  const deviceService = createDeviceService({
    auditRepository,
    repository: deviceRepository,
  })
  const deviceCommandService = createDeviceCommandService({
    adapter: config.deviceAdapter ?? createUnconfiguredDeviceAdapter(),
    deviceRepository,
    repository: createPostgresDeviceCommandRepository(client),
  })
  const resourceService = createResourceService({
    auditRepository,
    repository: createPostgresResourceRepository(client),
  })
  const accountService = createAccountService({
    auditRepository,
    cipher,
    repository: createPostgresAccountRepository(client),
  })
  const accountPoolService = createAccountPoolService({
    auditRepository,
    repository: createPostgresAccountPoolRepository(client),
  })
  const proxyService = createProxyService({
    auditRepository,
    cipher,
    repository: createPostgresProxyRepository(client),
  })
  const settingsService = createSettingsService({
    auditRepository,
    cipher,
    repository: createPostgresSettingsRepository(client),
  })
  const storageService = createStorageService({
    auditRepository,
    cipher,
    repository: createPostgresStorageRepository(client),
  })
  const memberRepository = createPostgresMemberRepository(client)
  const memberService = createMemberService({
    auditRepository,
    pagePermissions: createPostgresPagePermissionRepository(client),
    repository: memberRepository,
  })
  const taskExecutionService = createTaskExecutionService({
    deviceRepository,
    repository: createPostgresExecutionTaskRepository(client, {
      actorId: config.systemActorId,
      actorType: "system",
      requestId: "api",
    }),
  })

  const app = createApp({
    auditRepository,
    auditExplorerRepository: auditRepository,
    accessGroupRepository: memberRepository,
    authService: createAuthService(authRepository),
    deviceService,
    deviceCommandService,
    memberService,
    accountPoolService,
    accountService,
    proxyService,
    registrationResourceService,
    resourceService,
    settingsService,
    storageService,
    taskExecutionService,
  })
  registerBoxLink(app, client, config.databaseUrl)
  return {
    app,
    checkReadiness: async () => {
      await client`select 1`
      await redis.ping()
      await checkSystemActorReadiness(client, config.systemActorId)
    },
    close: async () => {
      await redis.quit()
      await client.end()
    },
    purgeExpiredRows: () => purgeExpiredOperationalRows(client),
  }
}
