// biome-ignore-all lint/complexity/useLiteralKeys: Bun.env and postgres row values are index-signature typed.
import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { createInMemoryDeviceAdapter } from "@tk-mg/device-adapter"
import { createPostgresWorkerRepository } from "@tk-mg/task-execution"
import postgres from "postgres"
import { createTaskExecutor } from "./executor"
import { createWorkerRuntime } from "./runtime"

describe("worker PostgreSQL outbox recovery", () => {
  it.skipIf(Bun.env["TEST_DATABASE_URL"] === undefined)(
    "claims retry work at the persisted deadline after an earlier notification",
    async () => {
      const url = Bun.env["TEST_DATABASE_URL"]
      if (url === undefined || !new URL(url).pathname.slice(1).startsWith("tk_mg_test_"))
        throw new Error("Disposable database required")
      const client = postgres(url, { max: 2 })
      const repositoryClient = postgres(url, { max: 2 })
      const groupId = crypto.randomUUID()
      const actorId = crypto.randomUUID()
      const recoveryRequesterId = crypto.randomUUID()
      const deviceId = crypto.randomUUID()
      const taskId = crypto.randomUUID()
      const recoveryTaskId = crypto.randomUUID()
      const commandId = crypto.randomUUID()
      const now = Date.now()
      let logicalNow = now
      const clock = () => logicalNow
      const repository = createPostgresWorkerRepository(repositoryClient, {
        systemActor: { actorId, actorType: "system", requestId: "task-8-retry" },
      })
      const config = {
        databaseUrl: url,
        systemActorId: actorId,
        workerId: `task-8-retry-${crypto.randomUUID()}`,
        concurrency: 1,
        pollIntervalMs: 1000,
        outboxBatchSize: 20,
        recoveryBatchSize: 20,
        leaseMs: 30000,
        heartbeatMs: 10000,
        retryDelayMs: 1000,
      }
      const adapter = createInMemoryDeviceAdapter({ autoComplete: true })
      let targetAttempts = 0
      let targetAcquisitions = 0
      let targetSubmissions = 0
      let notificationClaims = 0
      let queuedClaims = 0
      let retryClaims = 0
      const countedRepository = {
        ...repository,
        claimAvailable: async (...args: Parameters<typeof repository.claimAvailable>) => {
          const messages = await repository.claimAvailable(...args)
          for (const message of messages) {
            if (message.aggregateId !== taskId) continue
            if (message.eventType === "execution_task.queued") queuedClaims += 1
            else if (message.payload["toStatus"] === "retry_waiting") retryClaims += 1
            else notificationClaims += 1
          }
          return messages
        },
      }
      const executor = createTaskExecutor({
        repository: {
          ...repository,
          claimTask: async (...args) => {
            if (args[3] === taskId) targetAttempts += 1
            const claim = await repository.claimTask(...args)
            if (claim?.taskId === taskId) targetAcquisitions += 1
            return claim
          },
        },
        config,
        adapter: {
          ...adapter,
          submit: async (command) => {
            if (command.commandId === commandId) targetSubmissions += 1
            return adapter.submit(command)
          },
        },
        clock,
      })
      try {
        await client`insert into access_group (id, name) values (${groupId}, ${groupId})`
        await client`insert into app_user (id, email, password_hash, role, enabled) values (${actorId}, ${`${actorId}@example.test`}, 'test', 'administrator', false)`
        await client`insert into app_user (id, email, password_hash, role, enabled) values (${recoveryRequesterId}, ${`${recoveryRequesterId}@example.test`}, 'test', 'administrator', false)`
        await client`insert into device (id, group_id, name, host, model) values (${deviceId}, ${groupId}, 'task8-retry', ${deviceId}, 'test')`
        await client`insert into execution_task (id, group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters, status) values (${taskId}, ${groupId}, ${actorId}, ${deviceId}, 'task8-retry', 'task8-retry', 'task8-retry', 'device-command', '{}'::jsonb, 'retry_waiting')`
        await client`insert into execution_task (id, group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters, status, finished_at) values (${recoveryTaskId}, ${groupId}, ${recoveryRequesterId}, ${deviceId}, 'task8-other', 'task8-other', 'task8-other', 'device-command', '{}'::jsonb, 'succeeded', now())`
        await client`insert into execution_task_event (id, task_id, group_id, to_status, source, actor_id) values (${crypto.randomUUID()}, ${recoveryTaskId}, ${groupId}, 'succeeded', 'recovery', ${actorId})`
        await client`insert into execution_task_step (task_id, group_id, sequence, command_id, command_idempotency_key, fingerprint, kind, target, parameters) values (${taskId}, ${groupId}, 0, ${commandId}, 'task8-retry', 'task8-retry', 'health_check', ${client.json({ deviceId })}, ${client.json({ timeoutMs: 1000 })})`
        let retryEventId = ""
        for (const toStatus of ["running", "retry_waiting"] as const) {
          const eventId = crypto.randomUUID()
          if (toStatus === "retry_waiting") retryEventId = eventId
          await client`insert into execution_task_event (id, task_id, group_id, to_status, source, actor_id) values (${eventId}, ${taskId}, ${groupId}, ${toStatus}, 'recovery', ${actorId})`
          await client`insert into execution_task_outbox (event_id, task_id, group_id, event_type, payload, available_at) values (${eventId}, ${taskId}, ${groupId}, 'execution_task.status_changed', ${client.json({ taskId, toStatus })}, ${new Date(now)})`
        }
        const earlierQueuedEvent = crypto.randomUUID()
        await client`insert into execution_task_event (id, task_id, group_id, to_status, source, actor_id) values (${earlierQueuedEvent}, ${taskId}, ${groupId}, 'queued', 'submit', ${actorId})`
        await client`insert into execution_task_outbox (event_id, task_id, group_id, event_type, payload, available_at) values (${earlierQueuedEvent}, ${taskId}, ${groupId}, 'execution_task.queued', ${client.json({ taskId })}, ${new Date(now)})`
        const deadline = Date.now() + 1000
        await client`update execution_task set next_retry_at = ${new Date(deadline)} where id = ${taskId}`
        await client`update execution_task_outbox set available_at = ${new Date(deadline)} where event_id = ${retryEventId}`
        const persisted = await repositoryClient<
          { readonly deadline: Date; readonly available: Date }[]
        >`select task.next_retry_at as deadline, outbox.available_at as available from execution_task task join execution_task_outbox outbox on outbox.task_id = task.id where task.id = ${taskId} and outbox.event_id = ${retryEventId}`
        expect(persisted[0]?.deadline.getTime()).toBe(deadline)
        expect(persisted[0]?.available.getTime()).toBe(deadline)
        logicalNow = deadline - 1
        const early = createWorkerRuntime({
          repository: countedRepository,
          config,
          clock,
          executor,
        })
        await early.runCycle()
        const earlyRows = await client<
          {
            readonly toStatus: string | null
            readonly status: string
            readonly availableAt: Date
            readonly eventId: string
          }[]
        >`select event_id as "eventId", payload ->> 'toStatus' as "toStatus", status, available_at as "availableAt" from execution_task_outbox where task_id = ${taskId}`
        expect(earlyRows.find((row) => row.toStatus === "running")?.status).toBe("delivered")
        expect(earlyRows.find((row) => row.eventId === earlierQueuedEvent)?.status).toBe(
          "delivered",
        )
        expect(earlyRows.find((row) => row.eventId === retryEventId)).toMatchObject({
          status: "pending",
          availableAt: new Date(deadline),
        })
        expect({ notificationClaims, queuedClaims, retryClaims }).toEqual({
          notificationClaims: 1,
          queuedClaims: 1,
          retryClaims: 0,
        })
        expect({ targetAttempts, targetAcquisitions, targetSubmissions }).toEqual({
          targetAttempts: 1,
          targetAcquisitions: 0,
          targetSubmissions: 0,
        })
        const earlyTask = await repositoryClient<
          { readonly status: string; readonly nextRetryAt: Date; readonly runs: number }[]
        >`select status, next_retry_at as "nextRetryAt", (select count(*)::int from execution_task_run where task_id = ${taskId}) as runs from execution_task where id = ${taskId}`
        expect(earlyTask[0]).toMatchObject({
          status: "retry_waiting",
          nextRetryAt: new Date(deadline),
          runs: 0,
        })
        logicalNow = deadline
        const due = createWorkerRuntime({ repository: countedRepository, config, clock, executor })
        await due.runCycle()
        const completed = await client<
          { readonly status: string; readonly deliveredAt: Date | null }[]
        >`select status, delivered_at as "deliveredAt" from execution_task_outbox where task_id = ${taskId} and payload ->> 'toStatus' = 'retry_waiting'`
        expect(completed[0]?.deliveredAt).toBeInstanceOf(Date)
        expect(completed[0]?.status).toBe("delivered")
        expect({ notificationClaims, queuedClaims, retryClaims }).toEqual({
          notificationClaims: 1,
          queuedClaims: 1,
          retryClaims: 1,
        })
        expect({ targetAttempts, targetAcquisitions, targetSubmissions }).toEqual({
          targetAttempts: 2,
          targetAcquisitions: 1,
          targetSubmissions: 1,
        })
        const dueTask = await repositoryClient<
          { readonly status: string; readonly runs: number }[]
        >`select status, (select count(*)::int from execution_task_run where task_id = ${taskId}) as runs from execution_task where id = ${taskId}`
        expect(dueTask[0]).toMatchObject({ status: "succeeded", runs: 1 })
      } finally {
        await repositoryClient.end()
        await client`delete from execution_task_device_lease where task_id = ${taskId}`
        await client`delete from execution_task_outbox where event_id in (select id from execution_task_event where actor_id = ${actorId})`
        await client`delete from execution_task_outbox where task_id = ${taskId}`
        await client`delete from execution_task_event where actor_id = ${actorId}`
        await client`delete from execution_task_event where task_id = ${taskId}`
        await client`delete from execution_task_run where task_id = ${taskId}`
        await client`delete from execution_task_step where task_id = ${taskId}`
        await client`delete from execution_task where id = ${taskId}`
        await client`delete from audit_event where actor_id = ${actorId}`
        await client`delete from app_user where id = ${actorId}`
        await client`delete from execution_task where id = ${recoveryTaskId}`
        await client`delete from device where id = ${deviceId}`
        await client`delete from app_user where id = ${recoveryRequesterId}`
        await client`delete from access_group where id = ${groupId}`
        await client.end()
      }
    },
  )
  it.skipIf(Bun.env["TEST_DATABASE_URL"] === undefined)(
    "redelivers a completed task after restart without a second provider submission",
    async () => {
      const url = Bun.env["TEST_DATABASE_URL"]
      if (url === undefined || !new URL(url).pathname.slice(1).startsWith("tk_mg_test_"))
        throw new Error("Disposable database required")
      const client = postgres(url, { max: 2 })
      const groupId = crypto.randomUUID()
      const actorId = crypto.randomUUID()
      const deviceId = crypto.randomUUID()
      const taskId = crypto.randomUUID()
      const eventId = crypto.randomUUID()
      const commandId = crypto.randomUUID()
      const adapter = createInMemoryDeviceAdapter({ autoComplete: true })
      let submissions = 0
      const now = Date.now() + 5000
      const repository = createPostgresWorkerRepository(client, {
        outboxLeaseMs: 1000,
        systemActor: { actorId, actorType: "system", requestId: "task-8-restart" },
      })
      const config = {
        databaseUrl: url,
        systemActorId: actorId,
        workerId: "task-8-restart",
        concurrency: 1,
        pollIntervalMs: 1000,
        outboxBatchSize: 20,
        recoveryBatchSize: 20,
        leaseMs: 30000,
        heartbeatMs: 10000,
        retryDelayMs: 1000,
      }
      const provider = {
        ...adapter,
        submit: async (command: Parameters<typeof adapter.submit>[0]) => {
          submissions += 1
          return adapter.submit(command)
        },
      }
      try {
        await client`insert into access_group (id, name) values (${groupId}, ${groupId})`
        await client`insert into app_user (id, email, password_hash, role, enabled) values (${actorId}, ${`${actorId}@example.test`}, 'test', 'administrator', false)`
        await client`insert into device (id, group_id, name, host, model) values (${deviceId}, ${groupId}, 'task8-restart', ${deviceId}, 'test')`
        await client`insert into execution_task (id, group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters) values (${taskId}, ${groupId}, ${actorId}, ${deviceId}, 'task8-restart', 'task8-restart', 'task8-restart', 'device-command', '{}'::jsonb)`
        await client`insert into execution_task_step (task_id, group_id, sequence, command_id, command_idempotency_key, fingerprint, kind, target, parameters) values (${taskId}, ${groupId}, 0, ${commandId}, 'task8-restart', 'task8-restart', 'health_check', ${client.json({ deviceId })}, ${client.json({ timeoutMs: 1000 })})`
        await client`insert into execution_task_event (id, task_id, group_id, to_status, source, actor_id) values (${eventId}, ${taskId}, ${groupId}, 'queued', 'submit', ${actorId})`
        await client`insert into execution_task_outbox (event_id, task_id, group_id, event_type, payload, available_at) values (${eventId}, ${taskId}, ${groupId}, 'execution_task.queued', ${client.json({ taskId })}, ${new Date(now)})`
        const claimed = (await repository.claimAvailable(config.workerId, now, 20)).find(
          (row) => row.aggregateId === taskId && row.eventType === "execution_task.queued",
        )
        expect(claimed).toBeDefined()
        if (claimed === undefined) throw new Error("Expected queued message")
        await createTaskExecutor({ repository, adapter: provider, config, clock: () => now })(
          claimed,
          new AbortController().signal,
        )
        const beforeAck = await client<
          {
            readonly taskStatus: string
            readonly outboxStatus: string
            readonly attempts: number
          }[]
        >`select task.status as "taskStatus", outbox.status as "outboxStatus", outbox.attempt_count as attempts from execution_task task join execution_task_outbox outbox on outbox.task_id = task.id where outbox.event_id = ${eventId}`
        expect(beforeAck[0]).toMatchObject({
          taskStatus: "succeeded",
          outboxStatus: "claimed",
          attempts: 1,
        })
        const runtime = createWorkerRuntime({
          repository,
          config,
          clock: () => now + 1000,
          executor: createTaskExecutor({
            repository,
            adapter: provider,
            config,
            clock: () => now + 1000,
          }),
        })
        await runtime.runCycle()
        const afterRestart = await client<
          {
            readonly status: string
            readonly attempts: number
            readonly deliveredAt: Date | null
          }[]
        >`select status, attempt_count as attempts, delivered_at as "deliveredAt" from execution_task_outbox where event_id = ${eventId}`
        expect(afterRestart[0]).toMatchObject({ status: "delivered", attempts: 2 })
        expect(afterRestart[0]?.deliveredAt).toBeInstanceOf(Date)
        expect(submissions).toBe(1)
      } finally {
        await client`delete from execution_task_device_lease where task_id = ${taskId}`
        await client`delete from execution_task_outbox where event_id in (select id from execution_task_event where actor_id = ${actorId})`
        await client`delete from execution_task_outbox where task_id = ${taskId}`
        await client`delete from execution_task_event where actor_id = ${actorId}`
        await client`delete from execution_task_event where task_id = ${taskId}`
        await client`delete from execution_task_run where task_id = ${taskId}`
        await client`delete from execution_task_step where task_id = ${taskId}`
        await client`delete from execution_task where id = ${taskId}`
        await client`delete from audit_event where actor_id = ${actorId}`
        await client`delete from device where id = ${deviceId}`
        await client`delete from app_user where id = ${actorId}`
        await client`delete from access_group where id = ${groupId}`
        await client.end()
      }
    },
  )
  it.skipIf(Bun.env["TEST_DATABASE_URL"] === undefined)(
    "delivers status notifications without provider calls and dead-letters unknown events",
    async () => {
      const url = Bun.env["TEST_DATABASE_URL"]
      if (url === undefined || !new URL(url).pathname.slice(1).startsWith("tk_mg_test_"))
        throw new Error("Disposable database required")
      const client = postgres(url, { max: 2 })
      const groupId = crypto.randomUUID()
      const actorId = crypto.randomUUID()
      const deviceId = crypto.randomUUID()
      const taskId = crypto.randomUUID()
      const adapter = createInMemoryDeviceAdapter()
      let healthCalls = 0
      let submissions = 0
      let taskClaims = 0
      let acquiredClaims = 0
      const repository = createPostgresWorkerRepository(client, {
        outboxLeaseMs: 1000,
        systemActor: { actorId, actorType: "system", requestId: "task-8" },
      })
      const config = {
        databaseUrl: url,
        systemActorId: actorId,
        workerId: "task-8",
        concurrency: 1,
        pollIntervalMs: 1000,
        outboxBatchSize: 1,
        recoveryBatchSize: 1,
        leaseMs: 30000,
        heartbeatMs: 10000,
        retryDelayMs: 0,
      }
      const now = Date.now() + 5000
      try {
        await client`insert into access_group (id, name) values (${groupId}, ${groupId})`
        await client`insert into app_user (id, email, password_hash, role, enabled) values (${actorId}, ${`${actorId}@example.test`}, 'test', 'administrator', false)`
        await client`insert into device (id, group_id, name, host, model) values (${deviceId}, ${groupId}, 'task8', ${deviceId}, 'test')`
        await client`insert into execution_task (id, group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters, status, finished_at) values (${taskId}, ${groupId}, ${actorId}, ${deviceId}, 'task8', 'task8', 'task8', 'device-command', '{}'::jsonb, 'succeeded', now())`
        for (const toStatus of [
          "succeeded",
          "failed",
          "timed_out",
          "cancelled",
          "running",
          "needs_reconciliation",
        ]) {
          const eventId = crypto.randomUUID()
          await client`insert into execution_task_event (id, task_id, group_id, to_status, source, actor_id) values (${eventId}, ${taskId}, ${groupId}, ${toStatus}, 'finish', ${actorId})`
          await client`insert into execution_task_outbox (event_id, task_id, group_id, event_type, payload, available_at) values (${eventId}, ${taskId}, ${groupId}, 'execution_task.status_changed', ${client.json({ taskId, toStatus })}, ${new Date(now)})`
        }
        const poisonEvent = crypto.randomUUID()
        await client`insert into execution_task_event (id, task_id, group_id, to_status, source, actor_id) values (${poisonEvent}, ${taskId}, ${groupId}, 'succeeded', 'finish', ${actorId})`
        await client`insert into execution_task_outbox (event_id, task_id, group_id, event_type, payload, available_at) values (${poisonEvent}, ${taskId}, ${groupId}, 'execution_task.unrecognized', ${client.json({ taskId })}, ${new Date(now)})`
        for (const payload of [{ taskId }, { taskId, toStatus: "obsolete" }]) {
          const eventId = crypto.randomUUID()
          await client`insert into execution_task_event (id, task_id, group_id, to_status, source, actor_id) values (${eventId}, ${taskId}, ${groupId}, 'succeeded', 'finish', ${actorId})`
          await client`insert into execution_task_outbox (event_id, task_id, group_id, event_type, payload, available_at) values (${eventId}, ${taskId}, ${groupId}, 'execution_task.status_changed', ${client.json(payload)}, ${new Date(now)})`
        }
        const runtime = createWorkerRuntime({
          repository,
          config,
          clock: () => now,
          executor: createTaskExecutor({
            repository: {
              ...repository,
              claimTask: async (...args) => {
                taskClaims += 1
                const claim = await repository.claimTask(...args)
                if (claim !== null) acquiredClaims += 1
                return claim
              },
            },
            config,
            adapter: {
              ...adapter,
              health: async (target) => {
                healthCalls += 1
                return adapter.health(target)
              },
              submit: async (command) => {
                submissions += 1
                return adapter.submit(command)
              },
            },
            clock: () => now,
          }),
        })
        for (let count = 0; count < 36; count += 1) await runtime.runCycle()
        const rows = await client<
          { readonly eventType: string; readonly status: string; readonly attemptCount: number }[]
        >`select event_type as "eventType", status, attempt_count as "attemptCount" from execution_task_outbox where task_id = ${taskId}`
        expect(
          rows.filter(
            (row) =>
              row.eventType === "execution_task.status_changed" &&
              row.status === "delivered" &&
              row.attemptCount === 1,
          ),
        ).toHaveLength(6)
        expect(rows.find((row) => row.eventType === "execution_task.unrecognized")).toMatchObject({
          status: "dead_letter",
          attemptCount: 10,
        })
        expect(
          rows.filter(
            (row) =>
              row.eventType === "execution_task.status_changed" &&
              row.status === "dead_letter" &&
              row.attemptCount === 10,
          ),
        ).toHaveLength(2)
        expect({ taskClaims, healthCalls, submissions }).toEqual({
          taskClaims: 0,
          healthCalls: 0,
          submissions: 0,
        })
        for (const state of ["failed", "cancelled", "needs_reconciliation", "running"]) {
          const eventId = crypto.randomUUID()
          await client`update execution_task set status = ${state} where id = ${taskId}`
          await client`insert into execution_task_event (id, task_id, group_id, to_status, source, actor_id) values (${eventId}, ${taskId}, ${groupId}, 'queued', 'submit', ${actorId})`
          await client`insert into execution_task_outbox (event_id, task_id, group_id, event_type, payload, available_at) values (${eventId}, ${taskId}, ${groupId}, 'execution_task.queued', ${client.json({ taskId })}, ${new Date(now)})`
          await runtime.runCycle()
          const delivery = await client<
            { readonly status: string; readonly attemptCount: number }[]
          >`select status, attempt_count as "attemptCount" from execution_task_outbox where event_id = ${eventId}`
          expect(delivery[0]).toMatchObject({ status: "delivered", attemptCount: 1 })
        }
        expect({ taskClaims, acquiredClaims, healthCalls, submissions }).toEqual({
          taskClaims: 4,
          acquiredClaims: 0,
          healthCalls: 0,
          submissions: 0,
        })
      } finally {
        await client`delete from execution_task_outbox where event_id in (select id from execution_task_event where actor_id = ${actorId})`
        await client`delete from execution_task_outbox where task_id = ${taskId}`
        await client`delete from execution_task_event where actor_id = ${actorId}`
        await client`delete from execution_task_event where task_id = ${taskId}`
        await client`delete from execution_task where id = ${taskId}`
        await client`delete from device where id = ${deviceId}`
        await client`delete from app_user where id = ${actorId}`
        await client`delete from access_group where id = ${groupId}`
        await client.end()
      }
    },
  )
  for (const boundary of [
    "before-marker",
    "after-marker",
    "accepted",
    "accepted-confirmed",
  ] as const) {
    it.skipIf(Bun.env["TEST_DATABASE_URL"] === undefined)(
      `restarts without replay after ${boundary}`,
      async () => {
        const url = Bun.env["TEST_DATABASE_URL"]
        if (url === undefined || !new URL(url).pathname.slice(1).startsWith("tk_mg_test_"))
          throw new Error("Disposable database required")
        const client = postgres(url, { max: 2 })
        const repositoryClient = postgres(url, { max: 2 })
        const groupId = crypto.randomUUID()
        const actorId = crypto.randomUUID()
        const deviceId = crypto.randomUUID()
        const taskId = crypto.randomUUID()
        let child: ReturnType<typeof Bun.spawn> | undefined
        let watchdog: ReturnType<typeof setTimeout> | undefined
        let queries = 0
        const repository = createPostgresWorkerRepository(repositoryClient, {
          random: () => 0,
          getResult: async (commandId) => {
            queries += 1
            if (boundary === "accepted-confirmed")
              return {
                commandId,
                status: "succeeded",
                outcome: { kind: "acknowledged" },
                retryable: false,
              }
            throw new Error("Provider result unavailable")
          },
          systemActor: {
            actorId,
            actorType: "system",
            requestId: "boundary-recovery",
          },
        })
        const spawn = (mode: string, now?: number) =>
          Bun.spawn([process.execPath, "src/fixtures/submit-boundary-child.ts"], {
            cwd: join(import.meta.dir, ".."),
            env: {
              ...process.env,
              QA_TASK_ID: taskId,
              QA_ACTOR_ID: actorId,
              QA_MODE: mode,
              ...(now === undefined ? {} : { QA_NOW: String(now) }),
            },
            stdout: "pipe",
            stderr: "pipe",
          })
        try {
          await client`insert into access_group (id, name) values (${groupId}, ${groupId})`
          await client`insert into app_user (id, email, password_hash, role, enabled)
          values (${actorId}, ${`${actorId}@example.test`}, 'test', 'administrator', false)`
          await client`insert into device (id, group_id, name, host, model)
          values (${deviceId}, ${groupId}, 'boundary', ${deviceId}, 'test')`
          await client`insert into execution_task (id, group_id, requester_id, device_id, idempotency_key,
          fingerprint, name, executor_key, parameters) values (${taskId}, ${groupId}, ${actorId}, ${deviceId},
          'boundary', 'boundary', 'boundary', 'device-command', '{}'::jsonb)`
          await client`insert into execution_task_step (task_id, group_id, sequence, command_idempotency_key,
          fingerprint, kind, target, parameters) values (${taskId}, ${groupId}, 0, 'boundary', 'boundary',
          'health_check', ${client.json({ deviceId })}, ${client.json({ timeoutMs: 1000 })})`
          child = spawn(boundary === "accepted-confirmed" ? "accepted" : boundary)
          watchdog = setTimeout(() => child?.kill(), 10000)
          if (!(child.stdout instanceof ReadableStream)) throw new Error("Missing child stdout")
          const reader = child.stdout.getReader()
          const output = await reader.read()
          expect(new TextDecoder().decode(output.value).trim()).toBe(
            boundary === "accepted-confirmed" ? "accepted" : boundary,
          )
          reader.releaseLock()
          child.kill()
          await child.exited
          clearTimeout(watchdog)
          const recoverAt = Date.now() + 60000
          await repository.recoverStale(recoverAt, 100)
          await repository.recoverStale(recoverAt + 60000, 100)
          if (boundary === "before-marker") {
            const scheduled = await client<
              {
                readonly deadline: Date
                readonly available: Date
                readonly run: string
                readonly step: string
              }[]
            >`select task.next_retry_at as deadline, outbox.available_at as available,
              run.status as run, step.status as step from execution_task task
              join execution_task_run run on run.task_id = task.id
              join execution_task_step step on step.task_id = task.id
              join execution_task_outbox outbox on outbox.task_id = task.id
              join execution_task_event event on event.id = outbox.event_id
              where task.id = ${taskId} and event.source = 'recovery'`
            expect(scheduled).toHaveLength(1)
            expect(scheduled[0]?.deadline.getTime()).toBe(recoverAt + 1000)
            expect(scheduled[0]?.available.getTime()).toBe(recoverAt + 1000)
            expect(scheduled[0]).toMatchObject({ run: "recovered", step: "pending" })
            const early = await repository.claimAvailable("early", recoverAt + 999, 100)
            expect(
              early.filter(
                (row) => row.aggregateId === taskId && row.payload["toStatus"] === "retry_waiting",
              ),
            ).toHaveLength(0)
            const due = await repository.claimAvailable("due", recoverAt + 1000, 100)
            expect(
              due.filter(
                (row) => row.aggregateId === taskId && row.payload["toStatus"] === "retry_waiting",
              ),
            ).toHaveLength(1)
            if (Bun.env["TASK7_QA"] === "1")
              console.log(
                "Task7 SQL restart",
                JSON.stringify({
                  run: scheduled[0]?.run,
                  step: scheduled[0]?.step,
                  deadlineMs: scheduled[0]?.deadline.getTime(),
                  availableMs: scheduled[0]?.available.getTime(),
                  earlyRetryOutbox: 0,
                  dueRetryOutbox: 1,
                }),
              )
          }
          child = spawn("resume", recoverAt + 61_000)
          watchdog = setTimeout(() => child?.kill(), 10000)
          expect(await child.exited).toBe(0)
          if (!(child.stdout instanceof ReadableStream)) throw new Error("Missing child stdout")
          const replay = await new Response(child.stdout).text()
          expect(replay.trim()).toBe(boundary === "before-marker" ? "submit" : "")
          const snapshot =
            await client`select status, next_retry_at, result from execution_task where id = ${taskId}`
          expect(snapshot[0]?.["status"]).toBe(
            boundary === "before-marker" || boundary === "accepted-confirmed"
              ? "succeeded"
              : "needs_reconciliation",
          )
          expect(queries).toBe(boundary === "before-marker" ? 0 : 1)
          expect(snapshot[0]?.["next_retry_at"]).toBeNull()
          const leases = await client`select count(*)::int as count from execution_task_device_lease
          where task_id = ${taskId} and released_at is null and recovery_reason = 'reconciliation_required'`
          expect(leases[0]?.["count"]).toBe(
            boundary === "before-marker" || boundary === "accepted-confirmed" ? 0 : 1,
          )
          console.log(
            "Task6 crash QA",
            JSON.stringify({
              boundary,
              subsequentSubmits: replay.trim() === "" ? 0 : 1,
              task: snapshot[0]?.["status"],
              quarantines: leases[0]?.["count"],
            }),
          )
        } finally {
          if (watchdog !== undefined) clearTimeout(watchdog)
          child?.kill()
          if (child !== undefined) await child.exited
          await repositoryClient.end()
          await client`delete from execution_task_device_lease where task_id = ${taskId}`
          await client`delete from execution_task_outbox where event_id in (select id from execution_task_event where actor_id = ${actorId})`
          await client`delete from execution_task_outbox where task_id = ${taskId}`
          await client`delete from execution_task_event where actor_id = ${actorId}`
          await client`delete from execution_task_event where task_id = ${taskId}`
          await client`delete from execution_task_run where task_id = ${taskId}`
          await client`delete from execution_task_step where task_id = ${taskId}`
          await client`delete from execution_task where id = ${taskId}`
          await client`delete from audit_event where actor_id = ${actorId}`
          await client`delete from device where id = ${deviceId}`
          await client`delete from app_user where id = ${actorId}`
          await client`delete from access_group where id = ${groupId}`
          await client.end()
        }
      },
    )
  }
  it.skipIf(Bun.env["TEST_DATABASE_URL"] === undefined)(
    "reclaims expired ownership and dead-letters poison work after ten deliveries",
    async () => {
      const url = Bun.env["TEST_DATABASE_URL"]
      if (url === undefined) throw new Error("TEST_DATABASE_URL is required")
      const client = postgres(url, { max: 2 })
      const groupId = crypto.randomUUID()
      const actorId = crypto.randomUUID()
      const deviceId = crypto.randomUUID()
      const taskId = crypto.randomUUID()
      const eventId = crypto.randomUUID()
      const outboxId = crypto.randomUUID()
      const repository = createPostgresWorkerRepository(client, { outboxLeaseMs: 1_000 })
      try {
        await client`insert into access_group (id, name) values (${groupId}, ${`worker-${groupId}`})`
        await client`insert into app_user (id, email, password_hash, role)
          values (${actorId}, ${`worker-${actorId}@example.test`}, 'test', 'administrator')`
        await client`insert into device (id, group_id, name, host, model)
          values (${deviceId}, ${groupId}, 'test device', ${`worker-${deviceId}`}, 'test')`
        await client`insert into execution_task
          (id, group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters)
          values (${taskId}, ${groupId}, ${actorId}, ${deviceId}, 'poison', 'poison', 'poison', 'test', '{}'::jsonb)`
        await client`insert into execution_task_event
          (id, task_id, group_id, to_status, source, actor_id)
          values (${eventId}, ${taskId}, ${groupId}, 'queued', 'submit', ${actorId})`
        await client`insert into execution_task_outbox
          (id, event_id, task_id, group_id, event_type, payload)
          values (${outboxId}, ${eventId}, ${taskId}, ${groupId}, 'execution_task.queued', ${client.json({ taskId })})`

        const started = Date.now() + 5_000
        const firstClaim = (await repository.claimAvailable("worker-a", started, 1))[0]
        expect(firstClaim?.outboxId).toBe(outboxId)
        expect(await repository.claimAvailable("worker-b", started + 999, 1)).toHaveLength(0)
        const secondClaim = (await repository.claimAvailable("worker-b", started + 1_000, 1))[0]
        expect(secondClaim?.outboxId).toBe(outboxId)
        await repository.acknowledge({
          outboxId,
          owner: "worker-a",
          claimAttempt: firstClaim?.claimAttempt ?? 0,
          now: started + 1_000,
        })
        expect(
          (await client`select status from execution_task_outbox where id = ${outboxId}`)[0]?.[
            "status"
          ],
        ).toBe("claimed")
        const thirdClaim = (await repository.claimAvailable("worker-b", started + 2_000, 1))[0]
        expect(thirdClaim?.outboxId).toBe(outboxId)
        await repository.acknowledge({
          outboxId,
          owner: "worker-b",
          claimAttempt: secondClaim?.claimAttempt ?? 0,
          now: started + 2_000,
        })
        await repository.fail(
          {
            outboxId,
            owner: "worker-b",
            claimAttempt: secondClaim?.claimAttempt ?? 0,
            now: started + 2_000,
          },
          started + 2_000,
        )
        expect(
          (await client`select status from execution_task_outbox where id = ${outboxId}`)[0]?.[
            "status"
          ],
        ).toBe("claimed")
        await repository.fail(
          {
            outboxId,
            owner: "worker-b",
            claimAttempt: thirdClaim?.claimAttempt ?? 0,
            now: started + 2_000,
          },
          started + 2_000,
        )

        for (let attempt = 4; attempt <= 10; attempt += 1) {
          expect(
            (await repository.claimAvailable("worker-b", started + 2_000, 1))[0]?.outboxId,
          ).toBe(outboxId)
          await repository.fail(
            { outboxId, owner: "worker-b", claimAttempt: attempt, now: started + 2_000 },
            started + 2_000,
          )
        }
        const rows = await client<
          {
            readonly status: string
            readonly attemptCount: number
            readonly lastError: string | null
            readonly deadLetteredAt: Date | null
          }[]
        >`select status, attempt_count as "attemptCount", last_error as "lastError",
          dead_lettered_at as "deadLetteredAt" from execution_task_outbox where id = ${outboxId}`
        expect(rows[0]).toMatchObject({
          status: "dead_letter",
          attemptCount: 10,
          lastError: "delivery_failed",
        })
        expect(rows[0]?.deadLetteredAt).toBeInstanceOf(Date)
        expect(await repository.claimAvailable("worker-c", started + 2_000, 1)).toHaveLength(0)
      } finally {
        await client`delete from execution_task_outbox where id = ${outboxId}`
        await client`delete from execution_task_event where id = ${eventId}`
        await client`delete from execution_task where id = ${taskId}`
        await client`delete from device where id = ${deviceId}`
        await client`delete from app_user where id = ${actorId}`
        await client`delete from access_group where id = ${groupId}`
        await client.end()
      }
    },
  )
})
