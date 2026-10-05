import type { DeviceError, DeviceErrorCode } from "./types"

export class DeviceAdapterError extends Error {
  override readonly name = "DeviceAdapterError"
  readonly code: DeviceErrorCode

  constructor(error: DeviceError) {
    super(error.message)
    this.code = error.code
  }

  toJSON(): DeviceError {
    return { code: this.code, message: this.message }
  }
}
