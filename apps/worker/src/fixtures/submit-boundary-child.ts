import { createInMemoryDeviceAdapter } from "@tk-mg/device-adapter"
import { createPostgresWorkerRepository } from "@tk-mg/task-execution"
import postgres from "postgres"
import { z } from "zod"
import { createTaskExecutor } from "../executor"

const input = z
  .object({
    TEST_DATABASE_URL: z.string(),
    QA_TASK_ID: z.uuid(),
    QA_ACTOR_ID: z.uuid(),
    QA_MODE: z.enum(["before-marker", "after-marker", "accepted", "resume"]),
    QA_NOW: z.coerce.number().optional(),
  })
  .parse(Bun.env)
if (!new URL(input.TEST_DATABASE_URL).pathname.slice(1).startsWith("tk_mg_test_"))
  throw new Error("Disposable database required")
const db = postgres(input.TEST_DATABASE_URL, { max: 2 })
const repository = createPostgresWorkerRepository(db, {
  systemActor: {
    actorId: input.QA_ACTOR_ID,
    actorType: "system",
    requestId: "boundary-child",
  },
})
const adapter = createInMemoryDeviceAdapter({ autoComplete: true })
const checkpoint = async (name: string): Promise<never> => {
  process.stdout.write(`${name}\n`)
  setInterval(() => undefined, 1000)
  return new Promise<never>(() => undefined)
}
try {
  await createTaskExecutor({
    repository: {
      ...repository,
      markSubmitStarted: async (boundary) => {
        if (input.QA_MODE === "before-marker") await checkpoint("before-marker")
        const marked = await repository.markSubmitStarted(boundary)
        if (marked && input.QA_MODE === "after-marker") await checkpoint("after-marker")
        return marked
      },
    },
    adapter: {
      ...adapter,
      submit: async (command) => {
        const receipt = await adapter.submit(command)
        if (input.QA_MODE === "accepted") await checkpoint("accepted")
        process.stdout.write("submit\n")
        return receipt
      },
    },
    config: {
      databaseUrl: input.TEST_DATABASE_URL,
      systemActorId: input.QA_ACTOR_ID,
      workerId: "boundary-child",
      concurrency: 1,
      pollIntervalMs: 1000,
      outboxBatchSize: 1,
      recoveryBatchSize: 10,
      leaseMs: 30000,
      heartbeatMs: 10000,
      retryDelayMs: 0,
    },
    clock: input.QA_NOW === undefined ? Date.now : () => input.QA_NOW ?? Date.now(),
  })(
    {
      outboxId: crypto.randomUUID(),
      aggregateId: input.QA_TASK_ID,
      eventType: "execution_task.queued",
      payload: { taskId: input.QA_TASK_ID },
      availableAt: 0,
    },
    new AbortController().signal,
  )
} finally {
  await db.end()
}
