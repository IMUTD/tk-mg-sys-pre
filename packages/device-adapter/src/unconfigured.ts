import type { DeviceCommand, DeviceCommandId, DeviceId, DeviceTarget } from "./commands"
import { DeviceAdapterError } from "./errors"
import type {
  DeviceAdapter,
  DeviceCommandReceipt,
  DeviceCommandResult,
  DeviceHealth,
  DeviceInstanceSnapshot,
} from "./types"

const unconfiguredError = (): DeviceAdapterError =>
  new DeviceAdapterError({ code: "unconfigured", message: "No device adapter is configured" })

export const createUnconfiguredDeviceAdapter = (): DeviceAdapter => {
  const health = async (_target: DeviceTarget): Promise<DeviceHealth> => ({
    status: "unconfigured",
    error: unconfiguredError().toJSON(),
  })
  const listInstances = async (
    _deviceId: DeviceId,
  ): Promise<readonly DeviceInstanceSnapshot[]> => []
  const submit = async (_command: DeviceCommand): Promise<DeviceCommandReceipt> => {
    throw unconfiguredError()
  }
  const getResult = async (_commandId: DeviceCommandId): Promise<DeviceCommandResult> => {
    throw unconfiguredError()
  }
  const cancel = async (_commandId: DeviceCommandId): Promise<void> => {
    throw unconfiguredError()
  }

  return { health, listInstances, submit, getResult, cancel }
}
