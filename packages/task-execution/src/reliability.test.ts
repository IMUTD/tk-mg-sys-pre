import { describe, expect, it } from "bun:test"
import { DeviceAdapterError, DeviceErrorCode } from "@tk-mg/device-adapter"
import {
  canTransitionTask,
  createRetryPolicy,
  decideStaleRecovery,
  EXECUTION_LIMITS,
  EXECUTION_TIMEOUTS,
  LEASE_DEFAULTS,
  mapUnknownAdapterError,
  parsePersistedStepState,
  recoverExpiredLease,
  redactSecrets,
  retryDeadline,
  retryDelayMs,
  transitionTask,
} from "./index"

describe("lifecycle reliability", () => {
  for (const stepState of ["claimed", "running"] as const) {
    it(`cancels expired pre-submit ${stepState} step without provider uncertainty`, () => {
      expect(
        decideStaleRecovery({
          taskState: "cancel_requested",
          stepState,
          retryCount: 0,
          maxAttempts: 3,
          allStepsComplete: false,
          submitStarted: false,
        }),
      ).toEqual({ nextState: "cancelled", reason: "cancel_requested" })
      expect(
        decideStaleRecovery({
          taskState: "cancel_requested",
          stepState,
          retryCount: 0,
          maxAttempts: 3,
          allStepsComplete: false,
          submitStarted: true,
        }),
      ).toEqual({ nextState: "needs_reconciliation", reason: "reconciliation_required" })
    })
  }
  it("restricts retry_waiting failure to invalid persisted validation", () => {
    expect(
      canTransitionTask("retry_waiting", "failed", { reason: "invalid_persisted_validation" }),
    ).toBe(true)
    expect(canTransitionTask("retry_waiting", "failed")).toBe(false)
    expect(canTransitionTask("retry_waiting", "failed", { reason: "ambiguous_provider" })).toBe(
      false,
    )
    expect(
      canTransitionTask("succeeded", "failed", { reason: "invalid_persisted_validation" }),
    ).toBe(false)
    expect(
      canTransitionTask("cancelled", "failed", { reason: "invalid_persisted_validation" }),
    ).toBe(false)
    expect(
      canTransitionTask("timed_out", "failed", { reason: "invalid_persisted_validation" }),
    ).toBe(false)
  })
  it("quarantines a marked unresolved step when recovering an expired run", () => {
    expect(
      decideStaleRecovery({
        taskState: "running",
        stepState: "claimed",
        retryCount: 0,
        maxAttempts: 3,
        allStepsComplete: false,
        submitStarted: true,
      }),
    ).toEqual({ nextState: "needs_reconciliation", reason: "reconciliation_required" })
  })
  it("never recovers dispatching directly to succeeded", () => {
    expect(
      decideStaleRecovery({
        taskState: "dispatching",
        stepState: "succeeded",
        retryCount: 0,
        maxAttempts: 3,
        allStepsComplete: true,
      }),
    ).toEqual({
      nextState: "retry_waiting",
      reason: "lease_expired",
    })
  })

  it("treats reconciliation same-state as a no-op edge", () => {
    expect(canTransitionTask("needs_reconciliation", "needs_reconciliation")).toBe(true)
  })
  it("fails a stale task when its linked step already failed", () => {
    expect(
      decideStaleRecovery({
        taskState: "dispatching",
        stepState: "failed",
        retryCount: 0,
        maxAttempts: 3,
        allStepsComplete: false,
      }),
    ).toEqual({ nextState: "failed", reason: "step_failed" })
  })

  it("times out a stale task when its linked step already timed out", () => {
    expect(
      decideStaleRecovery({
        taskState: "running",
        stepState: "timed_out",
        retryCount: 0,
        maxAttempts: 3,
        allStepsComplete: false,
      }),
    ).toEqual({ nextState: "timed_out", reason: "step_timed_out" })
  })

  it("completes cancellation only from cancel_requested and never retries a cancelled step", () => {
    expect(
      decideStaleRecovery({
        taskState: "cancel_requested",
        stepState: "cancelled",
        retryCount: 0,
        maxAttempts: 3,
        allStepsComplete: false,
      }),
    ).toEqual({ nextState: "cancelled", reason: "cancel_requested" })
    expect(
      decideStaleRecovery({
        taskState: "dispatching",
        stepState: "cancelled",
        retryCount: 0,
        maxAttempts: 3,
        allStepsComplete: false,
      }),
    ).toEqual({ nextState: "failed", reason: "step_cancelled" })
  })

  it("finishes a complete successful run and retries an incomplete successful run", () => {
    expect(
      decideStaleRecovery({
        taskState: "running",
        stepState: "succeeded",
        retryCount: 0,
        maxAttempts: 3,
        allStepsComplete: true,
      }),
    ).toEqual({ nextState: "succeeded", reason: "step_succeeded" })
    expect(
      decideStaleRecovery({
        taskState: "running",
        stepState: "succeeded",
        retryCount: 0,
        maxAttempts: 3,
        allStepsComplete: false,
      }),
    ).toEqual({ nextState: "retry_waiting", reason: "lease_expired" })
  })

  it("keeps an unfinished stale step retryable until attempt exhaustion", () => {
    expect(
      decideStaleRecovery({
        taskState: "dispatching",
        stepState: "claimed",
        retryCount: 0,
        maxAttempts: 3,
        allStepsComplete: false,
      }),
    ).toEqual({ nextState: "retry_waiting", reason: "lease_expired" })
    expect(
      decideStaleRecovery({
        taskState: "dispatching",
        stepState: "claimed",
        retryCount: 2,
        maxAttempts: 3,
        allStepsComplete: false,
      }),
    ).toEqual({ nextState: "failed", reason: "lease_expired" })
  })
  it("covers cancellation, dispatch, running, and terminal edges", () => {
    expect(transitionTask("queued", "cancelled")).toBe("cancelled")
    expect(transitionTask("queued", "dispatching")).toBe("dispatching")
    expect(transitionTask("dispatching", "running")).toBe("running")
    expect(transitionTask("dispatching", "retry_waiting")).toBe("retry_waiting")
    expect(transitionTask("dispatching", "failed")).toBe("failed")
    expect(transitionTask("dispatching", "cancel_requested")).toBe("cancel_requested")
    expect(transitionTask("running", "succeeded")).toBe("succeeded")
    expect(transitionTask("running", "retry_waiting")).toBe("retry_waiting")
    expect(transitionTask("running", "failed")).toBe("failed")
    expect(transitionTask("running", "cancel_requested")).toBe("cancel_requested")
    expect(transitionTask("cancel_requested", "cancelled")).toBe("cancelled")
    expect(transitionTask("cancel_requested", "failed")).toBe("failed")
    expect(transitionTask("dispatching", "timed_out")).toBe("timed_out")
    expect(transitionTask("running", "timed_out")).toBe("timed_out")
  })

  it("rejects success after cancellation is requested", () => {
    expect(() => transitionTask("cancel_requested", "succeeded")).toThrow()
  })

  it("requires explicit evidence for exceptional task transitions", () => {
    expect(
      canTransitionTask("dispatching", "needs_reconciliation", {
        reason: "ambiguous_provider",
      }),
    ).toBe(true)
    expect(canTransitionTask("dispatching", "needs_reconciliation")).toBe(false)
    expect(canTransitionTask("queued", "failed")).toBe(false)
    expect(canTransitionTask("queued", "failed", { reason: "invalid_persisted_validation" })).toBe(
      true,
    )
    expect(canTransitionTask("cancel_requested", "succeeded")).toBe(false)
    expect(
      canTransitionTask("cancel_requested", "succeeded", {
        reason: "provider_success",
        allStepsComplete: true,
      }),
    ).toBe(true)
    expect(
      canTransitionTask("cancel_requested", "succeeded", {
        reason: "provider_success",
        allStepsComplete: false,
      }),
    ).toBe(false)
  })

  it("parses persisted step states independently from task states", () => {
    expect(parsePersistedStepState("pending")).toBe("pending")
    expect(parsePersistedStepState("skipped")).toBe("skipped")
    expect(() => parsePersistedStepState("retry_waiting")).toThrow()
    expect(() => parsePersistedStepState("corrupt")).toThrow()
  })

  it("recovers expired leases only while attempts remain", () => {
    expect(recoverExpiredLease("running", 1, 3)).toBe("retry_waiting")
    expect(recoverExpiredLease("dispatching", 3, 3)).toBe("failed")
    expect(recoverExpiredLease("cancel_requested", 1, 3)).toBe("needs_reconciliation")
  })
})

