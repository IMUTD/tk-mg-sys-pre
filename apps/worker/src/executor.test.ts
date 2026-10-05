import { expect, it } from "bun:test"
import {
  createInMemoryDeviceAdapter,
  createUnconfiguredDeviceAdapter,
  DeviceCommandIdSchema,
  type DeviceCommandResult,
  DeviceIdSchema,
  IdempotencyKeySchema,
} from "@tk-mg/device-adapter"
import type {
  ExecutionLease,
  OutboxMessage,
  TaskClaim,
  TaskStepRecord,
} from "@tk-mg/task-execution"
import { createTaskExecutor } from "./executor"
import {
  createWorkerRuntime,
  type WorkerExecutionRepository,
  type WorkerRuntimeConfig,
} from "./runtime"

const config: WorkerRuntimeConfig = {
  databaseUrl: "postgres://worker:password@postgres:5432/tk_mg",
  systemActorId: "99999999-9999-4999-8999-999999999999",
  workerId: "worker-a",
  concurrency: 1,
  pollIntervalMs: 1000,
  outboxBatchSize: 1,
  recoveryBatchSize: 1,
  leaseMs: 30_000,
  heartbeatMs: 10_000,
  retryDelayMs: 0,
}

const command = (index: number) => ({
  commandId: DeviceCommandIdSchema.parse(`00000000-0000-4000-8000-00000000000${index}`),
  idempotencyKey: IdempotencyKeySchema.parse(`step-${index}`),
  target: { deviceId: DeviceIdSchema.parse("device-1") },
  timeoutMs: 1000,
  type: "tap" as const,
  x: index,
  y: index,
})

const repositoryFixture = (steps: readonly TaskStepRecord[]) => {
  let state: TaskClaim["state"] = "dispatching"
  let next = 0
  const claim: TaskClaim = {
    taskId: "task-1",
    groupId: "group-1",
    target: { deviceId: DeviceIdSchema.parse("device-1") },
    state,
    attempt: 1,
    maxAttempts: 3,
    steps,
    actor: { actorId: "actor-1", actorType: "system", requestId: "test" },
    createdAt: 0,
    updatedAt: 0,
    runId: "run-1",
    claimToken: "claim-1",
    leaseExpiresAt: 30_000,
  }
  const repository: WorkerExecutionRepository = {
    markSubmitStarted: async () => true,
    quarantineOwned: async () => {
      state = "needs_reconciliation"
      return true
    },
    claimAvailable: async () => [],
    acknowledge: async () => undefined,
    fail: async () => undefined,
    recoverStale: async (): Promise<readonly ExecutionLease[]> => [],
    claimTask: async () => claim,
    renewTask: async () => true,
    getOwnedTask: async () => ({ ...claim, state }),
    claimNext: async () => {
      const step = steps[next]
      next += 1
      return step ?? null
    },
    finishStep: async () => true,
    retryStep: async () => true,
    finishOwned: async (_taskId, _runId, _token, _expected, nextState) => {
      state = nextState
      return true
    },
    acquireDeviceLease: async () => true,
    renewDeviceLease: async () => true,
    releaseDeviceLease: async () => true,
  }
  return { repository, state: () => state }
}

const message: OutboxMessage = {
  outboxId: "outbox-1",
  aggregateId: "task-1",
  eventType: "execution_task.queued",
  payload: { taskId: "task-1" },
  availableAt: 0,
}

