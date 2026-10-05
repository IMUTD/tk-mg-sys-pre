import type { DeviceCommand } from "@tk-mg/device-adapter"

import type { AuditEventInput } from "../audit/service"

export type CommandStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
export type SafeParameters = Readonly<Record<string, string | number>>
export type SafeProviderReceipt = {
  readonly status: "queued"
  readonly providerReceiptId: string | null
  readonly retryable: boolean
}
export type SafeResult =
  | { readonly kind: "acknowledged" }
  | { readonly kind: "no_artifact" }
  | { readonly kind: "artifact"; readonly reference: string }
  | {
      readonly kind: "health"
      readonly status: "available" | "unavailable" | "timed_out" | "unconfigured" | "rejected"
    }
export type CommandRecord = {
  readonly id: string
  readonly idempotencyKey: string
  readonly fingerprint: string
  readonly deviceId: string
  readonly instanceId: string | null
  readonly groupId: string
  readonly requesterId: string
  readonly kind: DeviceCommand["type"]
  readonly parameters: SafeParameters
  readonly timeoutMs: number
  readonly status: CommandStatus
  readonly providerReceipt: SafeProviderReceipt | null
  readonly errorCode: string | null
  readonly resultReference: string | null
  readonly result: SafeResult | null
  readonly createdAt: Date
  readonly startedAt: Date | null
  readonly finishedAt: Date | null
  readonly claimToken: string | null
  readonly claimedAt: Date | null
  readonly leaseExpiresAt: Date | null
  readonly attemptCount: number
  readonly cancelRequestedAt: Date | null
  readonly cancelErrorCode: string | null
}
export type CommandEvent = {
  readonly commandId: string
  readonly status: CommandStatus
  readonly createdAt: Date
}
export type NewCommand = Pick<
  CommandRecord,
  | "id"
  | "idempotencyKey"
  | "fingerprint"
  | "deviceId"
  | "instanceId"
  | "groupId"
  | "requesterId"
  | "kind"
  | "parameters"
  | "timeoutMs"
>
export type CommandPage = {
  readonly items: readonly CommandRecord[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
}
export type CommandFinish = Pick<
  CommandRecord,
  "status" | "providerReceipt" | "errorCode" | "resultReference" | "result"
>

export type CommandClaim = CommandRecord & {
  readonly command: CommandRecord
  readonly claimToken: string
}

export interface DeviceCommandRepository {
  submit(
    input: NewCommand,
    audit: AuditEventInput,
  ): Promise<{ readonly command: CommandRecord; readonly created: boolean }>
  find(groupId: string, deviceId: string, commandId: string): Promise<CommandRecord | null>
  list(groupId: string, deviceId: string, page: number, pageSize: number): Promise<CommandPage>
  claim(commandId: string): Promise<CommandClaim | null>
  renew(commandId: string, claimToken: string): Promise<CommandRecord | null>
  recordReceipt(
    commandId: string,
    claimToken: string,
    receipt: SafeProviderReceipt,
  ): Promise<CommandRecord | null>
  finish(
    commandId: string,
    claimToken: string,
    result: CommandFinish,
  ): Promise<CommandRecord | null>
  requestCancel(
    groupId: string,
    deviceId: string,
    commandId: string,
    audit: AuditEventInput,
  ): Promise<{ readonly command: CommandRecord; readonly changed: boolean } | null>
  cancel(
    groupId: string,
    deviceId: string,
    commandId: string,
    audit: AuditEventInput,
  ): Promise<{ readonly command: CommandRecord; readonly changed: boolean } | null>
  finalizeCancel(commandId: string, claimToken: string): Promise<CommandRecord | null>
  recordCancelFailure(commandId: string, claimToken: string): Promise<CommandRecord | null>
}

export class CommandConflictError extends Error {
  public readonly code = "device_command_idempotency_conflict"
  public constructor() {
    super("Idempotency key already identifies another command")
    this.name = "CommandConflictError"
  }
}

export class CommandCancellationError extends Error {
  public readonly code = "cancel_failed"
  public constructor() {
    super("Device command cancellation failed")
    this.name = "CommandCancellationError"
  }
}
