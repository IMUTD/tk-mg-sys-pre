import {
  isTaskState,
  type OutboxMessage,
  type WorkerRepository as PersistedWorkerRepository,
} from "@tk-mg/task-execution"
import { z } from "zod"
import { HeartbeatFailureError, OwnershipLostError } from "./ownership"

const WorkerRuntimeConfigurationSchema = z.object({
  DATABASE_URL: z.string().url(),
  TK_MG_SYSTEM_ACTOR_ID: z.string().uuid(),
  TK_MG_WORKER_ID: z.string().min(1),
  TK_MG_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(4),
  TK_MG_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(50).max(60_000).default(1_000),
  TK_MG_WORKER_OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  TK_MG_WORKER_RECOVERY_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  TK_MG_WORKER_LEASE_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  TK_MG_WORKER_HEARTBEAT_MS: z.coerce.number().int().min(250).max(60_000).default(10_000),
  TK_MG_WORKER_RETRY_DELAY_MS: z.coerce.number().int().min(0).max(120_000).default(1_000),
  TK_MG_WORKER_HEALTH_FILE: z.string().min(1).default("/tmp/tk-mg-worker-ready"),
})

export type WorkerRuntimeConfig = {
  readonly databaseUrl: string
  readonly systemActorId: string
  readonly workerId: string
  readonly concurrency: number
  readonly pollIntervalMs: number
  readonly outboxBatchSize: number
  readonly recoveryBatchSize: number
  readonly leaseMs: number
  readonly heartbeatMs: number
  readonly retryDelayMs: number
  readonly healthFile?: string
}

export const parseWorkerRuntimeConfig = (
  environment: Record<string, string | undefined>,
): WorkerRuntimeConfig => {
  const config = WorkerRuntimeConfigurationSchema.parse(environment)
  if (config.TK_MG_WORKER_HEARTBEAT_MS >= config.TK_MG_WORKER_LEASE_MS) {
    throw new Error("TK_MG_WORKER_HEARTBEAT_MS must be less than TK_MG_WORKER_LEASE_MS")
  }
  return {
    databaseUrl: config.DATABASE_URL,
    systemActorId: config.TK_MG_SYSTEM_ACTOR_ID,
    workerId: config.TK_MG_WORKER_ID,
    concurrency: config.TK_MG_WORKER_CONCURRENCY,
    pollIntervalMs: config.TK_MG_WORKER_POLL_INTERVAL_MS,
    outboxBatchSize: config.TK_MG_WORKER_OUTBOX_BATCH_SIZE,
    recoveryBatchSize: config.TK_MG_WORKER_RECOVERY_BATCH_SIZE,
    leaseMs: config.TK_MG_WORKER_LEASE_MS,
    heartbeatMs: config.TK_MG_WORKER_HEARTBEAT_MS,
    retryDelayMs: config.TK_MG_WORKER_RETRY_DELAY_MS,
    healthFile: config.TK_MG_WORKER_HEALTH_FILE,
  }
}

export type WorkerRepository = Pick<
  PersistedWorkerRepository,
  "claimAvailable" | "acknowledge" | "fail" | "recoverStale"
>

export type WorkerExecutionRepository = Omit<PersistedWorkerRepository, "checkReadiness">
export type WorkerExecutor = (message: OutboxMessage, signal: AbortSignal) => Promise<void>
export type WorkerStatus = "starting" | "ready" | "failed" | "stopped"

export const classifyOutboxMessage = (
  message: OutboxMessage,
): "execute" | "notification" | "unknown" => {
  switch (message.eventType) {
    case "execution_task.queued":
      return "execute"
    case "execution_task.status_changed": {
      // biome-ignore lint/complexity/useLiteralKeys: payload is index-signature typed.
      const status = message.payload["toStatus"]
      if (typeof status !== "string" || !isTaskState(status)) return "unknown"
      switch (status) {
        case "retry_waiting":
          return "execute"
        case "queued":
        case "dispatching":
        case "running":
        case "cancel_requested":
        case "succeeded":
        case "failed":
        case "cancelled":
        case "timed_out":
        case "needs_reconciliation":
          return "notification"
        default: {
          const exhaustive: never = status
          return exhaustive
        }
      }
    }
    default:
      return "unknown"
  }
}

