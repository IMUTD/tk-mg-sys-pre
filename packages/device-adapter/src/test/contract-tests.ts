import { describe, expect, it } from "bun:test"
import type { DeviceCommandId, DeviceId } from "../commands"
import {
  DeviceCommandIdSchema,
  DeviceIdSchema,
  DeviceInstanceIdSchema,
  IdempotencyKeySchema,
} from "../commands"
import { DeviceAdapterError } from "../errors"
import { type DeviceAdapter, DeviceErrorCode, type DeviceInstanceSnapshot } from "../types"

export interface DeviceAdapterHarness {
  readonly adapter: DeviceAdapter
  start(commandId: DeviceCommandId): void | Promise<void>
  complete(commandId: DeviceCommandId): void | Promise<void>
  fail(commandId: DeviceCommandId): void | Promise<void>
  timeout(commandId: DeviceCommandId): void | Promise<void>
  setAvailable(deviceId: DeviceId, available: boolean): void | Promise<void>
  setInstances(
    deviceId: DeviceId,
    instances: readonly DeviceInstanceSnapshot[],
  ): void | Promise<void>
}

export const runDeviceAdapterContract = (createHarness: () => DeviceAdapterHarness): void => {
  const deviceId = DeviceIdSchema.parse("device-1")
  const instanceId = DeviceInstanceIdSchema.parse("instance-1")
  const target = { deviceId, instanceId }
  const command = {
    commandId: DeviceCommandIdSchema.parse("00000000-0000-4000-8000-000000000001"),
    idempotencyKey: IdempotencyKeySchema.parse("request-1"),
    target,
    timeoutMs: 5000,
    type: "capture_screen" as const,
  }

  describe("device adapter contract", () => {
    it("returns the same receipt for an equivalent retry", async () => {
      const { adapter } = createHarness()
      const receipt = await adapter.submit(command)
      expect(
        await adapter.submit({
          ...command,
          commandId: DeviceCommandIdSchema.parse("00000000-0000-4000-8000-000000000002"),
        }),
      ).toEqual(receipt)
    })

    it("retries a completed command without restarting it", async () => {
      const harness = createHarness()
      await harness.adapter.submit(command)
      await harness.complete(command.commandId)
      expect(await harness.adapter.submit(command)).toEqual({
        commandId: command.commandId,
        status: "queued",
        retryable: true,
      })
      expect(await harness.adapter.getResult(command.commandId)).toMatchObject({
        status: "succeeded",
      })
    })

    it("rejects a reused idempotency key with a different payload", async () => {
      const { adapter } = createHarness()
      await adapter.submit(command)
      await expect(adapter.submit({ ...command, timeoutMs: 1000 })).rejects.toMatchObject({
        code: DeviceErrorCode.Conflict,
      })
    })

    it("rejects a reused command id with a different key", async () => {
      const { adapter } = createHarness()
      await adapter.submit(command)
      await expect(
        adapter.submit({ ...command, idempotencyKey: IdempotencyKeySchema.parse("request-2") }),
      ).rejects.toMatchObject({
        code: DeviceErrorCode.Conflict,
      })
    })

    it("polls queued, running and successful completion", async () => {
      const harness = createHarness()
      await harness.adapter.submit(command)
      expect(await harness.adapter.getResult(command.commandId)).toEqual({
        commandId: command.commandId,
        status: "queued",
        retryable: true,
      })
      await harness.start(command.commandId)
      expect(await harness.adapter.getResult(command.commandId)).toEqual({
        commandId: command.commandId,
        status: "running",
        retryable: true,
      })
      await harness.complete(command.commandId)
      expect(await harness.adapter.getResult(command.commandId)).toMatchObject({
        commandId: command.commandId,
        status: "succeeded",
      })
    })

    it("cancels a queued command idempotently", async () => {
      const harness = createHarness()
      await harness.adapter.submit(command)
      await harness.adapter.cancel(command.commandId)
      await harness.adapter.cancel(command.commandId)
      await harness.complete(command.commandId)
      expect(await harness.adapter.getResult(command.commandId)).toEqual({
        commandId: command.commandId,
        status: "cancelled",
        retryable: false,
      })
    })

    it("cancels a running command before completion", async () => {
      const harness = createHarness()
      await harness.adapter.submit(command)
      await harness.start(command.commandId)
      await harness.adapter.cancel(command.commandId)
      await harness.complete(command.commandId)
      expect(await harness.adapter.getResult(command.commandId)).toEqual({
        commandId: command.commandId,
        status: "cancelled",
        retryable: false,
      })
    })

    it("preserves completed results when cancellation arrives late", async () => {
      const harness = createHarness()
      await harness.adapter.submit(command)
      await harness.complete(command.commandId)
      await harness.adapter.cancel(command.commandId)
      expect(await harness.adapter.getResult(command.commandId)).toMatchObject({
        status: "succeeded",
      })
    })

    it("normalizes timeout and failure states", async () => {
      const harness = createHarness()
      await harness.adapter.submit(command)
      await harness.timeout(command.commandId)
      expect(await harness.adapter.getResult(command.commandId)).toMatchObject({
        status: "timed_out",
        error: { code: DeviceErrorCode.Timeout },
      })
      const other = {
        ...command,
        commandId: DeviceCommandIdSchema.parse("00000000-0000-4000-8000-000000000002"),
        idempotencyKey: IdempotencyKeySchema.parse("request-2"),
      }
      await harness.adapter.submit(other)
      await harness.fail(other.commandId)
      expect(await harness.adapter.getResult(other.commandId)).toMatchObject({
        status: "failed",
        error: { code: DeviceErrorCode.Failed },
      })
    })

    it("reports unavailable health and rejects submission without reserving its key", async () => {
      const harness = createHarness()
      await harness.setAvailable(deviceId, false)
      expect(await harness.adapter.health(target)).toMatchObject({
        status: "unavailable",
        error: { code: DeviceErrorCode.Unavailable },
      })
      await expect(harness.adapter.submit(command)).rejects.toMatchObject({
        code: DeviceErrorCode.Unavailable,
      })
      await harness.setAvailable(deviceId, true)
      expect(await harness.adapter.submit(command)).toEqual({
        commandId: command.commandId,
        status: "queued",
        retryable: true,
      })
    })

    it("returns available health and the requested device's instances", async () => {
      const harness = createHarness()
      const snapshots: readonly DeviceInstanceSnapshot[] = [
        { deviceId, instanceId, status: "available" },
      ]
      await harness.setInstances(deviceId, snapshots)
      expect(await harness.adapter.health(target)).toEqual({ status: "available" })
      expect(await harness.adapter.listInstances(deviceId)).toEqual(snapshots)
      expect(await harness.adapter.listInstances(DeviceIdSchema.parse("other-device"))).toEqual([])
    })

    it("normalizes unknown command ids", async () => {
      const { adapter } = createHarness()
      await expect(adapter.getResult(command.commandId)).rejects.toMatchObject({
        code: DeviceErrorCode.NotFound,
      })
      await expect(adapter.cancel(command.commandId)).rejects.toBeInstanceOf(DeviceAdapterError)
    })
  })
}
