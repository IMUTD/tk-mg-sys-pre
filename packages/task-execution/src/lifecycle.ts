import type { StepState, TaskState } from "./models"

export type TaskTransitionContext = {
  readonly reason?:
    | "ambiguous_provider"
    | "invalid_persisted_validation"
    | "provider_success"
    | "operator_reconciliation"
  readonly allStepsComplete?: boolean
}

const TASK_STATES = [
  "queued",
  "dispatching",
  "running",
  "retry_waiting",
  "cancel_requested",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "needs_reconciliation",
] as const satisfies readonly TaskState[]

const STEP_STATES = [
  "pending",
  "claimed",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
  "skipped",
] as const satisfies readonly StepState[]

export const LEGAL_TASK_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  queued: ["queued", "dispatching", "cancelled", "failed"],
  dispatching: [
    "dispatching",
    "running",
    "retry_waiting",
    "failed",
    "timed_out",
    "cancel_requested",
    "needs_reconciliation",
  ],
  running: [
    "running",
    "succeeded",
    "retry_waiting",
    "failed",
    "timed_out",
    "cancel_requested",
    "needs_reconciliation",
  ],
  retry_waiting: ["retry_waiting", "dispatching", "cancelled", "failed"],
  cancel_requested: [
    "cancel_requested",
    "cancelled",
    "failed",
    "succeeded",
    "needs_reconciliation",
  ],
  succeeded: ["succeeded"],
  failed: ["failed"],
  cancelled: ["cancelled"],
  timed_out: ["timed_out"],
  needs_reconciliation: ["needs_reconciliation", "succeeded", "failed", "cancelled", "timed_out"],
}

export class InvalidTaskTransitionError extends Error {
  override readonly name = "InvalidTaskTransitionError"
  readonly from: TaskState
  readonly to: TaskState

  constructor(from: TaskState, to: TaskState) {
    super(`Illegal task transition: ${from} -> ${to}`)
    this.from = from
    this.to = to
  }
}

export const canTransitionTask = (
  from: TaskState,
  to: TaskState,
  context: TaskTransitionContext = {},
): boolean => {
  if (!LEGAL_TASK_TRANSITIONS[from].includes(to)) return false
  if (from === to) return true
  if ((from === "queued" || from === "retry_waiting") && to === "failed")
    return context.reason === "invalid_persisted_validation"
  if (to === "needs_reconciliation") return context.reason === "ambiguous_provider"
  if (from === "cancel_requested" && to === "succeeded")
    return context.reason === "provider_success" && context.allStepsComplete === true
  if (from === "needs_reconciliation") return context.reason === "operator_reconciliation"
  return true
}

export const transitionTask = (
  from: TaskState,
  to: TaskState,
  context?: TaskTransitionContext,
): TaskState => {
  if (!canTransitionTask(from, to, context)) throw new InvalidTaskTransitionError(from, to)
  return to
}

export const parsePersistedTaskState = (value: string): TaskState => {
  if (isTaskState(value)) return value
  throw new Error("Invalid persisted task state")
}

export const parsePersistedStepState = (value: string): StepState => {
  if (isStepState(value)) return value
  throw new Error("Invalid persisted step state")
}

export const isTaskState = (value: string): value is TaskState =>
  TASK_STATES.some((state) => state === value)

const isStepState = (value: string): value is StepState =>
  STEP_STATES.some((state) => state === value)

export const recoverExpiredLease = (
  state: Extract<TaskState, "dispatching" | "running" | "cancel_requested">,
  attempt: number,
  maxAttempts: number,
): Extract<TaskState, "retry_waiting" | "failed" | "needs_reconciliation"> => {
  if (state === "cancel_requested") {
    transitionTask(state, "needs_reconciliation", { reason: "ambiguous_provider" })
    return "needs_reconciliation"
  }
  if (attempt < maxAttempts) {
    transitionTask(state, "retry_waiting")
    return "retry_waiting"
  }
  transitionTask(state, "failed")
  return "failed"
}

export type PersistedStepState = Extract<
  StepState,
  "pending" | "claimed" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled" | "skipped"
>

type StaleRecoveryInput = {
  readonly taskState: Extract<TaskState, "dispatching" | "running" | "cancel_requested">
  readonly stepState: PersistedStepState | null
  readonly retryCount: number
  readonly maxAttempts: number
  readonly allStepsComplete: boolean
  readonly providerSuccessConfirmed?: boolean
  readonly submitStarted?: boolean
}

type StaleRecoveryDecision = {
  readonly nextState: Extract<
    TaskState,
    "succeeded" | "failed" | "timed_out" | "cancelled" | "retry_waiting" | "needs_reconciliation"
  >
  readonly reason:
    | "step_failed"
    | "step_timed_out"
    | "step_cancelled"
    | "step_succeeded"
    | "cancel_requested"
    | "lease_expired"
    | "reconciliation_required"
}

export const decideStaleRecovery = (input: StaleRecoveryInput): StaleRecoveryDecision => {
  if (
    input.submitStarted &&
    (input.stepState === "claimed" ||
      input.stepState === "running" ||
      input.stepState === "pending")
  )
    return { nextState: "needs_reconciliation", reason: "reconciliation_required" }
  switch (input.taskState) {
    case "cancel_requested":
      if (input.submitStarted && (input.stepState === "claimed" || input.stepState === "running"))
        return { nextState: "needs_reconciliation", reason: "reconciliation_required" }
      if (input.allStepsComplete && input.providerSuccessConfirmed)
        return { nextState: "succeeded", reason: "step_succeeded" }
      if (input.stepState === "failed" || input.stepState === "timed_out")
        return {
          nextState: "failed",
          reason: input.stepState === "failed" ? "step_failed" : "step_timed_out",
        }
      return { nextState: "cancelled", reason: "cancel_requested" }
    case "dispatching":
    case "running":
      switch (input.stepState) {
        case "failed":
          return { nextState: "failed", reason: "step_failed" }
        case "timed_out":
          return { nextState: "timed_out", reason: "step_timed_out" }
        case "cancelled":
          return { nextState: "failed", reason: "step_cancelled" }
        case "succeeded":
        case "skipped":
        case null:
          if (input.allStepsComplete && input.taskState === "running")
            return { nextState: "succeeded", reason: "step_succeeded" }
          break
        case "pending":
        case "claimed":
        case "running":
          break
        default: {
          const exhaustive: never = input.stepState
          return exhaustive
        }
      }
      return input.retryCount + 1 >= input.maxAttempts
        ? { nextState: "failed", reason: "lease_expired" }
        : { nextState: "retry_waiting", reason: "lease_expired" }
    default: {
      const exhaustive: never = input.taskState
      return exhaustive
    }
  }
}
