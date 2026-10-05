// biome-ignore-all lint/complexity/useLiteralKeys: outbox payload values are index-signature typed.
import {
  type DeviceAdapter,
  DeviceCommandIdSchema,
  type DeviceCommandResult,
  type DeviceHealth,
  DeviceIdSchema,
  DeviceInstanceIdSchema,
} from "@tk-mg/device-adapter"
import type { OutboxMessage } from "@tk-mg/task-execution"
import {
  EXECUTION_TIMEOUTS,
  isConfirmedProviderResult,
  retryDeadline,
  type TaskClaim,
  type TaskStepRecord,
} from "@tk-mg/task-execution"
import { HeartbeatFailureError, OwnershipLostError } from "./ownership"
import {
  classifyOutboxMessage,
  type WorkerExecutionRepository,
  type WorkerRuntimeConfig,
} from "./runtime"

type ExecutorOptions = {
  readonly repository: WorkerExecutionRepository
  readonly adapter: DeviceAdapter
  readonly config: WorkerRuntimeConfig
  readonly clock?: () => number
  readonly sleep?: (milliseconds: number) => Promise<void>
  readonly random?: () => number
  readonly scheduleHeartbeat?: (tick: () => void, milliseconds: number) => () => void
  readonly timeouts?: {
    readonly submitMs: number
    readonly cancelMs: number
    readonly pollMs?: number
  }
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

class ExecutionTimeoutError extends Error {
  override readonly name = "ExecutionTimeoutError"
}

const withTimeout = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  milliseconds: number,
  parentSignal: AbortSignal,
): Promise<T> => {
  const controller = new AbortController()
  const onAbort = (): void => {
    controller.abort()
    rejectTimeout?.(new DOMException("Aborted", "AbortError"))
  }
  parentSignal.addEventListener("abort", onAbort, { once: true })
  let rejectTimeout: ((reason: unknown) => void) | undefined
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    rejectTimeout = reject
  })
  const timeout = setTimeout(() => {
    controller.abort()
    rejectTimeout?.(new ExecutionTimeoutError())
  }, milliseconds)
  try {
    if (parentSignal.aborted) throw new DOMException("Aborted", "AbortError")
    return await Promise.race([operation(controller.signal), timeoutPromise])
  } finally {
    clearTimeout(timeout)
    parentSignal.removeEventListener("abort", onAbort)
  }
}

const healthError = (health: DeviceHealth): { readonly code: string; readonly message: string } => {
  if (health.status === "available") return { code: "unknown", message: "" }
  return health.error
}

const pollResult = async (
  adapter: DeviceAdapter,
  commandId: TaskStepRecord["command"]["commandId"],
  timeoutMs: number,
  pollMs: number,
  signal: AbortSignal,
  sleep: (milliseconds: number) => Promise<void>,
  clock: () => number,
  shouldStop: () => Promise<boolean>,
): Promise<DeviceCommandResult> => {
  const deadline = clock() + timeoutMs
  while (true) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError")
    const result = await withTimeout(
      () => adapter.getResult(commandId),
      Math.max(1, Math.min(pollMs, deadline - clock())),
      signal,
    )
    if (result.status !== "queued" && result.status !== "running") return result
    if (await shouldStop()) return result
    if (clock() >= deadline) {
      throw new ExecutionTimeoutError()
    }
    await withTimeout(
      () => sleep(Math.min(100, Math.max(1, deadline - clock()))),
      Math.max(1, deadline - clock()),
      signal,
    )
  }
}

const finishCancelled = async (
  repository: WorkerExecutionRepository,
  claim: TaskClaim,
  owner: string,
  step: TaskStepRecord | null,
  now: number,
  result?: DeviceCommandResult,
): Promise<void> => {
  if (step !== null) {
    const finished = await repository.finishStep(
      claim.taskId,
      claim.runId,
      owner,
      claim.claimToken,
      step.stepId,
      "cancelled",
      result,
      "cancelled",
      "Task cancellation requested",
      now,
    )
    if (!finished) return
  }
  await repository.finishOwned(
    claim.taskId,
    claim.runId,
    claim.claimToken,
    claim.state,
    "cancelled",
    now,
  )
}

