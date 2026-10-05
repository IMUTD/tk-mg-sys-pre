import type { Hono } from "hono"
import { z } from "zod"

import { Permission } from "../../lib/authorization"
import { OperationDeleteConflictError } from "../../lib/operation-claim-guard"
import { PageKey } from "../../lib/pages"
import { rejectUnlessPageDelete } from "../access/page-authorization"
import type { AuditRepository } from "../audit/service"
import type { AuthService } from "../auth/service"
import { DeviceConflictError, type DeviceInstanceUpdateInput } from "./repository"
import { authorizeDeviceRequest, hasDeviceAuthorizationFailure } from "./route-authorization"
import type { DeviceService } from "./service"

const DeviceInstanceCreateSchema = z.object({
  enabled: z.boolean().default(true),
  index: z.number().int().min(1).max(24),
  label: z.string().trim().min(1).max(128),
})

const DeviceInstanceUpdateSchema = DeviceInstanceCreateSchema.partial().refine(
  (input) => Object.keys(input).length > 0,
  "At least one instance field is required",
)

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

const asDeviceInstanceUpdate = (
  input: z.infer<typeof DeviceInstanceUpdateSchema>,
): DeviceInstanceUpdateInput => ({
  ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
  ...(input.index === undefined ? {} : { index: input.index }),
  ...(input.label === undefined ? {} : { label: input.label }),
})

export const registerDeviceInstanceRoutes = (
  app: Hono,
  authService: AuthService,
  auditRepository: AuditRepository,
  service: DeviceService,
): void => {
  app.post("/api/groups/:groupId/devices/:deviceId/instances", async (context) => {
    const authorization = await authorizeDeviceRequest(
      context,
      authService,
      auditRepository,
      "device.instance.create",
      Permission.DevicesWrite,
      PageKey.Devices,
    )
    if (hasDeviceAuthorizationFailure(authorization)) return authorization.response
    const input = await parseJson(context.req.raw, DeviceInstanceCreateSchema)
    if (input === null) return context.json({ error: "invalid_device_instance_request" }, 400)
    try {
      const instance = await service.createInstance(
        authorization.principal.userId,
        authorization.groupId,
        context.req.param("deviceId"),
        input,
      )
      return instance === null
        ? context.json({ error: "not_found" }, 404)
        : context.json(instance, 201)
    } catch (error) {
      if (error instanceof DeviceConflictError) return context.json({ error: error.code }, 409)
      throw error
    }
  })

  app.patch("/api/groups/:groupId/devices/:deviceId/instances/:instanceId", async (context) => {
    const authorization = await authorizeDeviceRequest(
      context,
      authService,
      auditRepository,
      "device.instance.update",
      Permission.DevicesWrite,
      PageKey.Devices,
    )
    if (hasDeviceAuthorizationFailure(authorization)) return authorization.response
    const input = await parseJson(context.req.raw, DeviceInstanceUpdateSchema)
    if (input === null) return context.json({ error: "invalid_device_instance_request" }, 400)
    try {
      const instance = await service.updateInstance(
        authorization.principal.userId,
        authorization.groupId,
        context.req.param("deviceId"),
        context.req.param("instanceId"),
        asDeviceInstanceUpdate(input),
      )
      return instance === null ? context.json({ error: "not_found" }, 404) : context.json(instance)
    } catch (error) {
      if (error instanceof DeviceConflictError) return context.json({ error: error.code }, 409)
      throw error
    }
  })

  app.delete("/api/groups/:groupId/devices/:deviceId/instances/:instanceId", async (context) => {
    const authorization = await authorizeDeviceRequest(
      context,
      authService,
      auditRepository,
      "device.instance.delete",
      Permission.DevicesWrite,
      PageKey.Devices,
    )
    if (hasDeviceAuthorizationFailure(authorization)) return authorization.response
    const denied = await rejectUnlessPageDelete(
      context,
      auditRepository,
      authorization.principal,
      "device.instance.delete",
      `device:${context.req.param("deviceId")}/instance:${context.req.param("instanceId")}`,
      PageKey.Devices,
    )
    if (denied !== null) return denied
    try {
      const deleted = await service.deleteInstance(
        authorization.principal.userId,
        authorization.groupId,
        context.req.param("deviceId"),
        context.req.param("instanceId"),
      )
      return deleted ? context.body(null, 204) : context.json({ error: "not_found" }, 404)
    } catch (error) {
      if (error instanceof OperationDeleteConflictError)
        return context.json({ error: "operation_entity_active" }, 409)
      throw error
    }
  })
}
