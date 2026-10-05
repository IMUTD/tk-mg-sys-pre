import { createPostgresWorkerRepository } from "@tk-mg/task-execution"
import { startWorker } from "../main"

await startWorker(Bun.env, undefined, {
  createRepository: (client, options) => {
    const repository = createPostgresWorkerRepository(client, options)
    let cycles = 0
    return {
      ...repository,
      recoverStale: async () => {
        cycles += 1
        if (cycles === 2) throw new Error("Isolated fatal worker cycle")
        return []
      },
      claimAvailable: async () => [],
    }
  },
})
