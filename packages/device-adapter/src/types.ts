import type {
  DeviceCommand,
  DeviceCommandId,
  DeviceId,
  DeviceInstanceId,
  DeviceTarget,
} from "./commands"

export type DeviceHealth =
  | { readonly status: "available" }
  | { readonly status: "unconfigured"; readonly error: DeviceError }
  | { readonly status: "unavailable"; readonly error: DeviceError }
  | { readonly status: "timed_out"; readonly error: DeviceError }
  | { readonly status: "rejected"; readonly error: DeviceError }

export type DeviceInstanceSnapshot = {
  readonly deviceId: DeviceId
  readonly instanceId: DeviceInstanceId
  readonly status: "available" | "unavailable"
}

export const DeviceErrorCode = {
  Conflict: "conflict",
  NotFound: "not_found",
  Timeout: "timeout",
  Unavailable: "unavailable",
  Failed: "failed",
  Unconfigured: "unconfigured",
  Unsupported: "unsupported",
  InvalidRequest: "invalid_request",
  PermissionDenied: "permission_denied",
  CancelFailed: "cancel_failed",
} as const
export type DeviceErrorCode = (typeof DeviceErrorCode)[keyof typeof DeviceErrorCode]
export type DeviceError = { readonly code: DeviceErrorCode; readonly message: string }

export type DeviceCommandReceipt = {
  readonly commandId: DeviceCommandId
  readonly status: "queued"
  readonly providerReceiptId?: string
  readonly retryable: boolean
}

export type DeviceArtifactReference = {
  readonly kind: "artifact"
  readonly artifactId: string
}

export type DeviceCommandOutcome =
  | { readonly kind: "acknowledged" }
  | { readonly kind: "no_artifact" }
  | { readonly kind: "artifact"; readonly reference: DeviceArtifactReference }

type DeviceCommandProgress = {
  readonly commandId: DeviceCommandId
  readonly providerReceiptId?: string
  readonly retryable: boolean
}

export type DeviceCommandResult =
  | (DeviceCommandProgress & { readonly status: "queued" | "running" })
  | {
      readonly commandId: DeviceCommandId
      readonly status: "succeeded"
      readonly outcome: DeviceCommandOutcome
      readonly providerReceiptId?: string
      readonly retryable: boolean
    }
  | {
      readonly commandId: DeviceCommandId
      readonly status: "failed" | "timed_out"
      readonly error: DeviceError
      readonly providerReceiptId?: string
      readonly retryable: boolean
    }
  | (DeviceCommandProgress & { readonly status: "cancelled" })

export interface DeviceAdapter {
  health(target: DeviceTarget): Promise<DeviceHealth>
  listInstances(deviceId: DeviceId): Promise<readonly DeviceInstanceSnapshot[]>
  submit(command: DeviceCommand): Promise<DeviceCommandReceipt>
  getResult(commandId: DeviceCommandId): Promise<DeviceCommandResult>
  cancel(commandId: DeviceCommandId): Promise<void>
}
