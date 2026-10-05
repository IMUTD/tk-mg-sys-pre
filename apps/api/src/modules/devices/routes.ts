import type { Hono } from "hono"
import { z } from "zod"

import { Permission } from "../../lib/authorization"
import { OperationDeleteConflictError } from "../../lib/operation-claim-guard"
import { PageKey } from "../../lib/pages"
import { rejectUnlessPageDelete } from "../access/page-authorization"
import type { AuditRepository } from "../audit/service"
import type { AuthService } from "../auth/service"
import { registerDeviceInstanceRoutes } from "./instance-routes"
import { DeviceConflictError, type DeviceUpdateInput } from "./repository"
import { authorizeDeviceRequest, hasDeviceAuthorizationFailure } from "./route-authorization"
import type { DeviceService } from "./service"

const DeviceCreateSchema = z.object({
  bridge: z.boolean(),
  host: z.string().trim().min(1).max(253),
  model: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(128),
  resourceCount: z.number().int().min(0).max(100_000).default(0),
  version: z.string().trim().min(1).max(128).nullable().default(null),
})

const DeviceUpdateSchema = DeviceCreateSchema.partial()
  .extend({ enabled: z.boolean().optional() })
  .refine((input) => Object.keys(input).length > 0, "At least one device field is required")

const asDeviceUpdate = (input: z.infer<typeof DeviceUpdateSchema>): DeviceUpdateInput => ({
  ...(input.bridge === undefined ? {} : { bridge: input.bridge }),
  ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
  ...(input.host === undefined ? {} : { host: input.host }),
  ...(input.model === undefined ? {} : { model: input.model }),
  ...(input.name === undefined ? {} : { name: input.name }),
  ...(input.resourceCount === undefined ? {} : { resourceCount: input.resourceCount }),
  ...(input.version === undefined ? {} : { version: input.version }),
})

const parseJson = async <T>(request: Request, schema: z.ZodType<T>): Promise<T | null> => {
  try {
    const parsed = schema.safeParse(await request.json())
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

export const registerDeviceRoutes = (
  app: Hono,
  authService: AuthService,
  auditRepository: AuditRepository,
  service: DeviceService,
): void => {
  app.get("/api/groups/:groupId/devices", async (context) => {
    const authorization = await authorizeDeviceRequest(
      context,
      authService,
      auditRepository,
      "device.list",
      Permission.DevicesRead,
      PageKey.Devices,
    )
    if (hasDeviceAuthorizationFailure(authorization)) {
      return authorization.response
    }
    return context.json({ items: await service.list(authorization.groupId) })
  })

  app.post("/api/groups/:groupId/devices", async (context) => {
    const authorization = await authorizeDeviceRequest(
      context,
      authService,
      auditRepository,
      "device.create",
      Permission.DevicesWrite,
      PageKey.Devices,
    )
    if (hasDeviceAuthorizationFailure(authorization)) {
      return authorization.response
    }
    const input = await parseJson(context.req.raw, DeviceCreateSchema)
    if (input === null) {
      return context.json({ error: "invalid_device_request" }, 400)
    }
    try {
      return context.json(
        await service.create(authorization.principal.userId, authorization.groupId, input),
        201,
      )
    } catch (error) {
      if (error instanceof DeviceConflictError) return context.json({ error: error.code }, 409)
      throw error
    }
  })

  app.get("/api/groups/:groupId/devices/:deviceId", async (context) => {
    const authorization = await authorizeDeviceRequest(
      context,
      authService,
      auditRepository,
      "device.detail",
      Permission.DevicesRead,
      PageKey.Devices,
    )
    if (hasDeviceAuthorizationFailure(authorization)) {
      return authorization.response
    }
    const devices = await service.list(authorization.groupId)
    const device = devices.find((candidate) => candidate.id === context.req.param("deviceId"))
    return device === undefined ? context.json({ error: "not_found" }, 404) : context.json(device)
  })

  app.get("/api/groups/:groupId/devices/:deviceId/status", async (context) => {
    const authorization = await authorizeDeviceRequest(
      context,
      authService,
      auditRepository,
      "device.status",
      Permission.DevicesRead,
      PageKey.Devices,
    )
    if (hasDeviceAuthorizationFailure(authorization)) {
      return authorization.response
    }
    const status = await service.status(authorization.groupId, context.req.param("deviceId"))
    return status === null ? context.json({ error: "not_found" }, 404) : context.json(status)
  })

  app.patch("/api/groups/:groupId/devices/:deviceId", async (context) => {
    const authorization = await authorizeDeviceRequest(
      context,
      authService,
      auditRepository,
      "device.update",
      Permission.DevicesWrite,
      PageKey.Devices,
    )
    if (hasDeviceAuthorizationFailure(authorization)) {
      return authorization.response
    }
    const input = await parseJson(context.req.raw, DeviceUpdateSchema)
    if (input === null) {
      return context.json({ error: "invalid_device_request" }, 400)
    }
    try {
      const device = await service.update(
        authorization.principal.userId,
        authorization.groupId,
        context.req.param("deviceId"),
        asDeviceUpdate(input),
      )
      return device === null ? context.json({ error: "not_found" }, 404) : context.json(device)
    } catch (error) {
      if (error instanceof DeviceConflictError) return context.json({ error: error.code }, 409)
      throw error
    }
  })

  app.delete("/api/groups/:groupId/devices/:deviceId", async (context) => {
    const authorization = await authorizeDeviceRequest(
      context,
      authService,
      auditRepository,
      "device.delete",
      Permission.DevicesWrite,
      PageKey.Devices,
    )
    if (hasDeviceAuthorizationFailure(authorization)) {
      return authorization.response
    }
    const denied = await rejectUnlessPageDelete(
      context,
      auditRepository,
      authorization.principal,
      "device.delete",
      `device:${context.req.param("deviceId")}`,
      PageKey.Devices,
    )
    if (denied !== null) return denied
    try {
      const deleted = await service.delete(
        authorization.principal.userId,
        authorization.groupId,
        context.req.param("deviceId"),
      )
      return deleted ? context.body(null, 204) : context.json({ error: "not_found" }, 404)
    } catch (error) {
      if (error instanceof OperationDeleteConflictError)
        return context.json({ error: "operation_entity_active" }, 409)
      throw error
    }
  })

  registerDeviceInstanceRoutes(app, authService, auditRepository, service)
}