export const createTaskExecutor =
  ({
    repository,
    adapter,
    config,
    clock = Date.now,
    sleep = defaultSleep,
    random = Math.random,
    scheduleHeartbeat = (tick, milliseconds) => {
      const timer = setInterval(tick, milliseconds)
      return () => clearInterval(timer)
    },
    timeouts = EXECUTION_TIMEOUTS,
  }: ExecutorOptions) =>
  async (message: OutboxMessage, signal: AbortSignal): Promise<void> => {
    if (signal.aborted) return
    if (classifyOutboxMessage(message) !== "execute") return
    const taskId = message.payload["taskId"]
    if (typeof taskId !== "string") throw new Error("execution outbox payload has no taskId")
    const claim = await repository.claimTask(config.workerId, clock(), config.leaseMs, taskId)
    if (claim === null) return
    if (signal.aborted) return
    const scheduleRetry = async (): Promise<void> => {
      const now = clock()
      await repository.finishOwned(
        claim.taskId,
        claim.runId,
        claim.claimToken,
        claim.state,
        "retry_waiting",
        now,
        retryDeadline(now, claim.attempt + 1, config.retryDelayMs, undefined, random),
      )
    }
    const target = {
      deviceId: DeviceIdSchema.parse(claim.target.deviceId),
      ...(claim.target.instanceId === undefined
        ? {}
        : { instanceId: DeviceInstanceIdSchema.parse(claim.target.instanceId) }),
    }
    const leaseId = crypto.randomUUID()
    const leaseToken = crypto.randomUUID()
    const leased = await repository.acquireDeviceLease({
      leaseId,
      taskId: claim.taskId,
      groupId: claim.groupId,
      deviceId: target.deviceId,
      ...(target.instanceId === undefined ? {} : { instanceId: target.instanceId }),
      leaseToken,
      workerId: config.workerId,
      expiresAt: clock() + config.leaseMs,
    })
    if (signal.aborted) return
    if (!leased) {
      await scheduleRetry()
      return
    }
    const operation = new AbortController()
    const abortOperation = (): void => operation.abort()
    signal.addEventListener("abort", abortOperation, { once: true })
    if (signal.aborted) operation.abort()
    let lost = false
    let renewalFailure: unknown
    let renewal: Promise<void> | undefined
    const ensureOwned = async (): Promise<void> => {
      if (lost)
        throw renewalFailure === undefined
          ? new OwnershipLostError()
          : new HeartbeatFailureError(renewalFailure)
      if (operation.signal.aborted) throw new DOMException("Aborted", "AbortError")
      await renewal
      if (lost)
        throw renewalFailure === undefined
          ? new OwnershipLostError()
          : new HeartbeatFailureError(renewalFailure)
      if (operation.signal.aborted) throw new DOMException("Aborted", "AbortError")
    }
    const stopHeartbeat = scheduleHeartbeat(() => {
      if (renewal !== undefined || operation.signal.aborted) return
      renewal = (async () => {
        const now = clock()
        if (
          !(await withTimeout(
            () =>
              repository.renewTask(
                claim.taskId,
                claim.runId,
                claim.claimToken,
                now,
                config.leaseMs,
              ),
            config.leaseMs,
            operation.signal,
          ))
        )
          throw new OwnershipLostError()
        if (
          !(await withTimeout(
            () =>
              repository.renewDeviceLease(leaseId, leaseToken, clock() + config.leaseMs, clock()),
            config.leaseMs,
            operation.signal,
          ))
        )
          throw new OwnershipLostError()
      })()
        .catch((error: unknown) => {
          if (!signal.aborted) {
            lost = true
            operation.abort()
            if (!(error instanceof OwnershipLostError)) renewalFailure = error
          }
        })
        .finally(() => {
          renewal = undefined
        })
    }, config.heartbeatMs)
    try {
      const health = await withTimeout(
        () => adapter.health(target),
        EXECUTION_TIMEOUTS.healthMs,
        operation.signal,
      )
      await ensureOwned()
      if (health.status !== "available") {
        const error = healthError(health)
        if (error.code === "unconfigured")
          await repository.finishOwned(
            claim.taskId,
            claim.runId,
            claim.claimToken,
            claim.state,
            "failed",
            clock(),
          )
        else await scheduleRetry()
        return
      }
      let currentClaim = claim
      while (true) {
        await ensureOwned()
        const owned = await repository.getOwnedTask(
          currentClaim.taskId,
          currentClaim.runId,
          config.workerId,
          currentClaim.claimToken,
        )
        await ensureOwned()
        if (owned === null) return
        currentClaim = owned
        if (currentClaim.state === "cancel_requested") {
          if (
            currentClaim.steps.every(
              (item) => item.state === "succeeded" || item.state === "skipped",
            )
          ) {
            await repository.finishOwned(
              currentClaim.taskId,
              currentClaim.runId,
              currentClaim.claimToken,
              currentClaim.state,
              "succeeded",
              clock(),
            )
            return
          }
          await finishCancelled(repository, currentClaim, config.workerId, null, clock())
          return
        }
        const step = await repository.claimNext(
          currentClaim.taskId,
          currentClaim.runId,
          config.workerId,
          currentClaim.claimToken,
          clock(),
        )
        await ensureOwned()
        if (step === null) {
          await repository.finishOwned(
            currentClaim.taskId,
            currentClaim.runId,
            currentClaim.claimToken,
            currentClaim.state,
            "succeeded",
            clock(),
          )
          return
        }
        currentClaim = { ...currentClaim, state: "running" }
        const command = {
          ...step.command,
          commandId: DeviceCommandIdSchema.parse(step.command.commandId),
        }
        const boundary = {
          taskId: currentClaim.taskId,
          runId: currentClaim.runId,
          claimToken: currentClaim.claimToken,
          stepId: step.stepId,
          owner: config.workerId,
          leaseId,
          leaseToken,
          now: clock(),
        }
        if (!(await repository.markSubmitStarted(boundary))) return
        await ensureOwned()
        let result: DeviceCommandResult
        try {
          await withTimeout(() => adapter.submit(command), timeouts.submitMs, operation.signal)
          result = await pollResult(
            adapter,
            command.commandId,
            command.timeoutMs,
            timeouts.pollMs ?? EXECUTION_TIMEOUTS.pollMs,
            operation.signal,
            sleep,
            clock,
            async () => {
              const ownedDuringPoll = await repository.getOwnedTask(
                currentClaim.taskId,
                currentClaim.runId,
                config.workerId,
                currentClaim.claimToken,
              )
              return ownedDuringPoll === null || ownedDuringPoll.state === "cancel_requested"
            },
          )
        } catch {
          if (lost) await ensureOwned()
          const confirmed = await withTimeout(
            () => adapter.getResult(command.commandId),
            timeouts.cancelMs,
            operation.signal,
          ).catch(() => null)
          if (
            confirmed === null ||
            confirmed.commandId !== command.commandId ||
            (confirmed.status !== "succeeded" && confirmed.status !== "cancelled")
          ) {
            await repository.quarantineOwned({ ...boundary, now: clock() })
            return
          }
          result = confirmed
        }
        await ensureOwned()
        if (result.commandId !== command.commandId) {
          await repository.quarantineOwned({ ...boundary, now: clock() })
          return
        }
        const ownedAfterResult = await repository.getOwnedTask(
          currentClaim.taskId,
          currentClaim.runId,
          config.workerId,
          currentClaim.claimToken,
        )
        await ensureOwned()
        if (ownedAfterResult === null) return
        if (
          ownedAfterResult.state === "cancel_requested" &&
          (result.status === "queued" || result.status === "running")
        ) {
          try {
            await withTimeout(
              () => adapter.cancel(command.commandId),
              timeouts.cancelMs,
              operation.signal,
            )
            result = await withTimeout(
              () => adapter.getResult(command.commandId),
              timeouts.cancelMs,
              operation.signal,
            )
          } catch (error) {
            if (!(error instanceof Error)) throw error
            if (lost) await ensureOwned()
            await repository.quarantineOwned({ ...boundary, now: clock() })
            return
          }
          await ensureOwned()
          if (result.commandId !== command.commandId) {
            await repository.quarantineOwned({ ...boundary, now: clock() })
            return
          }
        }
        currentClaim = ownedAfterResult
        if (result.status === "succeeded") {
          const finished = await repository.finishStep(
            currentClaim.taskId,
            currentClaim.runId,
            config.workerId,
            currentClaim.claimToken,
            step.stepId,
            "succeeded",
            result,
            undefined,
            undefined,
            clock(),
          )
          if (finished) continue
          return
        }
        const mapped =
          result.status === "failed" || result.status === "timed_out" ? result.error : undefined
        if (result.status === "cancelled") {
          await finishCancelled(repository, currentClaim, config.workerId, step, clock(), result)
          return
        }
        if (!isConfirmedProviderResult(result)) {
          await repository.quarantineOwned({ ...boundary, now: clock() })
          return
        }
        const terminalStatus = result.status === "timed_out" ? "timed_out" : "failed"
        const finished = await repository.finishStep(
          currentClaim.taskId,
          currentClaim.runId,
          config.workerId,
          currentClaim.claimToken,
          step.stepId,
          terminalStatus,
          result,
          mapped?.code,
          mapped?.message,
          clock(),
        )
        if (!finished) return
        await repository.finishOwned(
          currentClaim.taskId,
          currentClaim.runId,
          currentClaim.claimToken,
          currentClaim.state,
          result.status === "timed_out" && currentClaim.state !== "cancel_requested"
            ? "timed_out"
            : "failed",
          clock(),
        )
        return
      }
    } catch (error: unknown) {
      if (lost) await ensureOwned()
      throw error
    } finally {
      stopHeartbeat()
      try {
        await renewal
        if (lost) await ensureOwned()
        await repository.releaseDeviceLease(
          leaseId,
          leaseToken,
          signal.aborted ? "worker_stopped" : "finished",
        )
      } finally {
        signal.removeEventListener("abort", abortOperation)
      }
    }
  }
