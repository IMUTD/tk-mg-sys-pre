import type { Hono } from "hono"
import { z } from "zod"

import { Permission } from "../../lib/authorization"
import { PageKey } from "../../lib/pages"
import type { AuditRepository } from "../audit/service"
import type { AuthService } from "../auth/service"
import {
  authorizeDeviceRequest,
  hasDeviceAuthorizationFailure,
} from "../devices/route-authorization"
import { CommandCancellationError, CommandConflictError } from "./repository"
import { type DeviceCommandService, SubmitCommandSchema } from "./service"

const PageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const registerDeviceCommandRoutes = (
  app: Hono,
  authService: AuthService,
  auditRepository: AuditRepository,
  service: DeviceCommandService,
): void => {
  app.post("/api/groups/:groupId/devices/:deviceId/commands", async (context) => {
    const access = await authorizeDeviceRequest(
      context,
      authService,
      auditRepository,
      "device.command.create",
      Permission.DevicesWrite,
      PageKey.Devices,
    )
    if (hasDeviceAuthorizationFailure(access)) return access.response
    let body: unknown
    try {
      body = await context.req.json()
    } catch (error) {
      if (error instanceof SyntaxError)
        return context.json({ error: "invalid_device_command_request" }, 400)
      throw error
    }
    const parsed = SubmitCommandSchema.safeParse(body)
    if (!parsed.success) return context.json({ error: "invalid_device_command_request" }, 400)
    try {
      const submitted = await service.submit(
        {
          actorId: access.principal.userId,
          groupId: access.groupId,
          deviceId: context.req.param("deviceId"),
        },
        parsed.data,
      )
      return submitted === null
        ? context.json({ error: "not_found" }, 404)
        : context.json(submitted.command, submitted.created ? 201 : 200)
    } catch (error) {
      if (error instanceof CommandConflictError) return context.json({ error: error.code }, 409)
      throw error
    }
  })

  app.get("/api/groups/:groupId/devices/:deviceId/commands", async (context) => {
    const access = await authorizeDeviceRequest(
      context,
      authService,
      auditRepository,
      "device.command.list",
      Permission.DevicesRead,
      PageKey.Devices,
    )
    if (hasDeviceAuthorizationFailure(access)) return access.response
    const page = PageSchema.safeParse(context.req.query())
    if (!page.success) return context.json({ error: "invalid_page" }, 400)
    const commands = await service.list(
      access.groupId,
      context.req.param("deviceId"),
      page.data.page,
      page.data.pageSize,
    )
    return commands === null ? context.json({ error: "not_found" }, 404) : context.json(commands)
  })

  app.get("/api/groups/:groupId/devices/:deviceId/commands/:commandId", async (context) => {
    const access = await authorizeDeviceRequest(
      context,
      authService,
      auditRepository,
      "device.command.detail",
      Permission.DevicesRead,
      PageKey.Devices,
    )
    if (hasDeviceAuthorizationFailure(access)) return access.response
    const command = await service.find(
      access.groupId,
      context.req.param("deviceId"),
      context.req.param("commandId"),
    )
    return command === null ? context.json({ error: "not_found" }, 404) : context.json(command)
  })

  app.post("/api/groups/:groupId/devices/:deviceId/commands/:commandId/cancel", async (context) => {
    const access = await authorizeDeviceRequest(
      context,
      authService,
      auditRepository,
      "device.command.cancel",
      Permission.DevicesWrite,
      PageKey.Devices,
    )
    if (hasDeviceAuthorizationFailure(access)) return access.response
    try {
      const command = await service.cancel(
        {
          actorId: access.principal.userId,
          groupId: access.groupId,
          deviceId: context.req.param("deviceId"),
        },
        context.req.param("commandId"),
      )
      return command === null ? context.json({ error: "not_found" }, 404) : context.json(command)
    } catch (error) {
      if (error instanceof CommandCancellationError) return context.json({ error: error.code }, 502)
      throw error
    }
  })
}
