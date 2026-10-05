import type { DeviceCommand, DeviceCommandId, DeviceId } from "./commands"
import { DeviceCommandSchema } from "./commands"
import { DeviceAdapterError } from "./errors"
import {
  type DeviceAdapter,
  type DeviceCommandReceipt,
  type DeviceCommandResult,
  DeviceErrorCode,
  type DeviceInstanceSnapshot,
} from "./types"

type CommandRecord = {
  readonly command: DeviceCommand
  readonly fingerprint: string
  readonly receipt: DeviceCommandReceipt
  result: DeviceCommandResult
}

export interface InMemoryDeviceAdapter extends DeviceAdapter {
  start(commandId: DeviceCommandId): void
  complete(commandId: DeviceCommandId): void
  fail(commandId: DeviceCommandId): void
  timeout(commandId: DeviceCommandId): void
  setAvailable(deviceId: DeviceId, available: boolean): void
  setInstances(deviceId: DeviceId, instances: readonly DeviceInstanceSnapshot[]): void
}

export type InMemoryDeviceAdapterOptions = {
  readonly autoComplete?: boolean
}

export const createInMemoryDeviceAdapter = (
  options: InMemoryDeviceAdapterOptions = {},
): InMemoryDeviceAdapter => {
  const commands = new Map<DeviceCommandId, CommandRecord>()
  const keys = new Map<string, CommandRecord>()
  const availability = new Map<DeviceId, boolean>()
  const instances = new Map<DeviceId, readonly DeviceInstanceSnapshot[]>()

  const requireCommand = (commandId: DeviceCommandId): CommandRecord => {
    const record = commands.get(commandId)
    if (record === undefined) {
      throw new DeviceAdapterError({ code: DeviceErrorCode.NotFound, message: "Command not found" })
    }
    return record
  }

  const isAvailable = (deviceId: DeviceId): boolean => availability.get(deviceId) !== false

  const finish = (commandId: DeviceCommandId, result: DeviceCommandResult): void => {
    const record = requireCommand(commandId)
    if (record.result.status === "queued" || record.result.status === "running") {
      record.result = result
    }
  }

  return {
    health: async (target) =>
      isAvailable(target.deviceId)
        ? { status: "available" }
        : {
            status: "unavailable",
            error: { code: DeviceErrorCode.Unavailable, message: "Device unavailable" },
          },
    listInstances: async (deviceId) =>
      (instances.get(deviceId) ?? []).map((snapshot) => ({ ...snapshot })),
    submit: async (command) => {
      const parsed = DeviceCommandSchema.parse(command)
      const fingerprint = JSON.stringify({
        ...parsed,
        commandId: undefined,
        idempotencyKey: undefined,
      })
      const existing = keys.get(parsed.idempotencyKey)
      if (existing !== undefined) {
        if (existing.fingerprint === fingerprint) return existing.receipt
        throw new DeviceAdapterError({
          code: DeviceErrorCode.Conflict,
          message: "Idempotency key conflict",
        })
      }
      if (commands.has(parsed.commandId)) {
        throw new DeviceAdapterError({
          code: DeviceErrorCode.Conflict,
          message: "Command ID conflict",
        })
      }
      if (!isAvailable(parsed.target.deviceId)) {
        throw new DeviceAdapterError({
          code: DeviceErrorCode.Unavailable,
          message: "Device unavailable",
        })
      }
      const receipt: DeviceCommandReceipt = {
        commandId: parsed.commandId,
        status: "queued",
        retryable: true,
      }
      const record: CommandRecord = {
        command: parsed,
        fingerprint,
        receipt,
        result: { commandId: parsed.commandId, status: "queued", retryable: true },
      }
      commands.set(parsed.commandId, record)
      keys.set(parsed.idempotencyKey, record)
      if (options.autoComplete === true) {
        record.result = {
          commandId: parsed.commandId,
          status: "succeeded",
          outcome: { kind: parsed.type === "capture_screen" ? "no_artifact" : "acknowledged" },
          retryable: false,
        }
      }
      return receipt
    },
    getResult: async (commandId) => requireCommand(commandId).result,
    cancel: async (commandId) => {
      const record = requireCommand(commandId)
      if (record.result.status === "queued" || record.result.status === "running") {
        record.result = { commandId, status: "cancelled", retryable: false }
      }
    },
    start: (commandId) => {
      const record = requireCommand(commandId)
      if (record.result.status === "queued") {
        record.result = { commandId, status: "running", retryable: true }
      }
    },
    complete: (commandId) => {
      const record = requireCommand(commandId)
      finish(commandId, {
        commandId,
        status: "succeeded",
        outcome: {
          kind: record.command.type === "capture_screen" ? "no_artifact" : "acknowledged",
        },
        retryable: false,
      })
    },
    fail: (commandId) =>
      finish(commandId, {
        commandId,
        status: "failed",
        error: { code: DeviceErrorCode.Failed, message: "Device command failed" },
        retryable: false,
      }),
    timeout: (commandId) =>
      finish(commandId, {
        commandId,
        status: "timed_out",
        error: { code: DeviceErrorCode.Timeout, message: "Device command timed out" },
        retryable: true,
      }),
    setAvailable: (deviceId, available) => {
      availability.set(deviceId, available)
    },
    setInstances: (deviceId, snapshots) => {
      instances.set(
        deviceId,
        snapshots.map((snapshot) => ({ ...snapshot })),
      )
    },
  }
}
