import type { DeviceCommandId, DeviceCommandResult, DeviceTarget } from "@tk-mg/device-adapter"
import type { ExecutableCommand } from "./commands"

export type TaskState =
  | "queued"
  | "dispatching"
  | "running"
  | "retry_waiting"
  | "cancel_requested"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "needs_reconciliation"

export type StepState =
  | "pending"
  | "claimed"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "skipped"

export type SystemActorMetadata = {
  readonly actorId: string
  readonly actorType: "system" | "user" | "service"
  readonly requestId: string
}

export type TaskRecord = {
  readonly taskId: string
  readonly groupId: string
  readonly target: DeviceTarget
  readonly state: TaskState
  readonly attempt: number
  readonly maxAttempts: number
  readonly steps: readonly TaskStepRecord[]
  readonly actor: SystemActorMetadata
  readonly createdAt: number
  readonly updatedAt: number
}

export type TaskStepRecord = {
  readonly stepId: string
  readonly taskId: string
  readonly ordinal: number
  readonly command: ExecutableCommand
  readonly state: StepState
  readonly attempt: number
  readonly commandId?: DeviceCommandId
  readonly result?: DeviceCommandResult
  readonly errorCode?: string
  readonly errorMessage?: string
}

export type TaskRunRecord = {
  readonly runId: string
  readonly taskId: string
  readonly stepId: string
  readonly attempt: number
  readonly startedAt: number
  readonly finishedAt?: number
  readonly outcome?: "succeeded" | "failed" | "cancelled" | "timed_out"
}

export type OutboxMessage = {
  readonly outboxId: string
  readonly aggregateId: string
  readonly eventType: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly availableAt: number
  readonly claimedAt?: number
  readonly claimOwner?: string
  readonly claimAttempt?: number
}

export type ExecutionLease = {
  readonly leaseId: string
  readonly taskId: string
  readonly stepId: string | null
  readonly owner: string
  readonly expiresAt: number
  readonly heartbeatAt: number
}

export type AuditEntry = {
  readonly taskId: string
  readonly stepId?: string
  readonly eventType: string
  readonly actor: SystemActorMetadata
  readonly metadata: Readonly<Record<string, unknown>>
  readonly occurredAt: number
}