const waitForCheckpoint = async (checkpoint: Promise<void>, cleanup: () => void): Promise<void> => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      checkpoint,
      new Promise<void>((_resolve, reject) => {
        timeout = setTimeout(() => {
          cleanup()
          reject(new Error("executor checkpoint not reached"))
        }, 1000)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

it("does not claim provider work for a terminal status notification", async () => {
  const { repository } = repositoryFixture([])
  let claims = 0
  let healthCalls = 0
  await createTaskExecutor({
    repository: {
      ...repository,
      claimTask: async () => {
        claims += 1
        return null
      },
    },
    adapter: {
      ...createInMemoryDeviceAdapter(),
      health: async () => {
        healthCalls += 1
        return { status: "available" }
      },
    },
    config,
  })(
    {
      ...message,
      eventType: "execution_task.status_changed",
      payload: { taskId: "task-1", toStatus: "succeeded" },
    },
    new AbortController().signal,
  )

  expect({ claims, healthCalls }).toEqual({ claims: 0, healthCalls: 0 })
})

it("commits the submit marker before crossing the adapter boundary", async () => {
  const step: TaskStepRecord = {
    stepId: "step-1",
    taskId: "task-1",
    ordinal: 0,
    command: command(1),
    state: "claimed",
    attempt: 1,
  }
  const { repository } = repositoryFixture([step])
  const adapter = createInMemoryDeviceAdapter({ autoComplete: true })
  const operations: string[] = []
  await createTaskExecutor({
    repository: {
      ...repository,
      markSubmitStarted: async () => {
        operations.push("marker-committed")
        return true
      },
    },
    adapter: {
      ...adapter,
      submit: async (input) => {
        operations.push("submit")
        return adapter.submit(input)
      },
    },
    config,
  })(message, new AbortController().signal)
  expect(operations).toEqual(["marker-committed", "submit"])
})

it("quarantines a lost submit response instead of scheduling another submission", async () => {
  const step: TaskStepRecord = {
    stepId: "step-1",
    taskId: "task-1",
    ordinal: 0,
    command: command(1),
    state: "claimed",
    attempt: 1,
  }
  const { repository, state } = repositoryFixture([step])
  const adapter = createInMemoryDeviceAdapter()
  let submissions = 0
  await createTaskExecutor({
    repository,
    adapter: {
      ...adapter,
      submit: async (input) => {
        submissions += 1
        await adapter.submit(input)
        throw new Error("lost response")
      },
    },
    config,
    sleep: async () => undefined,
  })(message, new AbortController().signal)
  expect(state()).toBe("needs_reconciliation")
  expect(submissions).toBe(1)
})

it("quarantines a failed cancellation instead of inventing provider cancellation", async () => {
  const execution = pendingExecution()
  let quarantined = false
  const run = createTaskExecutor({
    repository: {
      ...execution.repository,
      quarantineOwned: async () => {
        quarantined = true
        return true
      },
    },
    adapter: {
      ...execution.provider,
      cancel: async () => {
        throw new Error("lost cancellation")
      },
    },
    config,
  })(message, new AbortController().signal)
  await waitForCheckpoint(execution.entered, () => {
    execution.release()
    void run.catch(() => undefined)
  })
  execution.requestCancel()
  execution.release()
  await run
  expect(quarantined).toBe(true)
  expect(execution.state().transitions).toEqual([])
})

it("keeps a timed-out submission quarantined when provider success arrives later", async () => {
  const step: TaskStepRecord = {
    stepId: "step-1",
    taskId: "task-1",
    ordinal: 0,
    command: command(1),
    state: "claimed",
    attempt: 1,
  }
  const { repository, state } = repositoryFixture([step])
  const adapter = createInMemoryDeviceAdapter()
  const response = Promise.withResolvers<void>()
  let submits = 0
  const execute = createTaskExecutor({
    repository,
    adapter: {
      ...adapter,
      submit: async (input) => {
        submits += 1
        const receipt = await adapter.submit(input)
        await response.promise
        return receipt
      },
    },
    config,
    timeouts: { submitMs: 1, cancelMs: 1 },
  })
  await execute(message, new AbortController().signal)
  expect(state()).toBe("needs_reconciliation")
  adapter.complete(step.command.commandId)
  response.resolve()
  await response.promise
  expect((await adapter.getResult(step.command.commandId)).status).toBe("succeeded")
  expect(state()).toBe("needs_reconciliation")
  expect(submits).toBe(1)
})

it("queries the original command identity after losing an accepted submit response", async () => {
  const step: TaskStepRecord = {
    stepId: "step-1",
    taskId: "task-1",
    ordinal: 0,
    command: command(1),
    state: "claimed",
    attempt: 1,
  }
  const { repository, state } = repositoryFixture([step])
  const adapter = createInMemoryDeviceAdapter({ autoComplete: true })
  let submits = 0
  await createTaskExecutor({
    repository,
    adapter: {
      ...adapter,
      submit: async (input) => {
        submits += 1
        await adapter.submit(input)
        throw new Error("response lost after acceptance")
      },
    },
    config,
  })(message, new AbortController().signal)
  expect(state()).toBe("succeeded")
  expect(submits).toBe(1)
})

it("quarantines a never resolving provider result query", async () => {
  const step: TaskStepRecord = {
    stepId: "step-1",
    taskId: "task-1",
    ordinal: 0,
    command: { ...command(1), timeoutMs: 1 },
    state: "claimed",
    attempt: 1,
  }
  const { repository, state } = repositoryFixture([step])
  const adapter = createInMemoryDeviceAdapter()
  await createTaskExecutor({
    repository,
    adapter: { ...adapter, getResult: () => new Promise(() => undefined) },
    timeouts: { submitMs: 1000, cancelMs: 1 },
    config,
  })(message, new AbortController().signal)
  expect(state()).toBe("needs_reconciliation")
})

it("bounds each unresolved result query by the configured poll timeout", async () => {
  const step: TaskStepRecord = {
    stepId: "step-1",
    taskId: "task-1",
    ordinal: 0,
    command: { ...command(1), timeoutMs: 10_000 },
    state: "claimed",
    attempt: 1,
  }
  const { repository, state } = repositoryFixture([step])
  const adapter = createInMemoryDeviceAdapter()
  const query = Promise.withResolvers<Awaited<ReturnType<typeof adapter.getResult>>>()
  let submits = 0
  let releases = 0
  let retries = 0
  const controller = new AbortController()
  const run = createTaskExecutor({
    repository: {
      ...repository,
      releaseDeviceLease: async () => {
        releases += 1
        return state() !== "needs_reconciliation"
      },
      finishOwned: async () => {
        retries += 1
        return true
      },
    },
    adapter: {
      ...adapter,
      submit: async (input) => {
        submits += 1
        return adapter.submit(input)
      },
      getResult: () => query.promise,
    },
    config,
    timeouts: { submitMs: 1000, cancelMs: 1, pollMs: 5 },
  })(message, controller.signal)
  const watchdog = setTimeout(() => controller.abort(), 1000)
  try {
    await run
    expect(controller.signal.aborted).toBe(false)
    expect(state()).toBe("needs_reconciliation")
    expect({ submits, releases, retries }).toEqual({ submits: 1, releases: 1, retries: 0 })
    query.resolve({ commandId: step.command.commandId, status: "cancelled", retryable: false })
    await query.promise
    expect(state()).toBe("needs_reconciliation")
  } finally {
    clearTimeout(watchdog)
    controller.abort()
  }
})

it("interrupts a pending poll sleep after submission without releasing quarantine", async () => {
  const step: TaskStepRecord = {
    stepId: "step-1",
    taskId: "task-1",
    ordinal: 0,
    command: command(1),
    state: "claimed",
    attempt: 1,
  }
  const { repository, state } = repositoryFixture([step])
  const adapter = createInMemoryDeviceAdapter()
  const enteredSleep = Promise.withResolvers<void>()
  const releaseSleep = Promise.withResolvers<void>()
  const controller = new AbortController()
  let releases = 0
  let submits = 0
  const run = createTaskExecutor({
    repository: {
      ...repository,
      releaseDeviceLease: async () => {
        releases += 1
        return state() !== "needs_reconciliation"
      },
    },
    adapter: {
      ...adapter,
      submit: async (input) => {
        submits += 1
        return adapter.submit(input)
      },
    },
    config,
    timeouts: { submitMs: 1000, cancelMs: 1 },
    sleep: () => {
      enteredSleep.resolve()
      return releaseSleep.promise
    },
  })(message, controller.signal)
  await waitForCheckpoint(enteredSleep.promise, () => {
    controller.abort()
    releaseSleep.resolve()
    void run.catch(() => undefined)
  })
  controller.abort()
  let watchdogFired = false
  const watchdog = setTimeout(() => {
    watchdogFired = true
    releaseSleep.resolve()
  }, 1000)
  try {
    await run
    expect(watchdogFired).toBe(false)
    expect(state()).toBe("needs_reconciliation")
    expect({ submits, releases }).toEqual({ submits: 1, releases: 1 })
  } finally {
    clearTimeout(watchdog)
    releaseSleep.resolve()
  }
})

it("quarantines a never resolving cancellation locally without asserting physical cancellation", async () => {
  const execution = pendingExecution()
  const cancellation = Promise.withResolvers<void>()
  let quarantined = false
  let releases = 0
  let submits = 0
  let confirmedQueries = 0
  const originalGetResult = execution.provider.getResult
  const execute = createTaskExecutor({
    repository: {
      ...execution.repository,
      claimTask: async (...args) => (quarantined ? null : execution.repository.claimTask(...args)),
      quarantineOwned: async () => {
        quarantined = true
        return true
      },
      releaseDeviceLease: async () => {
        releases += 1
        return !quarantined
      },
    },
    adapter: {
      ...execution.provider,
      submit: async (input) => {
        submits += 1
        return execution.provider.submit(input)
      },
      getResult: async (commandId) => {
        confirmedQueries += 1
        return originalGetResult(commandId)
      },
      cancel: () => cancellation.promise,
    },
    config,
    timeouts: { submitMs: 1000, cancelMs: 1 },
  })
  const run = execute(message, new AbortController().signal)
  await waitForCheckpoint(execution.entered, () => {
    execution.release()
    cancellation.resolve()
    void run.catch(() => undefined)
  })
  execution.requestCancel()
  execution.release()
  await run
  expect(quarantined).toBe(true)
  expect({ releases, submits, confirmedQueries }).toEqual({
    releases: 1,
    submits: 1,
    confirmedQueries: 1,
  })
  expect(execution.state().transitions).toEqual([])
  cancellation.resolve()
  await cancellation.promise
  await execute(message, new AbortController().signal)
  expect(submits).toBe(1)
  expect(execution.state().transitions).toEqual([])
})

it("keeps an in-memory command cancelled when completion arrives afterward", async () => {
  const adapter = createInMemoryDeviceAdapter()
  const pending = command(3)
  await adapter.submit(pending)
  adapter.start(pending.commandId)

  await adapter.cancel(pending.commandId)
  adapter.complete(pending.commandId)

  expect(await adapter.getResult(pending.commandId)).toEqual({
    commandId: pending.commandId,
    status: "cancelled",
    retryable: false,
  })
})

it("keeps an in-memory command succeeded when cancellation arrives afterward", async () => {
  const adapter = createInMemoryDeviceAdapter()
  const completed = command(4)
  await adapter.submit(completed)
  adapter.complete(completed.commandId)

  await adapter.cancel(completed.commandId)

  expect((await adapter.getResult(completed.commandId)).status).toBe("succeeded")
})

it("executes ordered steps without replaying a prior success", async () => {
  const steps = [1, 2].map((index) => ({
    stepId: `step-${index}`,
    taskId: "task-1",
    ordinal: index,
    command: command(index),
    state: "claimed" as const,
    attempt: 1,
  }))
  const adapter = createInMemoryDeviceAdapter({ autoComplete: true })
  const { repository } = repositoryFixture(steps)
  await createTaskExecutor({ repository, adapter, config })(message, new AbortController().signal)
  expect((await adapter.getResult(command(1).commandId)).status).toBe("succeeded")
  expect((await adapter.getResult(command(2).commandId)).status).toBe("succeeded")
})

it("executes a recovered pending step once with its persisted command identity", async () => {
  const recovered: TaskStepRecord = {
    stepId: "step-1",
    taskId: "task-1",
    ordinal: 0,
    command: command(1),
    state: "pending",
    attempt: 2,
  }
  const { repository } = repositoryFixture([recovered])
  const adapter = createInMemoryDeviceAdapter({ autoComplete: true })
  const submitted: string[] = []

  await createTaskExecutor({
    repository,
    adapter: {
      ...adapter,
      submit: async (value) => {
        submitted.push(value.commandId)
        return adapter.submit(value)
      },
    },
    config,
  })(message, new AbortController().signal)

  expect(submitted).toEqual([recovered.command.commandId])
})

it("finishes an unconfigured target as a non-retryable task failure", async () => {
  const { repository, state } = repositoryFixture([])
  const adapter = createUnconfiguredDeviceAdapter()
  await createTaskExecutor({ repository, adapter, config })(message, new AbortController().signal)
  expect(state()).toBe("failed")
})

it("retries an unavailable health check without claiming a step", async () => {
  const { repository, state } = repositoryFixture([])
  const adapter = createInMemoryDeviceAdapter()
  await createTaskExecutor({
    repository,
    adapter: {
      ...adapter,
      health: async () => ({
        status: "unavailable",
        error: { code: "unavailable", message: "offline" },
      }),
    },
    config,
  })(message, new AbortController().signal)
  expect(state()).toBe("retry_waiting")
})

it("schedules a pre-submit health retry with injected clock and jitter", async () => {
  const { repository } = repositoryFixture([])
  const adapter = createInMemoryDeviceAdapter()
  const deadlines: number[] = []
  await createTaskExecutor({
    repository: {
      ...repository,
      finishOwned: async (_taskId, _runId, _token, _expected, state, now, deadline) => {
        if (state === "retry_waiting" && deadline !== undefined) deadlines.push(deadline - now)
        return true
      },
    },
    adapter: {
      ...adapter,
      health: async () => ({
        status: "unavailable",
        error: { code: "unavailable", message: "offline" },
      }),
    },
    config: { ...config, retryDelayMs: 2_000 },
    clock: () => 10_000,
    random: () => 0.5,
  })(message, new AbortController().signal)
  expect(deadlines).toEqual([2_125])
})

for (const status of ["failed", "timed_out", "not_found"] as const) {
  it(`never retries a marked command when provider reports ${status}`, async () => {
    const step: TaskStepRecord = {
      stepId: "step-1",
      taskId: "task-1",
      ordinal: 0,
      command: command(1),
      state: "claimed",
      attempt: 1,
    }
    const { repository, state } = repositoryFixture([step])
    const adapter = createInMemoryDeviceAdapter()
    let submits = 0
    let retries = 0
    await createTaskExecutor({
      repository: {
        ...repository,
        finishOwned: async (_taskId, _runId, _token, _expected, nextState) => {
          if (nextState === "retry_waiting") retries += 1
          return true
        },
      },
      adapter: {
        ...adapter,
        submit: async (input) => {
          submits += 1
          return adapter.submit(input)
        },
        getResult: async (commandId) => {
          if (status === "not_found") throw new Error("not_found")
          return {
            commandId,
            status,
            retryable: true,
            error: { code: status === "failed" ? "failed" : "timeout", message: "uncertain" },
          }
        },
      },
      config,
      timeouts: { submitMs: 1_000, cancelMs: 100 },
    })(message, new AbortController().signal)
    expect(state()).toBe("needs_reconciliation")
    expect(submits).toBe(1)
    expect(retries).toBe(0)
  })
}

const pendingExecution = () => {
  const step: TaskStepRecord = {
    stepId: "step-1",
    taskId: "task-1",
    ordinal: 0,
    command: command(1),
    state: "claimed",
    attempt: 1,
  }
  const { repository: base } = repositoryFixture([step])
  const adapter = createInMemoryDeviceAdapter()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let taskState: TaskClaim["state"] = "dispatching"
  let stepState: TaskStepRecord["state"] = "claimed"
  let ownerValid = true
  let cancelCalls = 0
  let cancelAtFinish = false
  const transitions: string[] = []
  const repository: WorkerExecutionRepository = {
    ...base,
    quarantineOwned: async (boundary) => {
      const quarantined = await base.quarantineOwned(boundary)
      if (quarantined) taskState = "needs_reconciliation"
      return quarantined
    },
    getOwnedTask: async (taskId, runId, owner, token) => {
      if (
        !ownerValid ||
        taskId !== "task-1" ||
        runId !== "run-1" ||
        owner !== "worker-a" ||
        token !== "claim-1"
      )
        return null
      const claim = await base.claimTask(owner, 0, config.leaseMs)
      return claim === null
        ? null
        : { ...claim, state: taskState, steps: [{ ...step, state: stepState }] }
    },
    finishStep: async (taskId, runId, owner, token, stepId, status) => {
      if (status === "succeeded" && cancelAtFinish) taskState = "cancel_requested"
      if (
        !ownerValid ||
        taskId !== "task-1" ||
        runId !== "run-1" ||
        owner !== "worker-a" ||
        token !== "claim-1" ||
        stepId !== "step-1" ||
        stepState !== "claimed"
      ) {
        return false
      }
      stepState = status
      transitions.push(`step:${status}`)
      return true
    },
    finishOwned: async (taskId, runId, token, expected, status) => {
      if (
        !ownerValid ||
        taskId !== "task-1" ||
        runId !== "run-1" ||
        token !== "claim-1" ||
        taskState !== expected ||
        (status === "succeeded" && stepState !== "succeeded")
      ) {
        return false
      }
      taskState = status
      transitions.push(`task:${status}`)
      return true
    },
  }
  const provider = {
    ...adapter,
    getResult: async (commandId: typeof step.command.commandId) => {
      entered.resolve()
      await release.promise
      return adapter.getResult(commandId)
    },
    cancel: async (commandId: typeof step.command.commandId) => {
      cancelCalls += 1
      await adapter.cancel(commandId)
    },
  }
  return {
    repository,
    provider,
    adapter,
    entered: entered.promise,
    release: release.resolve,
    requestCancel: () => {
      taskState = "cancel_requested"
    },
    cancelAtFinish: () => {
      cancelAtFinish = true
    },
    revokeOwner: () => {
      ownerValid = false
    },
    state: () => ({ task: taskState, step: stepState, cancelCalls, transitions }),
  }
}

it("cancels the provider and task when cancellation arrives during a pending poll", async () => {
  const execution = pendingExecution()
  const run = createTaskExecutor({
    repository: execution.repository,
    adapter: execution.provider,
    config,
    clock: () => 1_000,
    sleep: async () => {
      throw new Error("poll slept after cancellation")
    },
  })(message, new AbortController().signal)
  await execution.entered
  execution.adapter.start(command(1).commandId)
  execution.requestCancel()
  execution.release()

  await run

  expect(execution.state()).toEqual({
    task: "cancelled",
    step: "cancelled",
    cancelCalls: 1,
    transitions: ["step:cancelled", "task:cancelled"],
  })
  expect((await execution.adapter.getResult(command(1).commandId)).status).toBe("cancelled")
})

it("quarantines a cancellation response for a different command without finalizing", async () => {
  const execution = pendingExecution()
  let quarantined = false
  let releaseAllowed = true
  let resultQueries = 0
  const run = createTaskExecutor({
    repository: {
      ...execution.repository,
      quarantineOwned: async (boundary) => {
        quarantined = await execution.repository.quarantineOwned(boundary)
        return quarantined
      },
      releaseDeviceLease: async () => {
        releaseAllowed = !quarantined
        return releaseAllowed
      },
    },
    adapter: {
      ...execution.provider,
      getResult: async (commandId) => {
        resultQueries += 1
        if (resultQueries === 1) return execution.provider.getResult(commandId)
        return { commandId: command(2).commandId, status: "cancelled", retryable: false }
      },
    },
    config,
  })(message, new AbortController().signal)
  await waitForCheckpoint(execution.entered, () => {
    execution.release()
    void run.catch(() => undefined)
  })
  execution.requestCancel()
  execution.release()
  await run

  expect(quarantined).toBe(true)
  expect(releaseAllowed).toBe(false)
  expect(execution.state()).toEqual({
    task: "needs_reconciliation",
    step: "claimed",
    cancelCalls: 1,
    transitions: [],
  })
  expect(resultQueries).toBe(2)
})

const foreignTerminalResults = [
  { commandId: command(2).commandId, status: "cancelled", retryable: false },
  {
    commandId: command(2).commandId,
    status: "succeeded",
    outcome: { kind: "acknowledged" },
    retryable: false,
  },
  {
    commandId: command(2).commandId,
    status: "failed",
    error: { code: "failed", message: "foreign command" },
    retryable: false,
  },
  {
    commandId: command(2).commandId,
    status: "timed_out",
    error: { code: "timeout", message: "foreign command" },
    retryable: false,
  },
] as const satisfies readonly DeviceCommandResult[]

for (const foreignResult of foreignTerminalResults) {
  it(`quarantines a foreign ${foreignResult.status} result from normal polling`, async () => {
    const step: TaskStepRecord = {
      stepId: "step-1",
      taskId: "task-1",
      ordinal: 0,
      command: command(1),
      state: "claimed",
      attempt: 1,
    }
    const { repository, state } = repositoryFixture([step])
    const adapter = createInMemoryDeviceAdapter()
    let finishedSteps = 0
    let finishedTasks = 0
    let released = false
    let submissions = 0
    const execute = createTaskExecutor({
      repository: {
        ...repository,
        claimTask: async (...args) =>
          state() === "needs_reconciliation" ? null : repository.claimTask(...args),
        finishStep: async () => {
          finishedSteps += 1
          return true
        },
        finishOwned: async () => {
          finishedTasks += 1
          return true
        },
        releaseDeviceLease: async () => {
          released = state() !== "needs_reconciliation"
          return released
        },
      },
      adapter: {
        ...adapter,
        submit: async (input) => {
          submissions += 1
          return adapter.submit(input)
        },
        getResult: async () => foreignResult,
      },
      config,
    })
    await execute(message, new AbortController().signal)

    expect(state()).toBe("needs_reconciliation")
    expect({ finishedSteps, finishedTasks, released, submissions }).toEqual({
      finishedSteps: 0,
      finishedTasks: 0,
      released: false,
      submissions: 1,
    })
    await execute(message, new AbortController().signal)
    expect(submissions).toBe(1)
  })
}

for (const status of [
  "succeeded",
  "failed",
  "timed_out",
  "running",
  "not_found",
  "retryable_failed",
] as const) {
  it(`Task 11 resolves ${status} observed during cancellation confirmation`, async () => {
    const execution = pendingExecution()
    const confirmation = Promise.withResolvers<DeviceCommandResult>()
    const cancelling = Promise.withResolvers<void>()
    let queries = 0
    const run = createTaskExecutor({
      repository: execution.repository,
      adapter: {
        ...execution.provider,
        cancel: async () => cancelling.resolve(),
        getResult: (commandId) => {
          queries += 1
          return queries === 1 ? execution.provider.getResult(commandId) : confirmation.promise
        },
      },
      config,
    })(message, new AbortController().signal)
    await waitForCheckpoint(execution.entered, execution.release)
    execution.requestCancel()
    execution.release()
    await waitForCheckpoint(cancelling.promise, () =>
      confirmation.resolve({
        commandId: command(1).commandId,
        status: "running",
        retryable: true,
      }),
    )
    switch (status) {
      case "succeeded":
        confirmation.resolve({
          commandId: command(1).commandId,
          status,
          outcome: { kind: "acknowledged" },
          retryable: false,
        })
        break
      case "failed":
      case "timed_out":
        confirmation.resolve({
          commandId: command(1).commandId,
          status,
          error: { code: "failed", message: "confirmed failure" },
          retryable: false,
        })
        break
      case "running":
        confirmation.resolve({ commandId: command(1).commandId, status, retryable: true })
        break
      case "not_found":
      case "retryable_failed":
        confirmation.resolve({
          commandId: command(1).commandId,
          status: "failed",
          error: { code: status === "not_found" ? "not_found" : "failed", message: "unresolved" },
          retryable: status === "retryable_failed",
        })
        break
      default: {
        const exhaustive: never = status
        throw exhaustive
      }
    }
    await run
    expect(execution.state().task).toBe(
      status === "running" || status === "not_found" || status === "retryable_failed"
        ? "needs_reconciliation"
        : status === "timed_out"
          ? "failed"
          : status,
    )
    expect(execution.state().transitions).toEqual(
      status === "running" || status === "not_found" || status === "retryable_failed"
        ? []
        : [`step:${status}`, `task:${status === "timed_out" ? "failed" : status}`],
    )
  })
}

it("Task 11 preserves partial success and never claims the later step after cancellation", async () => {
  const execution = pendingExecution()
  let claims = 0
  let submissions = 0
  const run = createTaskExecutor({
    repository: {
      ...execution.repository,
      getOwnedTask: async (...args) => {
        const owned = await execution.repository.getOwnedTask(...args)
        return owned === null
          ? null
          : {
              ...owned,
              steps: [
                ...owned.steps,
                {
                  taskId: "task-1",
                  stepId: "step-2",
                  ordinal: 1,
                  command: command(2),
                  state: "pending",
                  attempt: 0,
                },
              ],
            }
      },
      claimNext: async (...args) => {
        claims += 1
        return execution.repository.claimNext(...args)
      },
    },
    adapter: {
      ...execution.provider,
      submit: async (input) => {
        submissions += 1
        return execution.provider.submit(input)
      },
    },
    config,
  })(message, new AbortController().signal)
  await waitForCheckpoint(execution.entered, execution.release)
  execution.requestCancel()
  execution.adapter.complete(command(1).commandId)
  execution.release()
  await run
  expect({ claims, submissions }).toEqual({ claims: 1, submissions: 1 })
  expect(execution.state()).toEqual({
    task: "cancelled",
    step: "succeeded",
    cancelCalls: 0,
    transitions: ["step:succeeded", "task:cancelled"],
  })
})

it("preserves success when cancellation commits between owner read and step finish", async () => {
  const execution = pendingExecution()
  const run = createTaskExecutor({
    repository: execution.repository,
    adapter: execution.provider,
    config,
  })(message, new AbortController().signal)
  await execution.entered
  execution.cancelAtFinish()
  execution.adapter.complete(command(1).commandId)
  execution.release()

  await run

  expect(execution.state()).toEqual({
    task: "succeeded",
    step: "succeeded",
    cancelCalls: 0,
    transitions: ["step:succeeded", "task:succeeded"],
  })
})

it("preserves confirmed provider success returned after cancellation was requested", async () => {
  const execution = pendingExecution()
  const run = createTaskExecutor({
    repository: execution.repository,
    adapter: execution.provider,
    config,
  })(message, new AbortController().signal)
  await execution.entered
  execution.requestCancel()
  execution.adapter.complete(command(1).commandId)
  execution.release()

  await run

  expect(execution.state()).toEqual({
    task: "succeeded",
    step: "succeeded",
    cancelCalls: 0,
    transitions: ["step:succeeded", "task:succeeded"],
  })
  expect((await execution.adapter.getResult(command(1).commandId)).status).toBe("succeeded")
})

it("does not finalize a late result after losing run ownership", async () => {
  const execution = pendingExecution()
  const run = createTaskExecutor({
    repository: execution.repository,
    adapter: execution.provider,
    config,
  })(message, new AbortController().signal)
  await execution.entered
  execution.revokeOwner()
  execution.adapter.complete(command(1).commandId)
  execution.release()

  await run

  expect(execution.state()).toEqual({
    task: "dispatching",
    step: "claimed",
    cancelCalls: 0,
    transitions: [],
  })
})

for (const lostRenewal of ["task", "device", "device-error"] as const) {
  it(`fences provider work and stale writes when ${lostRenewal} renewal loses ownership`, async () => {
    const step: TaskStepRecord = {
      stepId: "step-1",
      taskId: "task-1",
      ordinal: 0,
      command: command(1),
      state: "claimed",
      attempt: 1,
    }
    const { repository } = repositoryFixture([step])
    const health = Promise.withResolvers<{ status: "available" }>()
    let tick: (() => void) | undefined
    const operations: string[] = []
    const run = createTaskExecutor({
      repository: {
        ...repository,
        renewTask: async () => {
          operations.push("renew-task")
          return lostRenewal !== "task"
        },
        renewDeviceLease: async () => {
          operations.push("renew-device")
          if (lostRenewal === "device-error") throw new Error("renew database unavailable")
          return lostRenewal !== "device"
        },
        finishStep: async () => {
          operations.push("finish-step")
          return true
        },
        finishOwned: async () => {
          operations.push("finish-task")
          return true
        },
        releaseDeviceLease: async () => {
          operations.push("release")
          return true
        },
      },
      adapter: {
        ...createInMemoryDeviceAdapter(),
        health: () => health.promise,
        submit: async () => {
          operations.push("submit")
          throw new Error("unexpected submit")
        },
      },
      config,
      scheduleHeartbeat: (callback) => {
        tick = callback
        return () => undefined
      },
    })(message, new AbortController().signal)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(tick).toBeDefined()
    tick?.()
    health.resolve({ status: "available" })
    await run.catch(() => undefined)
    expect(operations).toContain("renew-task")
    if (lostRenewal !== "task") expect(operations).toContain("renew-device")
    expect(operations).not.toContain("submit")
    expect(operations).not.toContain("finish-step")
    expect(operations).not.toContain("finish-task")
    expect(operations).not.toContain("release")
  })
}

it("serializes overlapping heartbeat ticks and ignores a late provider result after loss", async () => {
  const step: TaskStepRecord = {
    stepId: "step-1",
    taskId: "task-1",
    ordinal: 0,
    command: command(1),
    state: "claimed",
    attempt: 1,
  }
  const { repository } = repositoryFixture([step])
  const entered = Promise.withResolvers<void>()
  const renewal = Promise.withResolvers<boolean>()
  const lateResult = Promise.withResolvers<DeviceCommandResult>()
  const adapter = createInMemoryDeviceAdapter()
  let tick: (() => void) | undefined
  const operations: string[] = []
  const run = createTaskExecutor({
    repository: {
      ...repository,
      renewTask: async () => {
        operations.push("task")
        return renewal.promise
      },
      renewDeviceLease: async () => {
        operations.push("device")
        return true
      },
      finishStep: async () => {
        operations.push("finish-step")
        return true
      },
      releaseDeviceLease: async () => {
        operations.push("release")
        return true
      },
    },
    adapter: {
      ...adapter,
      getResult: () => {
        entered.resolve()
        return lateResult.promise
      },
    },
    config,
    scheduleHeartbeat: (callback) => {
      tick = callback
      return () => undefined
    },
  })(message, new AbortController().signal)
  await waitForCheckpoint(entered.promise, () =>
    lateResult.resolve({
      commandId: step.command.commandId,
      status: "succeeded",
      retryable: false,
      outcome: { kind: "acknowledged" },
    }),
  )
  tick?.()
  tick?.()
  await Promise.resolve()
  expect(operations.filter((event) => event === "task")).toHaveLength(1)
  renewal.resolve(false)
  await run.catch(() => undefined)
  lateResult.resolve({
    commandId: step.command.commandId,
    status: "succeeded",
    retryable: false,
    outcome: { kind: "acknowledged" },
  })
  await lateResult.promise
  expect(operations).toEqual(["task"])
})

for (const renewalOutcome of ["false", "error"] as const) {
  it(`withholds outbox acknowledgement when a final renewal resolves ${renewalOutcome}`, async () => {
    const step: TaskStepRecord = {
      stepId: "step-1",
      taskId: "task-1",
      ordinal: 0,
      command: command(1),
      state: "claimed",
      attempt: 1,
    }
    const { repository, state } = repositoryFixture([step])
    const enteredFinalWrite = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    const enteredRenewal = Promise.withResolvers<void>()
    const renewal = Promise.withResolvers<boolean>()
    const events: string[] = []
    let tick: (() => void) | undefined
    const executionRepository: WorkerExecutionRepository = {
      ...repository,
      finishStep: async () => {
        events.push("step-committed")
        return true
      },
      finishOwned: async (...args) => {
        events.push("task-committed")
        const committed = await repository.finishOwned(...args)
        enteredFinalWrite.resolve()
        await finish.promise
        return committed
      },
      renewTask: async () => {
        enteredRenewal.resolve()
        return renewal.promise
      },
      renewDeviceLease: async () => {
        events.push("device-renewed")
        return true
      },
      releaseDeviceLease: async () => {
        events.push("release")
        return true
      },
    }
    const runtime = createWorkerRuntime({
      repository: {
        ...executionRepository,
        claimAvailable: async () => [message],
        acknowledge: async () => {
          events.push("ack")
        },
        fail: async () => {
          events.push("fail")
        },
      },
      config,
      executor: createTaskExecutor({
        repository: executionRepository,
        adapter: createInMemoryDeviceAdapter({ autoComplete: true }),
        config,
        scheduleHeartbeat: (callback) => {
          tick = callback
          return () => undefined
        },
      }),
      onFatalFailure: () => {
        events.push("fatal")
      },
    })

    const cycle = runtime.runCycle()
    await waitForCheckpoint(enteredFinalWrite.promise, () => {
      finish.resolve()
      renewal.resolve(false)
      void cycle.catch(() => undefined)
    })
    expect(state()).toBe("succeeded")
    tick?.()
    await waitForCheckpoint(enteredRenewal.promise, () => {
      finish.resolve()
      renewal.resolve(false)
      void cycle.catch(() => undefined)
    })
    finish.resolve()
    for (let pending = 0; pending < 20; pending += 1) await Promise.resolve()
    expect(events).not.toContain("ack")
    if (renewalOutcome === "error") renewal.reject(new Error("late renew failure"))
    else renewal.resolve(false)
    if (renewalOutcome === "error") await expect(cycle).rejects.toThrow()
    else await cycle
    expect(events.filter((event) => event === "task-committed")).toHaveLength(1)
    expect(events.filter((event) => event === "step-committed")).toHaveLength(1)
    expect(events).not.toContain("ack")
    expect(events).not.toContain("fail")
    expect(events).not.toContain("device-renewed")
    expect(events).not.toContain("release")
    expect(events.filter((event) => event === "fatal")).toHaveLength(
      renewalOutcome === "error" ? 1 : 0,
    )
    expect(state()).toBe("succeeded")
  })
}
