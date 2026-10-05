import { DeviceAdapterError, type DeviceError, type DeviceErrorCode } from "@tk-mg/device-adapter"

export const EXECUTION_LIMITS = {
  maxAttempts: { default: 3, maximum: 10 },
  baseBackoffMs: { default: 1000, maximum: 30_000 },
  maxBackoffMs: { default: 30_000, maximum: 120_000 },
  jitterMs: { default: 250, maximum: 10_000 },
  healthTimeoutMs: { default: 5000, maximum: 30_000 },
  submitTimeoutMs: { default: 10_000, maximum: 60_000 },
  pollTimeoutMs: { default: 5000, maximum: 30_000 },
  cancelTimeoutMs: { default: 5000, maximum: 30_000 },
  leaseMs: { default: 30_000, maximum: 300_000 },
  heartbeatMs: { default: 10_000, maximum: 60_000 },
  staleAfterMs: { default: 60_000, maximum: 600_000 },
} as const

export const EXECUTION_TIMEOUTS = {
  healthMs: EXECUTION_LIMITS.healthTimeoutMs.default,
  submitMs: EXECUTION_LIMITS.submitTimeoutMs.default,
  pollMs: EXECUTION_LIMITS.pollTimeoutMs.default,
  cancelMs: EXECUTION_LIMITS.cancelTimeoutMs.default,
} as const

export const LEASE_DEFAULTS = {
  leaseMs: EXECUTION_LIMITS.leaseMs.default,
  heartbeatMs: EXECUTION_LIMITS.heartbeatMs.default,
  staleAfterMs: EXECUTION_LIMITS.staleAfterMs.default,
} as const

export type RetryPolicy = {
  readonly maxAttempts: number
  readonly baseBackoffMs: number
  readonly maxBackoffMs: number
  readonly jitterMs: number
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: EXECUTION_LIMITS.maxAttempts.default,
  baseBackoffMs: EXECUTION_LIMITS.baseBackoffMs.default,
  maxBackoffMs: EXECUTION_LIMITS.maxBackoffMs.default,
  jitterMs: EXECUTION_LIMITS.jitterMs.default,
}

export const createRetryPolicy = (overrides: Partial<RetryPolicy> = {}): RetryPolicy => ({
  maxAttempts: Math.max(
    1,
    Math.min(
      overrides.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts,
      EXECUTION_LIMITS.maxAttempts.maximum,
    ),
  ),
  baseBackoffMs: Math.max(
    0,
    Math.min(
      overrides.baseBackoffMs ?? DEFAULT_RETRY_POLICY.baseBackoffMs,
      EXECUTION_LIMITS.baseBackoffMs.maximum,
    ),
  ),
  maxBackoffMs: Math.max(
    0,
    Math.min(
      overrides.maxBackoffMs ?? DEFAULT_RETRY_POLICY.maxBackoffMs,
      EXECUTION_LIMITS.maxBackoffMs.maximum,
    ),
  ),
  jitterMs: Math.max(
    0,
    Math.min(
      overrides.jitterMs ?? DEFAULT_RETRY_POLICY.jitterMs,
      EXECUTION_LIMITS.jitterMs.maximum,
    ),
  ),
})

export const retryDelayMs = (
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): number => {
  const exponential = Math.min(
    policy.maxBackoffMs,
    policy.baseBackoffMs * 2 ** Math.max(0, attempt - 1),
  )
  const jitter = Math.floor(Math.min(1, Math.max(0, random())) * policy.jitterMs)
  return Math.min(policy.maxBackoffMs, exponential + jitter)
}

export const retryDeadline = (
  now: number,
  attempt: number,
  minimumDelayMs: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): number => {
  const ceiling = Math.min(
    EXECUTION_LIMITS.maxBackoffMs.maximum,
    Math.max(policy.maxBackoffMs, minimumDelayMs),
  )
  return (
    now +
    Math.min(
      ceiling,
      Math.max(
        minimumDelayMs,
        retryDelayMs(
          attempt,
          {
            ...policy,
            maxBackoffMs: ceiling,
          },
          random,
        ),
      ),
    )
  )
}

const RETRYABLE_CODES: ReadonlySet<DeviceErrorCode> = new Set([
  "timeout",
  "unavailable",
  "failed",
  "cancel_failed",
])

export type ExecutionError = {
  readonly code: DeviceErrorCode | "unknown"
  readonly message: string
  readonly retryable: boolean
}

export class AdapterExecutionError extends Error {
  override readonly name = "AdapterExecutionError"
  readonly error: ExecutionError

  constructor(error: ExecutionError) {
    super(error.message)
    this.error = error
  }
}

export const mapAdapterError = (error: DeviceError): ExecutionError => ({
  code: error.code,
  message: error.message,
  retryable: RETRYABLE_CODES.has(error.code),
})

export const mapUnknownAdapterError = (error: unknown): ExecutionError => {
  if (error instanceof AdapterExecutionError) return error.error
  if (error instanceof DeviceAdapterError) return mapAdapterError(error.toJSON())
  if (error instanceof Error) return { code: "unknown", message: error.message, retryable: true }
  return { code: "unknown", message: "Unknown adapter failure", retryable: true }
}
