import { Hono } from "hono"
import { registerFoundationAccessRoutes } from "./modules/access/routes"
import { registerAccountPoolRoutes } from "./modules/account-pool/routes"
import type { AccountPoolService } from "./modules/account-pool/service"
import { registerAccountRoutes } from "./modules/accounts/routes"
import type { AccountService } from "./modules/accounts/service"
import { registerAuditRoutes } from "./modules/audit/routes"
import type { AuditExplorerRepository, AuditRepository } from "./modules/audit/service"
import { registerAuthRoutes } from "./modules/auth/routes"
import type { AuthService } from "./modules/auth/service"
import { registerDeviceCommandRoutes } from "./modules/device-commands/routes"
import type { DeviceCommandService } from "./modules/device-commands/service"
import { registerDeviceRoutes } from "./modules/devices/routes"
import type { DeviceService } from "./modules/devices/service"
import type { MemberRepository } from "./modules/members/repository"
import { registerMemberRoutes } from "./modules/members/routes"
import type { MemberService } from "./modules/members/service"
import { registerProxyRoutes } from "./modules/proxies/routes"
import type { ProxyService } from "./modules/proxies/service"
import { registerRegistrationResourceRoutes } from "./modules/registration-resources/routes"
import type { RegistrationResourceService } from "./modules/registration-resources/service"
import { registerResourceRoutes } from "./modules/resources/routes"
import type { ResourceService } from "./modules/resources/service"
import { registerSettingsRoutes } from "./modules/settings/routes"
import type { SettingsService } from "./modules/settings/service"
import { registerStorageRoutes } from "./modules/storage/routes"
import type { StorageService } from "./modules/storage/service"
import { registerTaskExecutionRoutes } from "./modules/task-execution/routes"
import type { TaskExecutionService } from "./modules/task-execution/service"

type AppOptions = {
  readonly auditExplorerRepository?: AuditExplorerRepository
  readonly auditRepository?: AuditRepository
  readonly authService?: AuthService
  readonly accessGroupRepository?: Pick<MemberRepository, "listGroups">
  readonly accountPoolService?: AccountPoolService
  readonly accountService?: AccountService
  readonly deviceService?: DeviceService
  readonly deviceCommandService?: DeviceCommandService
  readonly memberService?: MemberService
  readonly registrationResourceService?: RegistrationResourceService
  readonly proxyService?: ProxyService
  readonly resourceService?: ResourceService
  readonly settingsService?: SettingsService
  readonly storageService?: StorageService
  readonly taskExecutionService?: TaskExecutionService
}

export const createApp = (options: AppOptions = {}): Hono => {
  const app = new Hono()

  app.get("/health", (context) => context.json({ status: "ok" }))

  if (options.authService !== undefined && options.auditRepository !== undefined) {
    registerAuthRoutes(app, options.authService)
    registerFoundationAccessRoutes(
      app,
      options.authService,
      options.auditRepository,
      options.accessGroupRepository,
    )
    if (options.settingsService !== undefined) {
      registerSettingsRoutes(
        app,
        options.authService,
        options.auditRepository,
        options.settingsService,
      )
    }
    if (options.storageService !== undefined) {
      registerStorageRoutes(
        app,
        options.authService,
        options.auditRepository,
        options.storageService,
      )
    }
    if (options.memberService !== undefined) {
      registerMemberRoutes(app, options.authService, options.auditRepository, options.memberService)
    }
    if (options.auditExplorerRepository !== undefined) {
      registerAuditRoutes(
        app,
        options.authService,
        options.auditRepository,
        options.auditExplorerRepository,
      )
    }
    if (options.registrationResourceService !== undefined) {
      registerRegistrationResourceRoutes(
        app,
        options.authService,
        options.auditRepository,
        options.registrationResourceService,
      )
    }
    if (options.deviceService !== undefined) {
      registerDeviceRoutes(app, options.authService, options.auditRepository, options.deviceService)
    }
    if (options.deviceCommandService !== undefined) {
      registerDeviceCommandRoutes(
        app,
        options.authService,
        options.auditRepository,
        options.deviceCommandService,
      )
    }
    if (options.resourceService !== undefined) {
      registerResourceRoutes(
        app,
        options.authService,
        options.auditRepository,
        options.resourceService,
      )
    }
    if (options.accountService !== undefined) {
      registerAccountRoutes(
        app,
        options.authService,
        options.auditRepository,
        options.accountService,
      )
    }
    if (options.accountPoolService !== undefined) {
      registerAccountPoolRoutes(
        app,
        options.authService,
        options.auditRepository,
        options.accountPoolService,
      )
    }
    if (options.proxyService !== undefined) {
      registerProxyRoutes(app, options.authService, options.auditRepository, options.proxyService)
    }
    if (options.taskExecutionService !== undefined) {
      registerTaskExecutionRoutes(
        app,
        options.authService,
        options.auditRepository,
        options.taskExecutionService,
      )
    }
  }

  return app
}
