import { describe, expect, it } from "bun:test"
import type { OutboxMessage } from "@tk-mg/task-execution"
import { OwnershipLostError } from "./ownership"
import { createWorkerRuntime, parseWorkerRuntimeConfig, type WorkerRepository } from "./runtime"

const message = (outboxId: string): OutboxMessage => ({
  outboxId,
  aggregateId: "task-1",
  eventType: "execution_task.queued",
  payload: { taskId: "task-1" },
  availableAt: 0,
})

const repository = (messages: readonly OutboxMessage[]): WorkerRepository => {
  const claimed = [...messages]
  return {
    claimAvailable: async (_owner, _now, limit) => claimed.splice(0, limit),
    acknowledge: async () => undefined,
    fail: async () => undefined,
    recoverStale: async () => [],
  }
}

describe("parseWorkerRuntimeConfig", () => {
  it("parses explicit worker bounds and rejects invalid concurrency", () => {
    expect(() => parseWorkerRuntimeConfig({ TK_MG_WORKER_CONCURRENCY: "0" })).toThrow()
    expect(
      parseWorkerRuntimeConfig({
        DATABASE_URL: "postgres://worker:password@postgres:5432/tk_mg",
        TK_MG_SYSTEM_ACTOR_ID: "99999999-9999-4999-8999-999999999999",
        TK_MG_WORKER_ID: "worker-a",
        TK_MG_WORKER_CONCURRENCY: "3",
        TK_MG_WORKER_POLL_INTERVAL_MS: "250",
        TK_MG_WORKER_LEASE_MS: "30000",
        TK_MG_WORKER_HEARTBEAT_MS: "10000",
      }),
    ).toMatchObject({ workerId: "worker-a", concurrency: 3, pollIntervalMs: 250 })
  })
})

