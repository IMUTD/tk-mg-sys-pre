import type { DeviceCommandResult } from "@tk-mg/device-adapter"

export const isConfirmedProviderResult = (result: DeviceCommandResult): boolean => {
  switch (result.status) {
    case "succeeded":
    case "cancelled":
      return true
    case "failed":
    case "timed_out":
      return (
        !result.retryable && (result.error.code === "failed" || result.error.code === "timeout")
      )
    case "queued":
    case "running":
      return false
    default: {
      const exhaustive: never = result
      return exhaustive
    }
  }
}
