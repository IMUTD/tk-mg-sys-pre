import { describe, expect, it } from "bun:test"
import {
  CaptureScreenCommandSchema,
  DeviceCommandSchema,
  DeviceIdSchema,
  DeviceTargetSchema,
  HealthCheckCommandSchema,
  InputTextCommandSchema,
  LaunchAppCommandSchema,
  StopAppCommandSchema,
  SwipeCommandSchema,
  TapCommandSchema,
} from "./commands"

describe("device command schemas", () => {
  const base = {
    commandId: "00000000-0000-4000-8000-000000000001",
    idempotencyKey: "key-1",
    target: { deviceId: "device-1", instanceId: "instance-1" },
    timeoutMs: 5000,
  }

  it("accepts each supported command", () => {
    const cases = [
      [HealthCheckCommandSchema, { ...base, type: "health_check" }],
      [CaptureScreenCommandSchema, { ...base, type: "capture_screen" }],
      [LaunchAppCommandSchema, { ...base, type: "launch_app", appId: "app" }],
      [StopAppCommandSchema, { ...base, type: "stop_app", appId: "app" }],
      [TapCommandSchema, { ...base, type: "tap", x: 0, y: 4 }],
      [
        SwipeCommandSchema,
        { ...base, type: "swipe", fromX: 0, fromY: 0, toX: 4, toY: 4, durationMs: 200 },
      ],
      [InputTextCommandSchema, { ...base, type: "input_text", text: "hello" }],
    ] as const
    for (const [schema, value] of cases) {
      expect(schema.safeParse(value).success).toBe(true)
      expect(DeviceCommandSchema.safeParse(value).success).toBe(true)
    }
  })

  it("rejects vendor parameters, invalid ids and nonpositive timeouts", () => {
    expect(
      DeviceCommandSchema.safeParse({ ...base, type: "tap", x: 1, y: 2, vendorToken: "secret" })
        .success,
    ).toBe(false)
    expect(
      DeviceCommandSchema.safeParse({ ...base, commandId: "not-uuid", type: "health_check" })
        .success,
    ).toBe(false)
    expect(
      DeviceCommandSchema.safeParse({ ...base, timeoutMs: 0, type: "health_check" }).success,
    ).toBe(false)
    expect(
      DeviceCommandSchema.safeParse({
        ...base,
        type: "swipe",
        fromX: 0,
        fromY: 0,
        toX: 1,
        toY: 1,
        durationMs: -1,
      }).success,
    ).toBe(false)
    expect(DeviceTargetSchema.safeParse({ deviceId: "device-1", vendorId: "secret" }).success).toBe(
      false,
    )
    expect(DeviceIdSchema.safeParse("").success).toBe(false)
  })
})