describe("bounded execution policy", () => {
  it("uses the configured floor, exponential backoff and bounded deterministic jitter", () => {
    const policy = createRetryPolicy({ baseBackoffMs: 1_000, maxBackoffMs: 5_000, jitterMs: 500 })
    expect(retryDeadline(10_000, 1, 2_000, policy, () => 0)).toBe(12_000)
    expect(retryDeadline(10_000, 2, 0, policy, () => 0.5)).toBe(12_250)
    expect(retryDeadline(10_000, 10, 0, policy, () => 1)).toBe(15_000)
    expect(retryDeadline(10_000, 1, 120_000, policy, () => 1)).toBe(130_000)
  })
  it("clamps policy values and keeps jitter deterministic and bounded", () => {
    const policy = createRetryPolicy({
      maxAttempts: 100,
      baseBackoffMs: -1,
      maxBackoffMs: 120_000,
      jitterMs: 100_000,
    })
    expect(policy.maxAttempts).toBe(EXECUTION_LIMITS.maxAttempts.maximum)
    expect(policy.baseBackoffMs).toBe(0)
    expect(policy.jitterMs).toBe(EXECUTION_LIMITS.jitterMs.maximum)
    const boundedPolicy = createRetryPolicy({
      baseBackoffMs: 30_000,
      maxBackoffMs: EXECUTION_LIMITS.maxBackoffMs.maximum,
      jitterMs: EXECUTION_LIMITS.jitterMs.maximum,
    })
    expect(retryDelayMs(99, boundedPolicy, () => 1)).toBe(EXECUTION_LIMITS.maxBackoffMs.maximum)
    expect(EXECUTION_TIMEOUTS.cancelMs).toBeLessThanOrEqual(
      EXECUTION_LIMITS.cancelTimeoutMs.maximum,
    )
    expect(LEASE_DEFAULTS.heartbeatMs).toBeLessThan(LEASE_DEFAULTS.staleAfterMs)
  })
})

describe("redaction and adapter error mapping", () => {
  it("redacts nested credential fields while retaining type and length metadata", () => {
    const output = redactSecrets({
      nested: [{ provider: { password: "placeholder" } }],
      ordinary: "safe-value",
    })
    expect(output).toEqual({
      type: "object",
      value: {
        nested: {
          type: "array",
          value: [
            {
              type: "object",
              value: {
                provider: {
                  type: "object",
                  value: { password: { type: "string", length: 11, redacted: true } },
                },
              },
            },
          ],
        },
        ordinary: { type: "string", length: 10, redacted: false, value: "safe-value" },
      },
    })
  })

  it("maps adapter error codes without exposing provider exceptions", () => {
    const mapped = mapUnknownAdapterError(
      new DeviceAdapterError({ code: DeviceErrorCode.Timeout, message: "adapter timeout" }),
    )
    expect(mapped).toEqual({ code: "timeout", message: "adapter timeout", retryable: true })
  })
})