describe("createWorkerRuntime", () => {
  it("leaves a lost owner's outbox claim reclaimable without ack or failure", async () => {
    const actions: string[] = []
    const runtime = createWorkerRuntime({
      repository: {
        ...repository([message("lost")]),
        acknowledge: async () => {
          actions.push("ack")
        },
        fail: async () => {
          actions.push("fail")
        },
      },
      config: parseWorkerRuntimeConfig({
        DATABASE_URL: "postgres://worker:password@postgres:5432/tk_mg",
        TK_MG_SYSTEM_ACTOR_ID: "99999999-9999-4999-8999-999999999999",
        TK_MG_WORKER_ID: "worker-a",
      }),
      executor: async () => {
        throw new OwnershipLostError()
      },
    })
    await runtime.runCycle()
    expect(actions).toEqual([])
  })

  it("aborts its idle poll and never starts another cycle after shutdown", async () => {
    const entered = Promise.withResolvers<void>()
    const sleep = Promise.withResolvers<void>()
    let claims = 0
    const runtime = createWorkerRuntime({
      repository: {
        ...repository([]),
        claimAvailable: async () => {
          claims += 1
          return []
        },
      },
      config: parseWorkerRuntimeConfig({
        DATABASE_URL: "postgres://worker:password@postgres:5432/tk_mg",
        TK_MG_SYSTEM_ACTOR_ID: "99999999-9999-4999-8999-999999999999",
        TK_MG_WORKER_ID: "worker-a",
      }),
      executor: async () => undefined,
      sleep: () => {
        entered.resolve()
        return sleep.promise
      },
    })
    await runtime.start()
    await entered.promise
    await Promise.all([runtime.stop(), runtime.stop()])
    sleep.resolve()
    await Promise.resolve()
    expect(runtime.status()).toBe("stopped")
    expect(claims).toBe(2)
  })
  for (const toStatus of [
    "queued",
    "dispatching",
    "cancel_requested",
    "succeeded",
    "failed",
    "timed_out",
    "cancelled",
    "needs_reconciliation",
    "running",
  ] as const) {
    it(`acknowledges ${toStatus} notification without execution`, async () => {
      const actions: string[] = []
      const runtime = createWorkerRuntime({
        repository: {
          ...repository([
            {
              ...message("notification"),
              eventType: "execution_task.status_changed",
              payload: { taskId: "task-1", toStatus },
            },
          ]),
          acknowledge: async () => {
            actions.push("ack")
          },
          fail: async () => {
            actions.push("fail")
          },
        },
        config: parseWorkerRuntimeConfig({
          DATABASE_URL: "postgres://worker:password@postgres:5432/tk_mg",
          TK_MG_SYSTEM_ACTOR_ID: "99999999-9999-4999-8999-999999999999",
          TK_MG_WORKER_ID: "worker-a",
        }),
        executor: async () => {
          actions.push("execute")
        },
      })

      await runtime.runCycle()

      expect(actions).toEqual(["ack"])
    })
  }

  it("executes due retry status changes before acknowledging", async () => {
    const actions: string[] = []
    const runtime = createWorkerRuntime({
      repository: {
        ...repository([
          {
            ...message("retry"),
            eventType: "execution_task.status_changed",
            payload: { taskId: "task-1", toStatus: "retry_waiting" },
          },
        ]),
        acknowledge: async () => {
          actions.push("ack")
        },
      },
      config: parseWorkerRuntimeConfig({
        DATABASE_URL: "postgres://worker:password@postgres:5432/tk_mg",
        TK_MG_SYSTEM_ACTOR_ID: "99999999-9999-4999-8999-999999999999",
        TK_MG_WORKER_ID: "worker-a",
      }),
      executor: async () => {
        actions.push("execute")
      },
    })

    await runtime.runCycle()

    expect(actions).toEqual(["execute", "ack"])
  })

  it("fails an unknown event instead of acknowledging or executing it", async () => {
    const actions: string[] = []
    const runtime = createWorkerRuntime({
      repository: {
        ...repository([{ ...message("poison"), eventType: "execution_task.unrecognized" }]),
        acknowledge: async () => {
          actions.push("ack")
        },
        fail: async () => {
          actions.push("fail")
        },
      },
      config: parseWorkerRuntimeConfig({
        DATABASE_URL: "postgres://worker:password@postgres:5432/tk_mg",
        TK_MG_SYSTEM_ACTOR_ID: "99999999-9999-4999-8999-999999999999",
        TK_MG_WORKER_ID: "worker-a",
      }),
      executor: async () => {
        actions.push("execute")
      },
    })

    await runtime.runCycle()

    expect(actions).toEqual(["fail"])
  })

  for (const [description, payload] of [
    ["missing status", { taskId: "task-1" }],
    ["unknown status", { taskId: "task-1", toStatus: "obsolete" }],
    ["null status", { taskId: "task-1", toStatus: null }],
    ["non-string status", { taskId: "task-1", toStatus: { value: "failed" } }],
  ] as const) {
    it(`fails status_changed with ${description} without execution or acknowledgement`, async () => {
      const actions: string[] = []
      const runtime = createWorkerRuntime({
        repository: {
          ...repository([
            { ...message("invalid"), eventType: "execution_task.status_changed", payload },
          ]),
          acknowledge: async () => {
            actions.push("ack")
          },
          fail: async () => {
            actions.push("fail")
          },
        },
        config: parseWorkerRuntimeConfig({
          DATABASE_URL: "postgres://worker:password@postgres:5432/tk_mg",
          TK_MG_SYSTEM_ACTOR_ID: "99999999-9999-4999-8999-999999999999",
          TK_MG_WORKER_ID: "worker-a",
        }),
        executor: async () => {
          actions.push("execute")
        },
      })

      await runtime.runCycle()

      expect(actions).toEqual(["fail"])
    })
  }
  it("acknowledges only after the executor resolves", async () => {
    const order: string[] = []
    const runtime = createWorkerRuntime({
      repository: repository([message("outbox-1")]),
      config: parseWorkerRuntimeConfig({
        DATABASE_URL: "postgres://worker:password@postgres:5432/tk_mg",
        TK_MG_SYSTEM_ACTOR_ID: "99999999-9999-4999-8999-999999999999",
        TK_MG_WORKER_ID: "worker-a",
      }),
      clock: () => 100,
      executor: async () => {
        order.push("execute")
      },
      sleep: async () => undefined,
    })

    await runtime.runCycle()

    expect(order).toEqual(["execute"])
    expect(runtime.status()).toBe("ready")
  })

  it("stops repeatedly without starting another cycle", async () => {
    let claims = 0
    const source = repository([])
    const runtime = createWorkerRuntime({
      repository: {
        ...source,
        claimAvailable: async (...args) => {
          claims += 1
          return source.claimAvailable(...args)
        },
      },
      config: parseWorkerRuntimeConfig({
        DATABASE_URL: "postgres://worker:password@postgres:5432/tk_mg",
        TK_MG_SYSTEM_ACTOR_ID: "99999999-9999-4999-8999-999999999999",
        TK_MG_WORKER_ID: "worker-a",
      }),
      executor: async () => undefined,
    })

    await runtime.stop()
    await runtime.stop()
    await runtime.runCycle()

    expect(claims).toBe(0)
  })

  it("keeps an owner-bound claim from being acknowledged by another owner", async () => {
    const acknowledged: string[] = []
    const source = repository([message("outbox-1")])
    const runtime = createWorkerRuntime({
      repository: {
        ...source,
        acknowledge: async (delivery) => {
          if (delivery.owner === "worker-a") acknowledged.push(delivery.outboxId)
        },
      },
      config: parseWorkerRuntimeConfig({
        DATABASE_URL: "postgres://worker:password@postgres:5432/tk_mg",
        TK_MG_SYSTEM_ACTOR_ID: "99999999-9999-4999-8999-999999999999",
        TK_MG_WORKER_ID: "worker-a",
      }),
      executor: async () => undefined,
    })

    await runtime.runCycle()

    expect(acknowledged).toEqual(["outbox-1"])
  })

  it("fails a message after executor rejection and recovers stale work first", async () => {
    const actions: string[] = []
    const source = repository([message("outbox-1")])
    const runtime = createWorkerRuntime({
      repository: {
        ...source,
        recoverStale: async () => {
          actions.push("recover")
          return []
        },
        fail: async () => {
          actions.push("fail")
        },
        acknowledge: async () => {
          actions.push("ack")
        },
      },
      config: parseWorkerRuntimeConfig({
        DATABASE_URL: "postgres://worker:password@postgres:5432/tk_mg",
        TK_MG_SYSTEM_ACTOR_ID: "99999999-9999-4999-8999-999999999999",
        TK_MG_WORKER_ID: "worker-a",
      }),
      executor: async () => Promise.reject(new Error("executor unavailable")),
    })

    await runtime.runCycle()

    expect(actions).toEqual(["recover", "fail"])
  })

  it("aborts an active executor before acknowledging during worker stop", async () => {
    let executorAborted = false
    let acknowledged = false
    let notifyStarted: (() => void) | undefined
    const executorStarted = new Promise<void>((resolve) => {
      notifyStarted = resolve
    })
    const runtime = createWorkerRuntime({
      repository: {
        ...repository([message("outbox-stop")]),
        acknowledge: async () => {
          acknowledged = true
        },
      },
      config: parseWorkerRuntimeConfig({
        DATABASE_URL: "postgres://worker:password@postgres:5432/tk_mg",
        TK_MG_SYSTEM_ACTOR_ID: "99999999-9999-4999-8999-999999999999",
        TK_MG_WORKER_ID: "worker-a",
      }),
      executor: async (_message, signal) => {
        notifyStarted?.()
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              executorAborted = true
              resolve()
            },
            { once: true },
          )
        })
      },
    })

    const cycle = runtime.runCycle()
    await executorStarted
    await runtime.stop()
    await cycle

    expect(executorAborted).toBe(true)
    expect(acknowledged).toBe(false)
  })

  it("marks the worker failed when a cycle rejects", async () => {
    const failure = new Error("database unavailable")
    const runtime = createWorkerRuntime({
      repository: {
        ...repository([]),
        recoverStale: async () => Promise.reject(failure),
      },
      config: parseWorkerRuntimeConfig({
        DATABASE_URL: "postgres://worker:password@postgres:5432/tk_mg",
        TK_MG_SYSTEM_ACTOR_ID: "99999999-9999-4999-8999-999999999999",
        TK_MG_WORKER_ID: "worker-a",
      }),
      executor: async () => undefined,
    })

    await expect(runtime.start()).rejects.toBe(failure)

    expect(runtime.status()).toBe("failed")
  })

  it("awaits fatal handling before exposing the cycle failure", async () => {
    const order: string[] = []
    const failure = new Error("database unavailable")
    const runtime = createWorkerRuntime({
      repository: {
        ...repository([]),
        recoverStale: async () => Promise.reject(failure),
      },
      config: parseWorkerRuntimeConfig({
        DATABASE_URL: "postgres://worker:password@postgres:5432/tk_mg",
        TK_MG_SYSTEM_ACTOR_ID: "99999999-9999-4999-8999-999999999999",
        TK_MG_WORKER_ID: "worker-a",
      }),
      executor: async () => undefined,
      onFatalFailure: async () => {
        order.push("fatal-start")
        await Promise.resolve()
        order.push("fatal-complete")
      },
    })

    await expect(runtime.runCycle()).rejects.toBe(failure)

    expect(order).toEqual(["fatal-start", "fatal-complete"])
  })

  it("publishes ready before launching the background cycle", async () => {
    const events: string[] = []
    const secondCycle = Promise.withResolvers<void>()
    let cycles = 0
    const runtime = createWorkerRuntime({
      repository: {
        ...repository([]),
        recoverStale: async () => {
          cycles += 1
          if (cycles === 2) {
            events.push("background")
            await secondCycle.promise
          }
          return []
        },
      },
      config: parseWorkerRuntimeConfig({
        DATABASE_URL: "postgres://worker:password@postgres:5432/tk_mg",
        TK_MG_SYSTEM_ACTOR_ID: "99999999-9999-4999-8999-999999999999",
        TK_MG_WORKER_ID: "worker-a",
      }),
      executor: async () => undefined,
      onStarted: async () => {
        events.push("ready")
      },
    })

    await runtime.start()
    expect(events).toEqual(["ready", "background"])
    secondCycle.resolve()
    await runtime.stop()
  })
})
