import type { ExecutableCommand } from "./commands"
import type {
  ExecutionLease,
  OutboxMessage,
  SystemActorMetadata,
  TaskRecord,
  TaskState,
  TaskStepRecord,
} from "./models"
import type { Reconciliation, ReconciliationOutcome } from "./reconciliation"

export type TaskSubmission = {
  readonly taskId: string
  readonly groupId: string
  readonly requesterId: string
  readonly deviceId: string
  readonly idempotencyKey: string
  readonly fingerprint: string
  readonly name: string
  readonly executorKey: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly maxAttempts: number
  readonly steps: readonly TaskSubmissionStep[]
}

export type TaskSubmissionStep = {
  readonly stepId: string
  readonly sequence: number
  readonly command: ExecutableCommand
  readonly fingerprint: string
}

export type TaskPage = {
  readonly items: readonly TaskRecord[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
}

export type TaskClaim = TaskRecord & {
  readonly runId: string
  readonly claimToken: string
  readonly leaseExpiresAt: number
}

export type OutboxFailure = {
  readonly error: string
  readonly availableAt: number
  readonly maxAttempts: number
}

export type OutboxDelivery = {
  readonly outboxId: string
  readonly owner: string
  readonly claimAttempt: number
  readonly now: number
}

export type DeviceLeaseInput = {
  readonly leaseId: string
  readonly taskId: string
  readonly groupId: string
  readonly deviceId: string
  readonly instanceId?: string
  readonly leaseToken: string
  readonly workerId: string
  readonly expiresAt: number
}

export class TaskIdempotencyConflictError extends Error {
  readonly code = "execution_task_idempotency_conflict"

  constructor() {
    super("Idempotency key already identifies another execution task")
    this.name = "TaskIdempotencyConflictError"
  }
}

export interface OutboxRepository {
  claimAvailable(owner: string, now: number, limit: number): Promise<readonly OutboxMessage[]>
  acknowledge(delivery: OutboxDelivery): Promise<void>
  fail(delivery: OutboxDelivery, availableAt: number): Promise<void>
}

export interface StepRepository {
  claimNext(
    taskId: string,
    runId: string,
    owner: string,
    claimToken: string,
    now: number,
  ): Promise<TaskStepRecord | null>
}

export interface LeaseRepository {
  renew(leaseId: string, owner: string, expiresAt: number, heartbeatAt: number): Promise<boolean>
  recoverStale(now: number, limit: number): Promise<readonly ExecutionLease[]>
}

export interface TaskRepository {
  get(groupId: string, taskId: string): Promise<TaskRecord | null>
  list(groupId: string, page: number, pageSize: number): Promise<TaskPage>
}

export interface ExecutionTaskRepository
  extends TaskRepository,
    OutboxRepository,
    StepRepository,
    LeaseRepository {
  reconcile(input: Reconciliation): Promise<ReconciliationOutcome>
  submit(
    input: TaskSubmission,
    actor: SystemActorMetadata,
  ): Promise<{ readonly task: TaskRecord; readonly created: boolean }>
  claimTask(owner: string, now: number, leaseMs: number): Promise<TaskClaim | null>
  renewTask(
    taskId: string,
    runId: string,
    claimToken: string,
    now: number,
    leaseMs: number,
  ): Promise<boolean>
  finishOwned(
    taskId: string,
    runId: string,
    claimToken: string,
    expectedState: TaskState,
    nextState: Extract<
      TaskState,
      "succeeded" | "failed" | "cancelled" | "timed_out" | "retry_waiting"
    >,
    now: number,
    nextRetryAt?: number,
  ): Promise<boolean>
  requestCancel(
    groupId: string,
    taskId: string,
    actor: SystemActorMetadata,
    now: number,
  ): Promise<boolean>
  acquireDeviceLease(input: DeviceLeaseInput): Promise<boolean>
  renewDeviceLease(
    leaseId: string,
    leaseToken: string,
    expiresAt: number,
    heartbeatAt: number,
  ): Promise<boolean>
  releaseDeviceLease(leaseId: string, leaseToken: string, reason: string): Promise<boolean>
}

export interface SystemActorProvider {
  executionActor(): SystemActorMetadata
}
