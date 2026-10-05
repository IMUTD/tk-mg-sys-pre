// biome-ignore-all lint/complexity/useLiteralKeys: Bun.env is index-signature typed.
import { appendFile } from "node:fs/promises"
import {
  createInMemoryDeviceAdapter,
  DeviceCommandIdSchema,
  DeviceIdSchema,
  IdempotencyKeySchema,
} from "@tk-mg/device-adapter"
import { createPostgresWorkerRepository } from "@tk-mg/task-execution"
import { startWorker } from "../main"

const path = Bun.env["TK_MG_WORKER_EVENT_FILE"]
if (path === undefined) throw new Error("Worker event path is required")
const record = async (event: string): Promise<void> => {
  await appendFile(path, `${event}\n`)
}
const commandId = DeviceCommandIdSchema.parse("00000000-0000-4000-8000-000000000001")
const target = { deviceId: DeviceIdSchema.parse("device-1") }
const step = {
  stepId: "step-1",
  taskId: "task-1",
  ordinal: 0,
  command: {
    commandId,
    idempotencyKey: IdempotencyKeySchema.parse("step-1"),
    target,
    timeoutMs: 300_000,
    type: "tap" as const,
    x: 1,
    y: 1,
  },
  state: "claimed" as const,
  attempt: 1,
}
const claim = {
  taskId: "task-1",
  groupId: "group-1",
  target,
  state: "dispatching" as const,
  attempt: 1,
  maxAttempts: 3,
  steps: [step],
  actor: { actorId: "actor-1", actorType: "system" as const, requestId: "test" },
  createdAt: 0,
  updatedAt: 0,
  runId: "run-1",
  claimToken: "claim-1",
  leaseExpiresAt: 300_000,
}
let delivered = false
const adapter = createInMemoryDeviceAdapter()
void Bun.stdin.text().then(() => {
  process.emit("SIGTERM")
  process.emit("SIGTERM")
})
await startWorker(Bun.env, undefined, {
  installSignals: true,
  adapter: {
    ...adapter,
    submit: async (input) => {
      await record("submit")
      return adapter.submit(input)
    },
    getResult: async () => {
      await record("poll")
      return new Promise(() => undefined)
    },
  },
  createRepository: (db, options) => ({
    ...createPostgresWorkerRepository(db, options),
    recoverStale: async () => [],
    claimAvailable: async () => {
      if (delivered) return []
      delivered = true
      return [
        {
          outboxId: "outbox-1",
          aggregateId: "task-1",
          eventType: "execution_task.queued",
          payload: { taskId: "task-1" },
          availableAt: 0,
        },
      ]
    },
    acknowledge: async () => {
      await record("ack")
    },
    fail: async () => {
      await record("fail")
    },
    claimTask: async () => claim,
    acquireDeviceLease: async () => true,
    renewTask: async () => {
      await record("renew-task")
      if (Bun.env["TK_MG_WORKER_INJECT_RENEW_FAILURE"] === "true")
        throw new Error("Injected SQL renewal failure")
      return true
    },
    renewDeviceLease: async () => {
      await record("renew-device")
      return true
    },
    releaseDeviceLease: async () => {
      await record("release")
      return false
    },
    getOwnedTask: async () => claim,
    claimNext: async () => step,
    markSubmitStarted: async () => {
      await record("marker")
      return true
    },
    quarantineOwned: async () => {
      await record("quarantine")
      return true
    },
  }),
})
