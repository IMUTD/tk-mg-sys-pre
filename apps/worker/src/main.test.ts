import { expect, it } from "bun:test"
import { createWorkerFatalFailureHandler, startWorker } from "./main"

const environment = {
  DATABASE_URL: "postgres://worker:password@127.0.0.1:1/tk_mg",
  TK_MG_SYSTEM_ACTOR_ID: "99999999-9999-4999-8999-999999999999",
  TK_MG_WORKER_ID: "worker-a",
}

it("writes failed health before invoking the injected process terminator", async () => {
  const events: string[] = []
  const handler = createWorkerFatalFailureHandler(
    "/tmp/worker-health",
    async (_path, contents) => {
      events.push(`health:${contents.trim()}`)
      await Promise.resolve()
    },
    (code) => {
      events.push(`exit:${code}`)
    },
  )

  await handler(new Error("cycle failed"))

  expect(events).toEqual(["health:failed", "exit:1"])
})

it("marks startup non-ready before readiness failure", async () => {
  const statuses: string[] = []

  await expect(
    startWorker(environment, async (_path, contents) => {
      statuses.push(contents.trim())
    }),
  ).rejects.toThrow()

  expect(statuses).toEqual(["starting", "failed"])
})
