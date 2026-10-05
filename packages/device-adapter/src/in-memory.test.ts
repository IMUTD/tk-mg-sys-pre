import { expect, it } from "bun:test"
import { DeviceCommandIdSchema, DeviceIdSchema, IdempotencyKeySchema } from "./commands"
import { DeviceAdapterError } from "./errors"
import { createInMemoryDeviceAdapter } from "./in-memory"
import { runDeviceAdapterContract } from "./test/contract-tests"
import { createUnconfiguredDeviceAdapter } from "./unconfigured"

runDeviceAdapterContract(() => {
  const adapter = createInMemoryDeviceAdapter()
  return {
    adapter,
    start: adapter.start,
    complete: adapter.complete,
    fail: adapter.fail,
    timeout: adapter.timeout,
    setAvailable: adapter.setAvailable,
    setInstances: adapter.setInstances,
  }
})

it("serializes normalized adapter errors without leaking a stack", () => {
  const error = new DeviceAdapterError({ code: "unavailable", message: "Device unavailable" })
  expect(JSON.parse(JSON.stringify(error))).toEqual({
    code: "unavailable",
    message: "Device unavailable",
  })
})

it("returns no artifact rather than a fabricated screenshot", async () => {
  const adapter = createInMemoryDeviceAdapter()
  const commandId = DeviceCommandIdSchema.parse("00000000-0000-4000-8000-000000000004")
  await adapter.submit({
    commandId,
    idempotencyKey: IdempotencyKeySchema.parse("capture-1"),
    target: { deviceId: DeviceIdSchema.parse("device-1") },
    timeoutMs: 5000,
    type: "capture_screen",
  })
  adapter.complete(commandId)
  expect(await adapter.getResult(commandId)).toEqual({
    commandId,
    status: "succeeded",
    outcome: { kind: "no_artifact" },
    retryable: false,
  })
})

it("acknowledges successful non-screenshot commands", async () => {
  const adapter = createInMemoryDeviceAdapter()
  const command = {
    commandId: DeviceCommandIdSchema.parse("00000000-0000-4000-8000-000000000003"),
    idempotencyKey: IdempotencyKeySchema.parse("launch-1"),
    target: { deviceId: DeviceIdSchema.parse("device-1") },
    timeoutMs: 5000,
    type: "launch_app" as const,
    appId: "app-1",
  }
  await adapter.submit(command)
  adapter.complete(command.commandId)
  expect(await adapter.getResult(command.commandId)).toEqual({
    commandId: command.commandId,
    status: "succeeded",
    outcome: { kind: "acknowledged" },
    retryable: false,
  })
})

it("auto-completes only when explicitly configured for a local demo", async () => {
  const adapter = createInMemoryDeviceAdapter({ autoComplete: true })
  const commandId = DeviceCommandIdSchema.parse("00000000-0000-4000-8000-000000000005")
  await adapter.submit({
    commandId,
    idempotencyKey: IdempotencyKeySchema.parse("demo-1"),
    target: { deviceId: DeviceIdSchema.parse("device-1") },
    timeoutMs: 5000,
    type: "health_check",
  })
  expect(await adapter.getResult(commandId)).toMatchObject({
    status: "succeeded",
    outcome: { kind: "acknowledged" },
    retryable: false,
  })
})

it("reports an explicit unconfigured adapter without accepting commands", async () => {
  const adapter = createUnconfiguredDeviceAdapter()
  expect(await adapter.health({ deviceId: DeviceIdSchema.parse("device-1") })).toMatchObject({
    status: "unconfigured",
    error: { code: "unconfigured" },
  })
  await expect(
    adapter.submit({
      commandId: DeviceCommandIdSchema.parse("00000000-0000-4000-8000-000000000006"),
      idempotencyKey: IdempotencyKeySchema.parse("unconfigured-1"),
      target: { deviceId: DeviceIdSchema.parse("device-1") },
      timeoutMs: 5000,
      type: "health_check",
    }),
  ).rejects.toMatchObject({ code: "unconfigured" })
})
