import { createUnconfiguredDeviceAdapter, type DeviceAdapter } from "@tk-mg/device-adapter"
import { createPostgresWorkerRepository } from "@tk-mg/task-execution"
import postgres from "postgres"
import { createTaskExecutor } from "./executor"
import { createWorkerRuntime, parseWorkerRuntimeConfig } from "./runtime"

type HealthWriter = (path: string, contents: string) => Promise<void>
type ProcessTerminator = (code: number) => void | Promise<void>
type WorkerStartupDependencies = {
  readonly createRepository?: typeof createPostgresWorkerRepository
  readonly adapter?: DeviceAdapter
  readonly installSignals?: boolean
}

const writeHealth: HealthWriter = async (path, contents) => {
  await Bun.write(path, contents)
}

export const createWorkerFatalFailureHandler =
  (
    healthFile: string,
    write: HealthWriter = writeHealth,
    terminate: ProcessTerminator = (code) => process.exit(code),
  ): ((error: unknown) => Promise<void>) =>
  async (error) => {
    console.error("Worker cycle failed", error)
    try {
      await write(healthFile, "failed\n")
    } finally {
      await terminate(1)
    }
  }

export const startWorker = async (
  environment: Record<string, string | undefined>,
  write: HealthWriter = writeHealth,
  dependencies: WorkerStartupDependencies = {},
) => {
  const config = parseWorkerRuntimeConfig(environment)
  const healthFile = config.healthFile ?? "/tmp/tk-mg-worker-ready"
  await write(healthFile, "starting\n")
  const client = postgres(config.databaseUrl, { max: config.concurrency })
  const adapter = dependencies.adapter ?? createUnconfiguredDeviceAdapter()
  try {
    const repository = (dependencies.createRepository ?? createPostgresWorkerRepository)(client, {
      outboxLeaseMs: config.leaseMs,
      minimumRetryDelayMs: config.retryDelayMs,
      getResult: (commandId) => adapter.getResult(commandId),
      systemActor: {
        actorId: config.systemActorId,
        actorType: "system",
        requestId: config.workerId,
      },
    })
    await repository.checkReadiness()
    const runtime = createWorkerRuntime({
      repository,
      config,
      executor: createTaskExecutor({ repository, adapter, config }),
      onFailure: (error) => console.error("Worker message failed", error),
      onFatalFailure: createWorkerFatalFailureHandler(healthFile, write, async (code) => {
        try {
          await client.end({ timeout: Math.ceil(config.leaseMs / 1000) })
        } finally {
          process.exit(code)
        }
      }),
      onStarted: async () => {
        await write(healthFile, "ready\n")
        if (runtime.status() === "stopped") await write(healthFile, "stopped\n")
      },
    })
    const worker = {
      runtime,
      close: async () => {
        await runtime.stop()
        await client.end({ timeout: Math.ceil(config.leaseMs / 1000) })
      },
    }
    if (dependencies.installSignals) installWorkerSignals(worker, healthFile)
    await runtime.start()
    return worker
  } catch (error: unknown) {
    try {
      await write(healthFile, "failed\n")
    } finally {
      await client.end()
    }
    throw error
  }
}

export const installWorkerSignals = (
  worker: Awaited<ReturnType<typeof startWorker>>,
  healthFile: string,
): void => {
  let isClosing = false
  const shutdown = (): void => {
    if (isClosing) return
    isClosing = true
    void (async () => {
      const closing = worker.close()
      await Bun.write(healthFile, "stopped\n")
      await closing
    })().catch((error: unknown) => {
      console.error("Worker shutdown failed", error)
      process.exitCode = 1
    })
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

if (import.meta.main) {
  await startWorker(Bun.env, undefined, { installSignals: true })
}