type WorkerRuntimeOptions = {
  readonly repository: WorkerRepository
  readonly config: WorkerRuntimeConfig
  readonly executor: WorkerExecutor
  readonly clock?: () => number
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  readonly onFailure?: (error: unknown) => void
  readonly onFatalFailure?: (error: unknown) => void | Promise<void>
  readonly onStarted?: () => Promise<void>
  readonly onStatusChange?: (status: WorkerStatus) => void
}

type WorkerRuntime = {
  readonly runCycle: () => Promise<void>
  readonly start: () => Promise<void>
  readonly stop: () => Promise<void>
  readonly status: () => WorkerStatus
}

const defaultSleep = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const stop = (): void => {
      clearTimeout(timer)
      signal.removeEventListener("abort", stop)
      resolve()
    }
    const timer = setTimeout(stop, milliseconds)
    if (signal.aborted) stop()
    else signal.addEventListener("abort", stop, { once: true })
  })

export const createWorkerRuntime = ({
  repository,
  config,
  executor,
  clock = Date.now,
  sleep = defaultSleep,
  onFailure,
  onFatalFailure,
  onStarted,
  onStatusChange,
}: WorkerRuntimeOptions): WorkerRuntime => {
  let currentStatus: WorkerStatus = "starting"
  let stopped = false
  let activeCycle: Promise<void> | undefined
  let loop: Promise<void> | undefined
  let stopPromise: Promise<void> | undefined
  const abortController = new AbortController()

  const setStatus = (status: WorkerStatus): void => {
    currentStatus = status
    onStatusChange?.(status)
  }

  const processMessage = async (message: OutboxMessage): Promise<void> => {
    try {
      switch (classifyOutboxMessage(message)) {
        case "execute":
          await executor(message, abortController.signal)
          break
        case "notification":
          break
        case "unknown":
          throw new Error("Unknown execution outbox event type")
      }
      if (abortController.signal.aborted) return
      await repository.acknowledge({
        outboxId: message.outboxId,
        owner: config.workerId,
        claimAttempt: message.claimAttempt ?? 0,
        now: clock(),
      })
    } catch (error: unknown) {
      if (error instanceof HeartbeatFailureError && !abortController.signal.aborted) throw error
      if (abortController.signal.aborted || error instanceof OwnershipLostError) return
      onFailure?.(error)
      const now = clock()
      await repository.fail(
        {
          outboxId: message.outboxId,
          owner: config.workerId,
          claimAttempt: message.claimAttempt ?? 0,
          now,
        },
        now + config.retryDelayMs,
      )
    }
  }

  const executeCycle = async (): Promise<void> => {
    if (stopped) return
    const now = clock()
    await repository.recoverStale(now, config.recoveryBatchSize)
    if (stopped) return
    const messages = await repository.claimAvailable(config.workerId, now, config.outboxBatchSize)
    for (let offset = 0; offset < messages.length; offset += config.concurrency) {
      if (stopped) return
      const batch = messages.slice(offset, offset + config.concurrency)
      await Promise.all(batch.map((message) => processMessage(message)))
    }
    if (!stopped) setStatus("ready")
  }

  const runCycle = async (): Promise<void> => {
    try {
      await executeCycle()
    } catch (error: unknown) {
      if (stopped) return
      setStatus("failed")
      await onFatalFailure?.(error)
      throw error
    }
  }

  const runLoop = async (): Promise<void> => {
    while (!stopped) {
      try {
        activeCycle = runCycle()
        await activeCycle
      } finally {
        activeCycle = undefined
      }
      if (!stopped) {
        await Promise.race([
          sleep(config.pollIntervalMs, abortController.signal),
          new Promise<void>((resolve) => {
            if (abortController.signal.aborted) resolve()
            else abortController.signal.addEventListener("abort", () => resolve(), { once: true })
          }),
        ])
      }
    }
  }

  return {
    runCycle,
    start: async () => {
      if (stopped || loop !== undefined) return
      await runCycle()
      if (stopped) return
      await onStarted?.()
      if (stopped) return
      loop = runLoop()
      void loop.catch(() => undefined)
    },
    stop: async () => {
      if (stopPromise !== undefined) return stopPromise
      stopped = true
      abortController.abort()
      stopPromise = (async () => {
        let timeout: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            activeCycle ?? Promise.resolve(),
            new Promise<void>((resolve) => {
              timeout = setTimeout(resolve, config.leaseMs)
            }),
          ])
        } finally {
          if (timeout !== undefined) clearTimeout(timeout)
          setStatus("stopped")
        }
      })()
      return stopPromise
    },
    status: () => currentStatus,
  }
}
