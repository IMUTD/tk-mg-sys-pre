import { z } from "zod"

export const DeviceIdSchema = z.string().min(1).brand("DeviceId")
export const DeviceInstanceIdSchema = z.string().min(1).brand("DeviceInstanceId")
export const DeviceCommandIdSchema = z.uuid().brand("DeviceCommandId")
export const IdempotencyKeySchema = z.string().min(1).brand("IdempotencyKey")

export type DeviceId = z.infer<typeof DeviceIdSchema>
export type DeviceInstanceId = z.infer<typeof DeviceInstanceIdSchema>
export type DeviceCommandId = z.infer<typeof DeviceCommandIdSchema>
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>

export const DeviceTargetSchema = z.strictObject({
  deviceId: DeviceIdSchema,
  instanceId: DeviceInstanceIdSchema.optional(),
})
export type DeviceTarget = z.infer<typeof DeviceTargetSchema>

const base = z.strictObject({
  commandId: DeviceCommandIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  target: DeviceTargetSchema,
  timeoutMs: z.number().int().positive(),
})

export const HealthCheckCommandSchema = base.extend({ type: z.literal("health_check") })
export const CaptureScreenCommandSchema = base.extend({ type: z.literal("capture_screen") })
export const LaunchAppCommandSchema = base.extend({
  type: z.literal("launch_app"),
  appId: z.string().min(1),
})
export const StopAppCommandSchema = base.extend({
  type: z.literal("stop_app"),
  appId: z.string().min(1),
})
export const TapCommandSchema = base.extend({
  type: z.literal("tap"),
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
})
export const SwipeCommandSchema = base.extend({
  type: z.literal("swipe"),
  fromX: z.number().finite().nonnegative(),
  fromY: z.number().finite().nonnegative(),
  toX: z.number().finite().nonnegative(),
  toY: z.number().finite().nonnegative(),
  durationMs: z.number().int().positive(),
})
export const InputTextCommandSchema = base.extend({
  type: z.literal("input_text"),
  text: z.string().min(1),
})

export const DeviceCommandSchema = z.discriminatedUnion("type", [
  HealthCheckCommandSchema,
  CaptureScreenCommandSchema,
  LaunchAppCommandSchema,
  StopAppCommandSchema,
  TapCommandSchema,
  SwipeCommandSchema,
  InputTextCommandSchema,
])
export type DeviceCommand = z.infer<typeof DeviceCommandSchema>
