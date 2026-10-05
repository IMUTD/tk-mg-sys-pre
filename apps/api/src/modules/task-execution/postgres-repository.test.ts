// biome-ignore-all lint/complexity/useLiteralKeys: postgres row values are index-signature typed.
import { afterEach, describe, expect, it } from "bun:test"
import { createInMemoryDeviceAdapter, type DeviceCommandResult } from "@tk-mg/device-adapter"
import {
  createPostgresWorkerRepository,
  parseExecutableCommand,
  type TaskState,
} from "@tk-mg/task-execution"
import postgres from "postgres"
import { createTaskExecutor } from "../../../../worker/src/executor"
import { createWorkerRuntime } from "../../../../worker/src/runtime"
import { createApp } from "../../app"
import { createSqlClient } from "../../db/client"
import {
  createMigratedTestDatabase,
  getTestDatabaseUrl,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { GroupIdSchema, Permission, Role } from "../../lib/authorization"
import { PageKey } from "../../lib/pages"
import { createInMemoryAuditRepository } from "../audit/service"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import { createPostgresDeviceCommandRepository } from "../device-commands/postgres-repository"
import { CommandConflictError } from "../device-commands/repository"
import { createInMemoryDeviceRepository } from "../devices/in-memory-repository"
import { createPostgresDeviceRepository } from "../devices/postgres-repository"
import { DeviceIdSchema } from "../devices/repository"
import { createPostgresExecutionTaskRepository } from "./postgres-repository"
import { createTaskExecutionService } from "./service"

const databaseTest = hasConfiguredTestDatabase ? it : it.skip
const groupId = "11111111-1111-4111-8111-111111111111"
const userId = "22222222-2222-4222-8222-222222222222"
const deviceId = "33333333-3333-4333-8333-333333333333"
const taskId = "44444444-4444-4444-8444-444444444444"
const stepId = "55555555-5555-4555-8555-555555555555"
const commandId = "66666666-6666-4666-8666-666666666666"

let database: MigratedTestDatabase | null = null

afterEach(async () => {
  if (database !== null) {
    await database.close()
    database = null
  }
})

const actor = { actorId: userId, actorType: "user" as const, requestId: "request-1" }
const systemActor = { actorId: userId, actorType: "system" as const, requestId: "system-request" }
const command = parseExecutableCommand({
  commandId,
  idempotencyKey: "command-key",
  target: { deviceId },
  timeoutMs: 1000,
  type: "health_check",
})
const submission = {
  taskId,
  groupId,
  requesterId: userId,
  deviceId,
  idempotencyKey: "task-key",
  fingerprint: "task-fingerprint",
  name: "Execution task",
  executorKey: "device-command",
  parameters: {},
  maxAttempts: 3,
  steps: [
    {
      stepId,
      sequence: 0,
      fingerprint: "step-fingerprint",
      command,
    },
  ],
}

const getClient = () => {
  if (database === null) throw new Error("database missing")
  return database.client
}

const captureError = async (operation: () => Promise<unknown>): Promise<unknown> => {
  try {
    await operation()
  } catch (error) {
    return error
  }
  return null
}

const prepare = async (): Promise<void> => {
  if (database === null) database = await createMigratedTestDatabase()
  await database.client`insert into access_group (id, name) values (${groupId}, 'execution repository')`
  await database.client`
    insert into app_user (id, email, password_hash, role, enabled)
    values (${userId}, 'execution-repository@example.com', 'hash', ${Role.Operator}, true)
  `
  await database.client`
    insert into device (id, group_id, host, model, name, resource_count)
    values (${deviceId}, ${groupId}, 'execution-repository', 'test', 'Execution repository', 0)
  `
}

const transitionRows = async () =>
  (
    await getClient()`select
  (select jsonb_agg(t) from execution_task t) as tasks,
  (select jsonb_agg(s) from execution_task_step s) as steps,
  (select jsonb_agg(r) from execution_task_run r) as runs,
  (select count(*)::int from execution_task_event) as events,
  (select count(*)::int from execution_task_outbox) as outbox,
  (select count(*)::int from audit_event) as audits`
  )[0]

const transitionEvidence = async () =>
  (
    await getClient()`select
  (select status from execution_task where id = ${taskId}) as task,
  (select status from execution_task_step where id = ${stepId}) as step,
  (select status from execution_task_run where task_id = ${taskId} order by created_at desc limit 1) as run,
  (select jsonb_agg(jsonb_build_object('from', from_status, 'to', to_status, 'reason', reason)
    order by created_at, id) from execution_task_event where task_id = ${taskId}) as events,
  (select count(*)::int from execution_task_outbox where task_id = ${taskId}) as outbox,
  (select count(*)::int from audit_event where target = ${`execution-task:${taskId}`}) as audits`
  )[0]

describe("Task 12 terminal persistence", () => {
  const dedicatedSystemActor = {
    actorId: "77777777-7777-4777-8777-777777777777",
    actorType: "system" as const,
    requestId: "task12",
  }
  for (const implementation of ["api", "worker"] as const) {
    for (const status of ["succeeded", "failed", "timed_out", "cancelled"] as const) {
      databaseTest(
        `${implementation} projects normalized ${status} without requester audit`,
        async () => {
          await prepare()
          const client = getClient()
          await client`insert into app_user (id, email, password_hash, role, enabled)
          values (${dedicatedSystemActor.actorId}, 'system-task12@example.test', 'disabled', 'administrator', false)`
          const api = createPostgresExecutionTaskRepository(client, dedicatedSystemActor)
          const worker = createPostgresWorkerRepository(client, {
            systemActor: dedicatedSystemActor,
          })
          await api.submit(submission, actor)
          const now = Date.now()
          const claim = await worker.claimTask("owner", now, 30_000, taskId)
          if (claim === null) throw new Error("claim missing")
          await worker.claimNext(taskId, claim.runId, "owner", claim.claimToken, now)
          if (status === "cancelled") await api.requestCancel(groupId, taskId, actor, now)
          const result: DeviceCommandResult =
            status === "succeeded"
              ? {
                  commandId: command.commandId,
                  status,
                  outcome: { kind: "acknowledged" },
                  retryable: false,
                }
              : status === "cancelled"
                ? { commandId: command.commandId, status, retryable: false }
                : {
                    commandId: command.commandId,
                    status,
                    error: {
                      code: status === "timed_out" ? "timeout" : "failed",
                      message: "secret provider response",
                    },
                    retryable: false,
                  }
          expect(
            await worker.finishStep(
              taskId,
              claim.runId,
              "owner",
              claim.claimToken,
              stepId,
              status,
              result,
              status === "succeeded"
                ? undefined
                : status === "cancelled"
                  ? "cancelled"
                  : status === "timed_out"
                    ? "timeout"
                    : "failed",
              "secret provider response",
              now,
            ),
          ).toBe(true)
          const nextState = status === "timed_out" ? "timed_out" : status
          const expectedState = status === "cancelled" ? "cancel_requested" : "running"
          expect(
            await (implementation === "api"
              ? api.finishOwned(
                  taskId,
                  claim.runId,
                  claim.claimToken,
                  expectedState,
                  nextState,
                  now,
                )
              : worker.finishOwned(
                  taskId,
                  claim.runId,
                  claim.claimToken,
                  expectedState,
                  nextState,
                  now,
                )),
          ).toBe(true)
          const rows =
            await client`select task.status, task.result, task.error_code, task.error_message,
          step.result as step_result, step.error_code as step_error, event.actor_id, event.source,
          audit.actor_id as audit_actor, audit.metadata->>'actorType' as actor_type
          from execution_task task join execution_task_step step on step.task_id = task.id
          join execution_task_event event on event.task_id = task.id and event.source = 'finish'
          join audit_event audit on audit.target = ${`execution-task:${taskId}`} and audit.action = 'execution.task.finish'
          where task.id = ${taskId}`
          expect(rows).toHaveLength(1)
          expect(rows[0]?.["status"]).toBe(nextState)
          expect(rows[0]?.["result"]).toEqual(
            status === "succeeded" ? rows[0]?.["step_result"] : null,
          )
          expect(rows[0]?.["error_code"]).toBe(
            status === "succeeded"
              ? null
              : status === "cancelled"
                ? "cancelled"
                : status === "timed_out"
                  ? "timeout"
                  : "failed",
          )
          expect(rows[0]?.["error_message"]).toBe(
            status === "succeeded"
              ? null
              : `Device command error (${status === "cancelled" ? "cancelled" : status === "timed_out" ? "timeout" : "failed"})`,
          )
          expect(rows[0]?.["actor_id"]).toBe(dedicatedSystemActor.actorId)
          expect(rows[0]?.["audit_actor"]).toBe(dedicatedSystemActor.actorId)
          expect(rows[0]?.["actor_type"]).toBe("system")
          expect(JSON.stringify(rows[0])).not.toContain("secret provider response")
          if (Bun.env["TASK12_QA"] === "1")
            console.log(
              "Task12 terminal SQL",
              JSON.stringify({
                implementation,
                status: rows[0]?.["status"],
                taskResultStatus: rows[0]?.["result"]?.["status"] ?? null,
                stepResultStatus: rows[0]?.["step_result"]?.["status"] ?? null,
                errorCode: rows[0]?.["error_code"],
                errorMessage: rows[0]?.["error_message"],
                eventSource: rows[0]?.["source"],
                eventActor: rows[0]?.["actor_id"],
                auditActor: rows[0]?.["audit_actor"],
                auditActorType: rows[0]?.["actor_type"],
              }),
            )
          const snapshot = await transitionRows()
          expect(
            await api.finishOwned(
              taskId,
              claim.runId,
              claim.claimToken,
              expectedState,
              nextState,
              now,
            ),
          ).toBe(false)
          expect(await transitionRows()).toEqual(snapshot)
        },
      )
    }
  }

  databaseTest("API retry uses worker deadline and system identity", async () => {
    await prepare()
    await getClient()`insert into app_user (id, email, password_hash, role, enabled)
      values (${dedicatedSystemActor.actorId}, 'system-task12@example.test', 'disabled', 'administrator', false)`
    const api = createPostgresExecutionTaskRepository(getClient(), dedicatedSystemActor, {
      minimumDelayMs: 4_000,
      random: () => 0,
    })
    await api.submit(submission, actor)
    const now = Date.now()
    const claim = await api.claimTask("owner", now, 30_000)
    if (claim === null) throw new Error("claim missing")
    const before = await transitionRows()
    expect(
      await api.finishOwned(
        taskId,
        claim.runId,
        claim.claimToken,
        "dispatching",
        "retry_waiting",
        now,
        now,
      ),
    ).toBe(false)
    expect(
      await api.finishOwned(
        taskId,
        claim.runId,
        claim.claimToken,
        "dispatching",
        "retry_waiting",
        now,
        now + 120_001,
      ),
    ).toBe(false)
    expect(await transitionRows()).toEqual(before)
    expect(
      await api.finishOwned(
        taskId,
        claim.runId,
        claim.claimToken,
        "dispatching",
        "retry_waiting",
        now,
      ),
    ).toBe(true)
    const rows =
      await getClient()`select task.status, task.next_retry_at, task.retry_count, run.status as run,
      event.actor_id, outbox.available_at from execution_task task
      join execution_task_run run on run.id = ${claim.runId}
      join execution_task_event event on event.task_id = task.id and event.to_status = 'retry_waiting'
      join execution_task_outbox outbox on outbox.event_id = event.id where task.id = ${taskId}`
    expect(rows[0]?.["status"]).toBe("retry_waiting")
    expect(rows[0]?.["run"]).toBe("failed")
    expect(rows[0]?.["retry_count"]).toBe(1)
    expect(rows[0]?.["next_retry_at"]?.getTime()).toBe(now + 4_000)
    expect(rows[0]?.["available_at"]?.getTime()).toBe(now + 4_000)
    expect(rows[0]?.["actor_id"]).toBe(dedicatedSystemActor.actorId)
  })

  databaseTest("API rejects premature retry and resolves exhausted attempts", async () => {
    await prepare()
    const api = createPostgresExecutionTaskRepository(getClient(), systemActor, {
      minimumDelayMs: 4_000,
      random: () => 0,
    })
    await api.submit({ ...submission, maxAttempts: 1 }, actor)
    const now = Date.now()
    const claim = await api.claimTask("owner", now, 30_000)
    if (claim === null) throw new Error("claim missing")
    const before = await transitionRows()
    expect(
      await api.finishOwned(taskId, claim.runId, "stale", "dispatching", "retry_waiting", now),
    ).toBe(false)
    expect(
      await api.finishOwned(taskId, claim.runId, claim.claimToken, "dispatching", "succeeded", now),
    ).toBe(false)
    expect(await transitionRows()).toEqual(before)
    expect(
      await api.finishOwned(
        taskId,
        claim.runId,
        claim.claimToken,
        "dispatching",
        "retry_waiting",
        now,
      ),
    ).toBe(true)
    const rows = await getClient()`select task.status, task.retry_count, task.terminal_reason,
      task.next_retry_at, task.error_code, run.status as run, event.actor_id
      from execution_task task join execution_task_run run on run.id = ${claim.runId}
      join execution_task_event event on event.task_id = task.id and event.source = 'finish'
      where task.id = ${taskId}`
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      status: "failed",
      retry_count: 1,
      terminal_reason: "retry_exhausted",
      next_retry_at: null,
      error_code: "unknown",
      run: "failed",
      actor_id: systemActor.actorId,
    })
    const terminal = await transitionRows()
    expect(
      await api.finishOwned(taskId, claim.runId, claim.claimToken, "failed", "failed", now),
    ).toBe(false)
    expect(await transitionRows()).toEqual(terminal)
  })

  for (const implementation of ["api", "worker"] as const) {
    databaseTest(`${implementation} recovers an unmarked lease with equivalent rows`, async () => {
      await prepare()
      const api = createPostgresExecutionTaskRepository(getClient(), systemActor, {
        minimumDelayMs: 4_000,
        random: () => 0,
      })
      const worker = createPostgresWorkerRepository(getClient(), {
        systemActor,
        minimumRetryDelayMs: 4_000,
        random: () => 0,
      })
      await api.submit(submission, actor)
      const now = Date.now()
      const claim = await worker.claimTask("owner", now, 1_000, taskId)
      if (claim === null) throw new Error("claim missing")
      await worker.claimNext(taskId, claim.runId, "owner", claim.claimToken, now)
      const recoveredAt = now + 1_000
      await (implementation === "api" ? api : worker).recoverStale(recoveredAt, 1)
      const rows = await getClient()`select task.status, task.retry_count, task.next_retry_at,
        task.result, task.error_code, step.status as step, run.status as run,
        event.source, event.reason, event.actor_id, outbox.available_at,
        audit.actor_id as audit_actor, audit.metadata->>'reason' as audit_reason
        from execution_task task join execution_task_step step on step.task_id = task.id
        join execution_task_run run on run.id = ${claim.runId}
        join execution_task_event event on event.task_id = task.id and event.source = 'recovery'
        join execution_task_outbox outbox on outbox.event_id = event.id
        join audit_event audit on audit.target = ${`execution-task:${taskId}`}
          and audit.action = 'execution.task.recover' where task.id = ${taskId}`
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        status: "retry_waiting",
        retry_count: 1,
        result: null,
        error_code: null,
        step: "pending",
        run: "recovered",
        source: "recovery",
        reason: "lease_expired",
        actor_id: systemActor.actorId,
        audit_actor: systemActor.actorId,
        audit_reason: "lease_expired",
      })
      expect(rows[0]?.["next_retry_at"]?.getTime()).toBe(recoveredAt + 4_000)
      expect(rows[0]?.["available_at"]?.getTime()).toBe(recoveredAt + 4_000)
      const snapshot = await transitionRows()
      await (implementation === "api" ? api : worker).recoverStale(recoveredAt, 1)
      expect(await transitionRows()).toEqual(snapshot)
    })
    databaseTest(
      `${implementation} recovers confirmed success without raw provider fields`,
      async () => {
        await prepare()
        const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
        const worker = createPostgresWorkerRepository(getClient(), { systemActor })
        await api.submit(submission, actor)
        const now = Date.now()
        const claim = await worker.claimTask("owner", now, 1_000, taskId)
        if (claim === null) throw new Error("claim missing")
        await worker.claimNext(taskId, claim.runId, "owner", claim.claimToken, now)
        expect(
          await worker.finishStep(
            taskId,
            claim.runId,
            "owner",
            claim.claimToken,
            stepId,
            "succeeded",
            {
              commandId: command.commandId,
              status: "succeeded",
              retryable: false,
              outcome: {
                kind: "artifact",
                reference: { kind: "artifact", artifactId: "raw-secret" },
              },
            },
            undefined,
            undefined,
            now,
          ),
        ).toBe(true)
        await (implementation === "api" ? api : worker).recoverStale(now + 1_000, 1)
        const rows = await getClient()`select task.status, task.result, task.error_code,
        step.result as step_result, run.status as run, event.reason, event.actor_id,
        audit.actor_id as audit_actor from execution_task task
        join execution_task_step step on step.task_id = task.id
        join execution_task_run run on run.id = ${claim.runId}
        join execution_task_event event on event.task_id = task.id and event.source = 'recovery'
        join audit_event audit on audit.target = ${`execution-task:${taskId}`}
          and audit.action = 'execution.task.recover' where task.id = ${taskId}`
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
          status: "succeeded",
          result: rows[0]?.["step_result"],
          error_code: null,
          run: "recovered",
          reason: "step_succeeded",
          actor_id: systemActor.actorId,
          audit_actor: systemActor.actorId,
        })
        expect(JSON.stringify(rows)).not.toContain("raw-secret")
      },
    )
  }

  for (const implementation of ["api", "worker"] as const) {
    databaseTest(`${implementation} rejects malformed success without partial writes`, async () => {
      await prepare()
      const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
      await api.submit(submission, actor)
      const now = Date.now()
      const claim = await api.claimTask("owner", now, 30_000)
      if (claim === null) throw new Error("claim missing")
      await api.claimNext(taskId, claim.runId, "owner", claim.claimToken, now)
      await getClient()`update execution_task_step set status = 'succeeded',
      result = ${getClient().json({
        commandId,
        status: "succeeded",
        retryable: false,
        outcome: { kind: "acknowledged" },
        secret: "raw-secret",
      })} where id = ${stepId}`
      const before = await transitionRows()
      const worker = createPostgresWorkerRepository(getClient(), { systemActor })
      expect(
        await (implementation === "api"
          ? api.finishOwned(taskId, claim.runId, claim.claimToken, "running", "succeeded", now)
          : worker.finishOwned(taskId, claim.runId, claim.claimToken, "running", "succeeded", now)),
      ).toBe(false)
      expect(await transitionRows()).toEqual(before)
    })
  }

  databaseTest("HTTP detail and list omit persisted task and step results and errors", async () => {
    await prepare()
    const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
    await api.submit(submission, actor)
    const now = Date.now()
    const claim = await api.claimTask("owner", now, 30_000)
    if (claim === null) throw new Error("claim missing")
    await api.claimNext(taskId, claim.runId, "owner", claim.claimToken, now)
    const worker = createPostgresWorkerRepository(getClient(), { systemActor })
    expect(
      await worker.finishStep(
        taskId,
        claim.runId,
        "owner",
        claim.claimToken,
        stepId,
        "failed",
        {
          commandId: command.commandId,
          status: "failed",
          retryable: false,
          error: { code: "failed", message: "provider-secret" },
        },
        "failed",
        "provider-secret",
        now,
      ),
    ).toBe(true)
    expect(
      await api.finishOwned(taskId, claim.runId, claim.claimToken, "running", "failed", now),
    ).toBe(true)
    const auth = createAuthService(
      createInMemoryAuthRepository([
        {
          id: userId,
          email: "viewer@example.test",
          password: "test",
          role: Role.Administrator,
          groupIds: [groupId],
          permissions: [Permission.OperationsRead],
          pages: [{ key: PageKey.Tasks, canView: true, canDelete: false }],
        },
      ]),
      async (password, hash) => password === hash,
    )
    const app = createApp({
      authService: auth,
      auditRepository: createInMemoryAuditRepository(),
      taskExecutionService: createTaskExecutionService({
        repository: api,
        deviceRepository: createInMemoryDeviceRepository([]),
      }),
    })
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "viewer@example.test", password: "test" }),
    })
    const cookie = login.headers.get("set-cookie") ?? ""
    expect(login.status).toBe(200)
    for (const path of [`/api/groups/${groupId}/tasks/${taskId}`, `/api/groups/${groupId}/tasks`]) {
      const response = await app.request(path, { headers: { Cookie: cookie } })
      expect(response.status).toBe(200)
      const body: unknown = await response.json()
      const serialized = JSON.stringify(body)
      expect(serialized).not.toContain("result")
      expect(serialized).not.toContain("errorCode")
      expect(serialized).not.toContain("errorMessage")
      expect(serialized).not.toContain("provider-secret")
    }
    const stored = (
      await getClient()`select task.error_code, step.error_code as step_error
      from execution_task task join execution_task_step step on step.task_id = task.id
      where task.id = ${taskId}`
    )[0]
    expect(stored).toMatchObject({ error_code: "failed", step_error: "failed" })
  })
})

describe("Task 7 persisted retry eligibility", () => {
  databaseTest("API stale recovery persists the same eligibility on task and outbox", async () => {
    await prepare()
    const writer = createSqlClient(getTestDatabaseUrl())
    const reader = createSqlClient(getTestDatabaseUrl())
    try {
      const api = createPostgresExecutionTaskRepository(writer, systemActor, {
        minimumDelayMs: 4_000,
        random: () => 0,
      })
      await api.submit(submission, actor)
      const now = Date.now() + 5_000
      const claim = await api.claimTask("api-a", now, 1_000)
      if (claim === null) throw new Error("initial claim missing")
      await api.recoverStale(now + 1_000, 10)
      const rows = await reader`select task.status, task.next_retry_at, outbox.available_at,
        run.status as run, step.status as step
        from execution_task task join execution_task_run run on run.id = ${claim.runId}
        join execution_task_step step on step.task_id = task.id
        join execution_task_outbox outbox on outbox.task_id = task.id
        join execution_task_event event on event.id = outbox.event_id
        where task.id = ${taskId} and event.source = 'recovery'`
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ status: "retry_waiting", run: "recovered", step: "pending" })
      expect(rows[0]?.["next_retry_at"]?.getTime()).toBe(now + 5_000)
      expect(rows[0]?.["available_at"]?.getTime()).toBe(now + 5_000)
      expect(await api.claimTask("api-b", now + 4_999, 1_000)).toBeNull()
      expect(await api.claimTask("api-b", now + 5_000, 1_000)).not.toBeNull()
      if (Bun.env["TASK7_QA"] === "1")
        console.log(
          "Task7 SQL API recovery",
          JSON.stringify({
            task: rows[0]?.["status"],
            run: rows[0]?.["run"],
            step: rows[0]?.["step"],
            deadlineMs: rows[0]?.["next_retry_at"]?.getTime(),
            availableMs: rows[0]?.["available_at"]?.getTime(),
            earlyClaim: false,
            dueClaim: true,
          }),
        )
    } finally {
      await writer.end()
      await reader.end()
    }
  })

  databaseTest("exhaustion is terminal and a marked step cannot schedule a retry", async () => {
    await prepare()
    const client = createSqlClient(getTestDatabaseUrl())
    try {
      const api = createPostgresExecutionTaskRepository(client, systemActor)
      const worker = createPostgresWorkerRepository(client, { systemActor })
      await api.submit({ ...submission, maxAttempts: 1 }, actor)
      const now = Date.now() + 5_000
      const claim = await worker.claimTask("worker-a", now, 30_000, taskId)
      if (claim === null) throw new Error("initial claim missing")
      expect(
        await worker.finishOwned(
          taskId,
          claim.runId,
          claim.claimToken,
          "dispatching",
          "retry_waiting",
          now,
          now + 1_000,
        ),
      ).toBe(true)
      expect(
        (
          await getClient()`select status, next_retry_at from execution_task where id = ${taskId}`
        )[0],
      ).toMatchObject({ status: "failed", next_retry_at: null })
      expect(
        (
          await getClient()`select count(*)::int as count from execution_task_event
        where task_id = ${taskId} and to_status = 'retry_waiting'`
        )[0]?.["count"],
      ).toBe(0)

      await getClient()`update execution_task set status = 'dispatching', retry_count = 0 where id = ${taskId}`
      await getClient()`update execution_task_run set status = 'running', step_id = ${stepId}
        where id = ${claim.runId}`
      await getClient()`update execution_task_step set status = 'claimed', submit_started_at = ${new Date(now)}
        where id = ${stepId}`
      const before = await transitionRows()
      expect(
        await worker.finishOwned(
          taskId,
          claim.runId,
          claim.claimToken,
          "dispatching",
          "retry_waiting",
          now,
          now + 1_000,
        ),
      ).toBe(false)
      expect(await transitionRows()).toEqual(before)
    } finally {
      await client.end()
    }
  })
  databaseTest("worker fences retry claims and executable outbox until the deadline", async () => {
    await prepare()
    const clientA = createSqlClient(getTestDatabaseUrl())
    const clientB = createSqlClient(getTestDatabaseUrl())
    try {
      const api = createPostgresExecutionTaskRepository(clientA, systemActor)
      const workerA = createPostgresWorkerRepository(clientA, { systemActor })
      const workerB = createPostgresWorkerRepository(clientB, { systemActor })
      await api.submit(submission, actor)
      const now = Date.now() + 5_000
      const claim = await workerA.claimTask("worker-a", now, 30_000, taskId)
      if (claim === null) throw new Error("initial claim missing")
      await getClient()`update execution_task_outbox set status = 'delivered' where task_id = ${taskId}`
      const due = now + 4_321
      const before = await transitionRows()
      expect(
        await workerA.finishOwned(
          taskId,
          claim.runId,
          claim.claimToken,
          "dispatching",
          "retry_waiting",
          now,
          now,
        ),
      ).toBe(false)
      expect(
        await workerA.finishOwned(
          taskId,
          claim.runId,
          claim.claimToken,
          "dispatching",
          "retry_waiting",
          now,
          now + 120_001,
        ),
      ).toBe(false)
      expect(await transitionRows()).toEqual(before)
      expect(
        await workerA.finishOwned(
          taskId,
          claim.runId,
          claim.claimToken,
          "dispatching",
          "retry_waiting",
          now,
          due,
        ),
      ).toBe(true)
      const rows = await clientB<
        {
          readonly state: string
          readonly deadline: Date | null
          readonly available: Date
          readonly run: string
          readonly step: string
          readonly events: number
          readonly audits: number
        }[]
      >`select task.status as state, task.next_retry_at as deadline, outbox.available_at as available,
          run.status as run, step.status as step,
          (select count(*)::int from execution_task_event where task_id = ${taskId} and to_status = 'retry_waiting') as events,
          (select count(*)::int from audit_event where target = ${`execution-task:${taskId}`}
            and action = 'execution.task.finish') as audits
          from execution_task task join execution_task_run run on run.id = ${claim.runId}
          join execution_task_step step on step.id = ${stepId}
          join execution_task_outbox outbox on outbox.task_id = task.id
          join execution_task_event event on event.id = outbox.event_id
          where task.id = ${taskId} and event.to_status = 'retry_waiting'`
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        state: "retry_waiting",
        run: "failed",
        step: "pending",
        events: 1,
        audits: 1,
      })
      expect(rows[0]?.deadline?.getTime()).toBe(due)
      expect(rows[0]?.available.getTime()).toBe(due)
      expect(await workerB.claimTask("worker-b", due - 1, 30_000, taskId)).toBeNull()
      expect(await workerB.claimAvailable("worker-b", due - 1, 10)).toHaveLength(0)
      const [first, second] = await Promise.all([
        workerA.claimTask("worker-a", due, 30_000, taskId),
        workerB.claimTask("worker-b", due, 30_000, taskId),
      ])
      expect([first, second].filter((value) => value !== null)).toHaveLength(1)
      const dueOutbox = await workerB.claimAvailable("worker-b", due, 10)
      expect(
        dueOutbox.filter((value) => value.payload["toStatus"] === "retry_waiting"),
      ).toHaveLength(1)
      if (Bun.env["TASK7_QA"] === "1")
        console.log(
          "Task7 SQL worker retry",
          JSON.stringify({
            task: rows[0]?.state,
            run: rows[0]?.run,
            step: rows[0]?.step,
            deadlineMs: rows[0]?.deadline?.getTime(),
            availableMs: rows[0]?.available.getTime(),
            retryEvents: rows[0]?.events,
            finishAudits: rows[0]?.audits,
            earlyClaim: false,
            concurrentDueClaims: 1,
            dueOutbox: 1,
          }),
        )
    } finally {
      await clientA.end()
      await clientB.end()
    }
  })

  databaseTest(
    "stale pre-submit recovery schedules one retry but a marked step remains quarantined",
    async () => {
      await prepare()
      const firstClient = createSqlClient(getTestDatabaseUrl())
      const secondClient = createSqlClient(getTestDatabaseUrl())
      try {
        const api = createPostgresExecutionTaskRepository(firstClient, systemActor)
        const worker = createPostgresWorkerRepository(firstClient, {
          systemActor,
          minimumRetryDelayMs: 4_000,
          random: () => 0,
        })
        await api.submit(submission, actor)
        const now = Date.now() + 5_000
        const claim = await worker.claimTask("worker-a", now, 1_000, taskId)
        if (claim === null) throw new Error("initial claim missing")
        expect(
          await worker.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, now),
        ).not.toBeNull()
        await worker.recoverStale(now + 1_000, 10)
        const recovered =
          await secondClient`select task.status, task.next_retry_at, step.status as step,
        run.status as run, outbox.available_at
        from execution_task task join execution_task_step step on step.task_id = task.id
        join execution_task_run run on run.id = ${claim.runId}
        join execution_task_outbox outbox on outbox.task_id = task.id
        join execution_task_event event on event.id = outbox.event_id
        where task.id = ${taskId} and event.source = 'recovery'`
        expect(recovered).toHaveLength(1)
        expect(recovered[0]?.["next_retry_at"]?.getTime()).toBe(now + 5_000)
        expect(recovered[0]?.["available_at"]?.getTime()).toBe(now + 5_000)
        expect(recovered[0]).toMatchObject({
          status: "retry_waiting",
          step: "pending",
          run: "recovered",
        })
        expect(await worker.claimTask("early", now + 4_999, 1_000, taskId)).toBeNull()
        const next = await worker.claimTask("due", now + 5_000, 1_000, taskId)
        if (next === null) throw new Error("due claim missing")
        await worker.claimNext(taskId, next.runId, "due", next.claimToken, now + 5_000)
        await getClient()`update execution_task_step set submit_started_at = ${new Date(now + 5_000)} where id = ${stepId}`
        await worker.recoverStale(now + 6_000, 10)
        expect(
          (
            await secondClient`select status, next_retry_at from execution_task where id = ${taskId}`
          )[0],
        ).toMatchObject({ status: "needs_reconciliation", next_retry_at: null })
        expect(await worker.claimTask("third", now + 30_000, 1_000, taskId)).toBeNull()
      } finally {
        await firstClient.end()
        await secondClient.end()
      }
    },
  )
})

describe("Task 6 provider boundary", () => {
  for (const implementation of ["api", "worker"] as const) {
    for (const corruption of ["executor", "kind", "target"] as const) {
      databaseTest(
        `${implementation} handles retry_waiting invalid ${corruption} without poison delivery`,
        async () => {
          await prepare()
          const client = createSqlClient(getTestDatabaseUrl())
          try {
            const api = createPostgresExecutionTaskRepository(client, systemActor)
            const worker = createPostgresWorkerRepository(client, { systemActor })
            await api.submit(submission, actor)
            const now = Date.now() + 1000
            const claim = await worker.claimTask("retry-owner", now, 30_000)
            if (claim === null) throw new Error("Missing initial claim")
            expect(
              await worker.finishOwned(
                taskId,
                claim.runId,
                claim.claimToken,
                "dispatching",
                "retry_waiting",
                now,
                now + 1_000,
              ),
            ).toBe(true)
            switch (corruption) {
              case "executor":
                await getClient()`update execution_task set executor_key = 'unsupported' where id = ${taskId}`
                break
              case "kind":
                await getClient()`update execution_task_step set kind = 'unsupported' where id = ${stepId}`
                break
              case "target":
                await getClient()`update execution_task_step set target = '[]'::jsonb where id = ${stepId}`
                break
            }
            await getClient()`update execution_task_outbox set status = 'delivered' where task_id = ${taskId}`
            await getClient()`update execution_task_outbox set status = 'pending'
            where task_id = ${taskId} and event_type = 'execution_task.queued'`
            const before = await transitionRows()
            let providerCalls = 0
            const failures: unknown[] = []
            const adapter = createInMemoryDeviceAdapter()
            const config = {
              databaseUrl: getTestDatabaseUrl(),
              systemActorId: userId,
              workerId: "invalid-row-worker",
              concurrency: 1,
              pollIntervalMs: 1000,
              outboxBatchSize: 10,
              recoveryBatchSize: 10,
              leaseMs: 30000,
              heartbeatMs: 10000,
              retryDelayMs: 0,
            }
            const runtime = createWorkerRuntime({
              repository: worker,
              config,
              clock: () => now + 1_000,
              executor: createTaskExecutor({
                repository: worker,
                config,
                clock: () => now + 1_000,
                adapter: {
                  ...adapter,
                  health: async (target) => {
                    providerCalls += 1
                    return adapter.health(target)
                  },
                  submit: async (command) => {
                    providerCalls += 1
                    return adapter.submit(command)
                  },
                },
              }),
              onFailure: (error) => failures.push(error),
            })
            if (implementation === "api")
              expect(await api.claimTask("api-owner", now + 1_000, 30000)).toBeNull()
            else await runtime.runCycle()
            expect(failures).toEqual([])
            expect(providerCalls).toBe(0)
            expect(
              (
                await getClient()`select status, terminal_reason, next_retry_at from execution_task where id = ${taskId}`
              )[0],
            ).toMatchObject({
              status: "failed",
              terminal_reason: "invalid_persisted_validation",
              next_retry_at: null,
            })
            const after = await transitionRows()
            expect(after?.["events"]).toBe(Number(before?.["events"]) + 1)
            expect(after?.["outbox"]).toBe(Number(before?.["outbox"]) + 1)
            expect(after?.["audits"]).toBe(Number(before?.["audits"]) + 1)
            expect(after?.["runs"]).toEqual(before?.["runs"])
            expect(
              (
                await getClient()`select from_status, to_status, reason from execution_task_event
            where task_id = ${taskId} and reason = 'invalid_persisted_validation'`
              )[0],
            ).toMatchObject({
              from_status: "retry_waiting",
              to_status: "failed",
              reason: "invalid_persisted_validation",
            })
            await runtime.runCycle()
            await runtime.runCycle()
            await runtime.stop()
            expect(failures).toEqual([])
            expect(providerCalls).toBe(0)
            expect(
              (
                await getClient()`select status, attempt_count, last_error from execution_task_outbox
            where task_id = ${taskId} and event_type = 'execution_task.queued'`
              )[0],
            ).toMatchObject({ status: "delivered", attempt_count: 1, last_error: null })
            expect((await transitionRows())?.["audits"]).toBe(after?.["audits"])
          } finally {
            await client.end()
          }
        },
      )
    }
  }
  for (const resolution of ["succeeded", "failed", "cancelled"] as const) {
    databaseTest(
      `atomically reconciles ${resolution} with null result and idempotent audit`,
      async () => {
        await prepare()
        const client = createSqlClient(getTestDatabaseUrl())
        try {
          const api = createPostgresExecutionTaskRepository(client, systemActor)
          await api.submit(submission, actor)
          const now = Date.now()
          const claim = await api.claimTask("worker-a", now, 30_000)
          if (claim === null) throw new Error("claim missing")
          await api.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, now)
          const priorId = crypto.randomUUID()
          await getClient()`update execution_task_step set sequence = 1 where id = ${stepId}`
          await getClient()`insert into execution_task_step
            (id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters, status, result)
            values (${priorId}, ${taskId}, ${groupId}, 0, 'prior', 'prior', 'health_check',
              ${getClient().json({ deviceId })}, ${getClient().json({ timeoutMs: 1000 })}, 'succeeded',
              ${getClient().json({ status: "succeeded", outcome: { kind: "acknowledged" } })})`
          const prior = (
            await getClient()`select status, result from execution_task_step where id = ${priorId}`
          )[0]
          const queuedCommandId = crypto.randomUUID()
          await getClient()`insert into device_command
            (id, group_id, device_id, requester_id, idempotency_key, fingerprint, kind, parameters, timeout_ms, status)
            values (${queuedCommandId}, ${groupId}, ${deviceId}, ${userId}, 'pre-quarantine', 'pre-quarantine', 'health_check', '{}', 1000, 'queued')`
          await getClient()`update execution_task set status = 'needs_reconciliation' where id = ${taskId}`
          await getClient()`update execution_task_step set submit_started_at = now() where id = ${stepId}`
          await getClient()`update execution_task_run set status = 'needs_reconciliation' where id = ${claim.runId}`
          await getClient()`insert into execution_task_device_lease
          (task_id, group_id, device_id, lease_token, expires_at, recovery_reason)
          values (${taskId}, ${groupId}, ${deviceId}, 'lease', now() - interval '1 hour', 'reconciliation_required')`
          const input = { taskId, groupId, resolution, evidenceHash: "a".repeat(64), actor, now }
          const before = await transitionRows()
          await expect(
            api.reconcile({ ...input, actor: { ...actor, actorId: crypto.randomUUID() } }),
          ).rejects.toThrow()
          expect(await transitionRows()).toEqual(before)
          const competing = createSqlClient(getTestDatabaseUrl())
          try {
            const direct = createPostgresDeviceCommandRepository(competing)
            expect(await direct.claim(queuedCommandId)).toBeNull()
            const [first, second, commandClaim] = await Promise.all([
              api.reconcile(input),
              createPostgresExecutionTaskRepository(competing, systemActor).reconcile(input),
              direct.claim(queuedCommandId),
            ])
            expect([first, second].sort()).toEqual(["duplicate", "resolved"])
            if (commandClaim !== null) expect(commandClaim.status).toBe("running")
            expect((await api.get(groupId, taskId))?.state).toBe(resolution)
          } finally {
            await competing.end()
          }
          expect(await api.reconcile(input)).toBe("duplicate")
          expect(
            (
              await getClient()`select status, result from execution_task_step where id = ${priorId}`
            )[0],
          ).toEqual(prior)
          expect(
            await api.reconcile({
              ...input,
              resolution: resolution === "failed" ? "cancelled" : "failed",
            }),
          ).toBe("conflict")
          expect(
            (
              await getClient()`select status, result, terminal_reason, error_code, error_message
                from execution_task where id = ${taskId}`
            )[0],
          ).toMatchObject({
            status: resolution,
            result: null,
            terminal_reason: "operator_verified",
            error_code: null,
            error_message: null,
          })
          expect(
            (
              await getClient()`select status, result from execution_task_step where id = ${stepId}`
            )[0],
          ).toMatchObject({ status: resolution, result: null })
          expect(
            (
              await getClient()`select count(*)::int as count from execution_task_device_lease where released_at is null`
            )[0]?.["count"],
          ).toBe(0)
          expect(
            (
              await getClient()`select count(*)::int as count from audit_event where action = 'execution.task.reconcile'
                and actor_id = ${actor.actorId} and metadata->>'reason' = 'operator_verified'
                and metadata->>'evidenceHash' = ${input.evidenceHash}`
            )[0]?.["count"],
          ).toBe(1)
          expect(
            (
              await getClient()`select count(*)::int as count from execution_task_event
                where task_id = ${taskId} and source = 'recovery' and reason = 'operator_verified'
                  and actor_id = ${actor.actorId}`
            )[0]?.["count"],
          ).toBe(1)
        } finally {
          await client.end()
        }
      },
    )
  }
  databaseTest(
    "rejects success on a non-last ambiguous step without releasing quarantine",
    async () => {
      await prepare()
      const client = createSqlClient(getTestDatabaseUrl())
      try {
        const api = createPostgresExecutionTaskRepository(client, systemActor)
        await api.submit(
          {
            ...submission,
            steps: [
              ...submission.steps,
              {
                stepId: crypto.randomUUID(),
                sequence: 1,
                fingerprint: "next",
                command: {
                  ...command,
                  commandId: parseExecutableCommand({ ...command, commandId: crypto.randomUUID() })
                    .commandId,
                },
              },
            ],
          },
          actor,
        )
        const now = Date.now()
        const claim = await api.claimTask("worker-a", now, 30_000)
        if (claim === null) throw new Error("missing claim")
        await api.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, now)
        await getClient()`update execution_task set status = 'needs_reconciliation' where id = ${taskId}`
        await getClient()`update execution_task_step set submit_started_at = now() where id = ${stepId}`
        await getClient()`update execution_task_run set status = 'needs_reconciliation' where id = ${claim.runId}`
        const before = await transitionRows()
        expect(
          await api.reconcile({
            taskId,
            groupId,
            resolution: "succeeded",
            evidenceHash: "a".repeat(64),
            actor,
            now,
          }),
        ).toBe("conflict")
        expect(await transitionRows()).toEqual(before)
      } finally {
        await client.end()
      }
    },
  )
  for (const corruption of ["executor", "kind", "target", "parameters", "mixed-target"] as const) {
    databaseTest(`fails malformed persisted ${corruption} before claim parsing`, async () => {
      await prepare()
      const client = createSqlClient(getTestDatabaseUrl())
      try {
        const api = createPostgresExecutionTaskRepository(client, systemActor)
        await api.submit(submission, actor)
        switch (corruption) {
          case "executor":
            await getClient()`update execution_task set executor_key = 'unsupported' where id = ${taskId}`
            break
          case "kind":
            await getClient()`update execution_task_step set kind = 'unsupported' where id = ${stepId}`
            break
          case "target":
            await getClient()`update execution_task_step set target = '[]'::jsonb where id = ${stepId}`
            break
          case "parameters":
            await getClient()`update execution_task_step set parameters = '"invalid"'::jsonb where id = ${stepId}`
            break
          case "mixed-target":
            await getClient()`insert into execution_task_step
              (task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters)
              values (${taskId}, ${groupId}, 1, 'mixed', 'mixed', 'health_check',
                ${getClient().json({ deviceId, instanceId: crypto.randomUUID() })},
                ${getClient().json({ timeoutMs: 1000 })})`
            break
        }
        const worker = createPostgresWorkerRepository(client, { systemActor })
        expect(await worker.claimTask("worker-a", Date.now(), 30_000)).toBeNull()
        expect(
          (await getClient()`select status from execution_task where id = ${taskId}`)[0]?.[
            "status"
          ],
        ).toBe("failed")
        expect(
          (await getClient()`select count(*)::int as count from execution_task_run`)[0]?.["count"],
        ).toBe(0)
        expect(
          (
            await getClient()`select count(*)::int as count from audit_event where action = 'execution.task.invalid'`
          )[0]?.["count"],
        ).toBe(1)
      } finally {
        await client.end()
      }
    })
  }

  databaseTest(
    "commits a fenced marker and preserves quarantine across repeated expired recovery",
    async () => {
      await prepare()
      const client = createSqlClient(getTestDatabaseUrl())
      let server: ReturnType<typeof Bun.serve> | undefined
      try {
        const api = createPostgresExecutionTaskRepository(client, systemActor)
        const worker = createPostgresWorkerRepository(client, { systemActor })
        await api.submit(submission, actor)
        const now = Date.now()
        const claim = await worker.claimTask("worker-a", now, 30_000)
        if (claim === null) throw new Error("missing claim")
        const leaseId = crypto.randomUUID()
        await worker.acquireDeviceLease({
          leaseId,
          taskId,
          groupId,
          deviceId,
          leaseToken: "lease",
          workerId: "worker-a",
          expiresAt: now + 30_000,
        })
        await worker.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, now)
        const boundary = {
          taskId,
          runId: claim.runId,
          claimToken: claim.claimToken,
          stepId,
          owner: "worker-a",
          leaseId,
          leaseToken: "lease",
          now,
        }
        expect(await worker.markSubmitStarted({ ...boundary, claimToken: "stale" })).toBe(false)
        expect(await worker.markSubmitStarted(boundary)).toBe(true)
        expect(
          (
            await getClient()`select submit_started_at from execution_task_step where id = ${stepId}`
          )[0]?.["submit_started_at"],
        ).toBeInstanceOf(Date)
        await worker.recoverStale(now + 30_001, 10)
        await worker.recoverStale(now + 60_001, 10)
        expect((await api.get(groupId, taskId))?.state).toBe("needs_reconciliation")
        expect(await worker.claimTask("worker-b", now + 60_001, 30_000)).toBeNull()
        expect(await worker.releaseDeviceLease(leaseId, "lease", "finished")).toBe(false)
        const deletionClient = createSqlClient(getTestDatabaseUrl())
        try {
          await expect(
            createPostgresDeviceRepository(deletionClient).deleteDevice(
              GroupIdSchema.parse(groupId),
              DeviceIdSchema.parse(deviceId),
            ),
          ).rejects.toThrow("Operation entity is in active use")
        } finally {
          await deletionClient.end()
        }
        expect(
          (
            await getClient()`select released_at, recovery_reason from execution_task_device_lease where id = ${leaseId}`
          )[0],
        ).toMatchObject({ released_at: null, recovery_reason: "reconciliation_required" })
        expect(
          (await getClient()`select next_retry_at from execution_task where id = ${taskId}`)[0]?.[
            "next_retry_at"
          ],
        ).toBeNull()
        const auth = createAuthService(
          createInMemoryAuthRepository([
            {
              id: userId,
              email: "qa@example.test",
              password: "test",
              role: Role.Administrator,
              groupIds: [groupId],
              permissions: [Permission.OperationsWrite],
              pages: [{ key: PageKey.Tasks, canView: true, canDelete: false }],
            },
            {
              id: crypto.randomUUID(),
              email: "qa-operator@example.test",
              password: "test",
              role: Role.Operator,
              groupIds: [groupId],
              permissions: [Permission.OperationsWrite],
              pages: [{ key: PageKey.Tasks, canView: true, canDelete: false }],
            },
          ]),
          async (password, hash) => password === hash,
        )
        const app = createApp({
          authService: auth,
          auditRepository: createInMemoryAuditRepository(),
          taskExecutionService: createTaskExecutionService({
            repository: api,
            deviceRepository: createInMemoryDeviceRepository([]),
          }),
        })
        server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch })
        const origin = server.url
        const login = await fetch(new URL("/api/auth/login", origin), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "qa@example.test", password: "test" }),
        })
        const cookie = login.headers.get("set-cookie") ?? ""
        const operatorLogin = await fetch(new URL("/api/auth/login", origin), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "qa-operator@example.test", password: "test" }),
        })
        const request = (body: unknown, targetGroup = groupId, session = cookie) =>
          fetch(new URL(`/api/groups/${targetGroup}/tasks/${taskId}/reconcile`, origin), {
            method: "POST",
            headers: { Cookie: session, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        const valid = { resolution: "succeeded", evidenceRef: "QA_CASE_6" }
        const statuses = [
          (await request(valid, groupId, "")).status,
          (await request(valid, groupId, operatorLogin.headers.get("set-cookie") ?? "")).status,
          (await request(valid, crypto.randomUUID())).status,
          (await request({ ...valid, evidenceRef: "provider/receipt" })).status,
          (await request(valid)).status,
          (await request(valid)).status,
          (await request({ ...valid, resolution: "failed" })).status,
        ]
        expect(statuses).toEqual([401, 403, 404, 400, 200, 200, 409])
        const snapshot = (
          await getClient()`select
        (select status from execution_task where id = ${taskId}) as task,
        (select result from execution_task where id = ${taskId}) as result,
        (select status from execution_task_step where id = ${stepId}) as step,
        (select result from execution_task_step where id = ${stepId}) as step_result,
        (select count(*)::int from execution_task_device_lease where task_id = ${taskId} and released_at is null) as leases,
        (select count(*)::int from audit_event where action = 'execution.task.reconcile') as audits`
        )[0]
        expect(snapshot).toMatchObject({
          task: "succeeded",
          result: null,
          step: "succeeded",
          step_result: null,
          leases: 0,
          audits: 1,
        })
        console.log("Task6 HTTP SQL QA", JSON.stringify({ statuses, snapshot }))
      } finally {
        await server?.stop(true)
        await client.end()
      }
    },
  )
})

describe("Task 14 completed-step recovery", () => {
  const setup = async (implementation: "api" | "worker", corrupt: boolean) => {
    await prepare()
    const client = getClient()
    const api = createPostgresExecutionTaskRepository(client, systemActor)
    const worker = createPostgresWorkerRepository(client, { systemActor })
    await api.submit(submission, actor)
    const now = Date.now()
    const claim = await worker.claimTask("worker-a", now, 30_000, taskId)
    if (claim === null) throw new Error("claim missing")
    expect(
      await worker.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, now),
    ).toMatchObject({ stepId })
    const leaseId = crypto.randomUUID()
    expect(
      await worker.acquireDeviceLease({
        leaseId,
        taskId,
        groupId,
        deviceId,
        leaseToken: "projection-lease",
        workerId: "worker-a",
        expiresAt: now + 30_000,
      }),
    ).toBe(true)
    expect(
      await worker.markSubmitStarted({
        taskId,
        runId: claim.runId,
        claimToken: claim.claimToken,
        stepId,
        owner: "worker-a",
        leaseId,
        leaseToken: "projection-lease",
        now,
      }),
    ).toBe(true)
    expect(
      await worker.finishStep(
        taskId,
        claim.runId,
        "worker-a",
        claim.claimToken,
        stepId,
        "succeeded",
        {
          commandId: command.commandId,
          status: "succeeded",
          outcome: { kind: "acknowledged" },
          retryable: false,
        },
        undefined,
        undefined,
        now,
      ),
    ).toBe(true)
    if (corrupt)
      await client`update execution_task_step set result = '{}'::jsonb where id = ${stepId}`
    const repository = implementation === "api" ? api : worker
    return { api, worker, repository, claim, now, leaseId }
  }

  for (const implementation of ["api", "worker"] as const) {
    databaseTest(
      `${implementation} projects confirmed completed step without quarantine`,
      async () => {
        const { repository, now, leaseId } = await setup(implementation, false)
        await repository.recoverStale(now + 30_001, 10)
        expect(await transitionEvidence()).toMatchObject({
          task: "succeeded",
          step: "succeeded",
          run: "recovered",
          outbox: 4,
          audits: 4,
        })
        expect(
          (await getClient()`select result from execution_task where id = ${taskId}`)[0]?.[
            "result"
          ],
        ).toMatchObject({ commandId, status: "succeeded" })
        expect(
          (
            await getClient()`select released_at from execution_task_device_lease where id = ${leaseId}`
          )[0]?.["released_at"],
        ).toEqual(new Date(now + 30_001))
      },
    )
    for (const resolution of ["failed", "cancelled"] as const) {
      databaseTest(
        `${implementation} resolves corrupt completed projection as ${resolution} without rewriting steps`,
        async () => {
          const { api, repository, claim, now, leaseId } = await setup(implementation, true)
          expect(
            await repository.finishOwned(
              taskId,
              claim.runId,
              claim.claimToken,
              "running",
              "succeeded",
              now + 30_001,
            ),
          ).toBe(false)
          await repository.recoverStale(now + 30_001, 10)
          expect(await transitionEvidence()).toMatchObject({
            task: "needs_reconciliation",
            step: "succeeded",
            run: "needs_reconciliation",
            outbox: 4,
            audits: 4,
          })
          expect(
            (
              await getClient()`select terminal_reason from execution_task where id = ${taskId}`
            )[0]?.["terminal_reason"],
          ).toBe("projection_unconfirmed")
          expect(
            (
              await getClient()`select recovery_reason from execution_task_run where id = ${claim.runId}`
            )[0]?.["recovery_reason"],
          ).toBe("projection_unconfirmed")
          expect(
            (
              await getClient()`select released_at from execution_task_device_lease where id = ${leaseId}`
            )[0]?.["released_at"],
          ).toBeNull()
          const steps =
            await getClient()`select status, result from execution_task_step where task_id = ${taskId}`
          const frozen = await transitionRows()
          expect(
            await api.reconcile({
              taskId,
              groupId,
              resolution: "succeeded",
              evidenceHash: "a".repeat(64),
              actor,
              now: now + 30_002,
            }),
          ).toBe("conflict")
          expect(
            await api.reconcile({
              taskId,
              groupId: crypto.randomUUID(),
              resolution,
              evidenceHash: "a".repeat(64),
              actor,
              now: now + 30_002,
            }),
          ).toBe("not_found")
          expect(await transitionRows()).toEqual(frozen)
          expect(
            await api.reconcile({
              taskId,
              groupId,
              resolution,
              evidenceHash: "a".repeat(64),
              actor,
              now: now + 30_002,
            }),
          ).toBe("resolved")
          expect(
            await api.reconcile({
              taskId,
              groupId,
              resolution,
              evidenceHash: "a".repeat(64),
              actor,
              now: now + 30_003,
            }),
          ).toBe("duplicate")
          expect(
            (
              await getClient()`select status, result from execution_task_step where task_id = ${taskId}`
            )[0],
          ).toMatchObject({ status: steps[0]?.["status"], result: steps[0]?.["result"] })
          expect(await transitionEvidence()).toMatchObject({
            task: resolution,
            step: "succeeded",
            run: resolution,
            outbox: 5,
            audits: 5,
          })
          expect(
            (
              await getClient()`select task.status, task.result, lease.released_at, lease.recovery_reason
          from execution_task task join execution_task_device_lease lease on lease.task_id = task.id where task.id = ${taskId}`
            )[0],
          ).toMatchObject({
            status: resolution,
            result: null,
            released_at: new Date(now + 30_002),
            recovery_reason: "operator_verified",
          })
          expect(
            (
              await getClient()`select count(*)::int as count from audit_event where action = 'execution.task.reconcile' and metadata->>'evidenceHash' = ${"a".repeat(64)}`
            )[0]?.["count"],
          ).toBe(1)
        },
      )
    }
  }

  databaseTest("rejects completed projection resolution if a step becomes unresolved", async () => {
    const { api, worker, now, leaseId } = await setup("worker", true)
    await worker.recoverStale(now + 30_001, 10)
    await getClient()`update execution_task_step set status = 'claimed' where id = ${stepId}`
    const frozen = await transitionRows()
    expect(
      await api.reconcile({
        taskId,
        groupId,
        resolution: "failed",
        evidenceHash: "a".repeat(64),
        actor,
        now: now + 30_002,
      }),
    ).toBe("conflict")
    expect(await transitionRows()).toEqual(frozen)
    expect(
      (
        await getClient()`select released_at from execution_task_device_lease where id = ${leaseId}`
      )[0]?.["released_at"],
    ).toBeNull()
  })

  databaseTest(
    "completed projection quarantine resolves only through authorized HTTP evidence",
    async () => {
      const { api, worker, now, leaseId } = await setup("worker", true)
      await worker.recoverStale(now + 30_001, 10)
      const auth = createAuthService(
        createInMemoryAuthRepository([
          {
            id: userId,
            email: "projection-admin@example.test",
            password: "test",
            role: Role.Administrator,
            groupIds: [groupId],
            permissions: [Permission.OperationsWrite],
            pages: [{ key: PageKey.Tasks, canView: true, canDelete: false }],
          },
          {
            id: crypto.randomUUID(),
            email: "projection-operator@example.test",
            password: "test",
            role: Role.Operator,
            groupIds: [groupId],
            permissions: [Permission.OperationsWrite],
            pages: [{ key: PageKey.Tasks, canView: true, canDelete: false }],
          },
        ]),
        async (password, hash) => password === hash,
      )
      const app = createApp({
        authService: auth,
        auditRepository: createInMemoryAuditRepository(),
        taskExecutionService: createTaskExecutionService({
          repository: api,
          deviceRepository: createInMemoryDeviceRepository([]),
        }),
      })
      const login = async (email: string) => {
        const response = await app.request("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password: "test" }),
        })
        return response.headers.get("set-cookie") ?? ""
      }
      const admin = await login("projection-admin@example.test")
      const operator = await login("projection-operator@example.test")
      const request = (resolution: string, evidenceRef: string, cookie = admin, group = groupId) =>
        app.request(`/api/groups/${group}/tasks/${taskId}/reconcile`, {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ resolution, evidenceRef }),
        })
      const frozen = await transitionRows()
      expect((await request("failed", "CASE_14", "")).status).toBe(401)
      expect((await request("failed", "CASE_14", operator)).status).toBe(403)
      expect((await request("failed", "CASE_14", admin, crypto.randomUUID())).status).toBe(404)
      expect((await request("failed", "invalid/evidence")).status).toBe(400)
      expect((await request("succeeded", "CASE_14")).status).toBe(409)
      expect(await transitionRows()).toEqual(frozen)
      expect((await request("failed", "CASE_14")).status).toBe(200)
      expect((await request("failed", "CASE_14")).status).toBe(200)
      expect((await request("cancelled", "CASE_14")).status).toBe(409)
      expect(
        (await getClient()`select status from execution_task where id = ${taskId}`)[0]?.["status"],
      ).toBe("failed")
      expect(
        (
          await getClient()`select released_at from execution_task_device_lease where id = ${leaseId}`
        )[0]?.["released_at"],
      ).toBeInstanceOf(Date)
    },
  )
})

describe("Task 11 cancellation arbitration", () => {
  for (const status of ["failed", "timed_out"] as const) {
    databaseTest(`worker recovers provider-confirmed ${status} during cancellation`, async () => {
      await prepare()
      const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
      const worker = createPostgresWorkerRepository(getClient(), {
        systemActor,
        getResult: async (requestedId) => ({
          commandId: requestedId,
          status,
          error: { code: "failed", message: "provider confirmed failure" },
          retryable: false,
        }),
      })
      await api.submit(submission, actor)
      const now = Date.now()
      const claim = await worker.claimTask("worker-a", now, 30_000)
      if (claim === null) throw new Error("claim missing")
      await worker.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, now)
      await getClient()`update execution_task_step set submit_started_at = ${new Date(now)} where id = ${stepId}`
      await api.requestCancel(groupId, taskId, actor, now)
      await worker.recoverStale(now + 30_001, 10)
      expect(await transitionEvidence()).toMatchObject({
        task: "failed",
        step: status,
        run: "recovered",
        outbox: 5,
        audits: 5,
      })
      const snapshot = await transitionRows()
      await worker.recoverStale(now + 60_000, 10)
      expect(await transitionRows()).toEqual(snapshot)
    })
  }

  databaseTest(
    "expired owner cannot persist deferred cancellation success and recovery quarantines",
    async () => {
      await prepare()
      const client = createSqlClient(getTestDatabaseUrl())
      const other = createSqlClient(getTestDatabaseUrl())
      const entered = Promise.withResolvers<void>()
      const poll = Promise.withResolvers<DeviceCommandResult>()
      const cancelling = Promise.withResolvers<void>()
      const confirmation = Promise.withResolvers<DeviceCommandResult>()
      const controller = new AbortController()
      let run: Promise<void> | undefined
      const watchdog = setTimeout(() => {
        controller.abort()
        entered.resolve()
        cancelling.resolve()
      }, 5000)
      try {
        const api = createPostgresExecutionTaskRepository(other, systemActor)
        const worker = createPostgresWorkerRepository(client, { systemActor })
        await api.submit(submission, actor)
        const adapter = createInMemoryDeviceAdapter()
        let now = Date.now()
        let queries = 0
        let submissions = 0
        run = createTaskExecutor({
          repository: worker,
          adapter: {
            ...adapter,
            submit: async (input) => {
              submissions += 1
              return adapter.submit(input)
            },
            cancel: async () => cancelling.resolve(),
            getResult: () => {
              queries += 1
              entered.resolve()
              return queries === 1 ? poll.promise : confirmation.promise
            },
          },
          config: {
            databaseUrl: getTestDatabaseUrl(),
            systemActorId: userId,
            workerId: "task11",
            concurrency: 1,
            pollIntervalMs: 1000,
            outboxBatchSize: 1,
            recoveryBatchSize: 1,
            leaseMs: 30_000,
            heartbeatMs: 10_000,
            retryDelayMs: 1000,
          },
          clock: () => now,
          scheduleHeartbeat: () => () => {},
        })(
          {
            outboxId: "qa",
            aggregateId: taskId,
            eventType: "execution_task.queued",
            payload: { taskId },
            availableAt: now,
          },
          controller.signal,
        )
        await entered.promise
        expect(await api.requestCancel(groupId, taskId, actor, now)).toBe(true)
        poll.resolve({ commandId: command.commandId, status: "running", retryable: true })
        await cancelling.promise
        now += 30_001
        await other`update execution_task_run set claim_expires_at = ${new Date(now - 1)} where task_id = ${taskId}`
        confirmation.resolve({
          commandId: command.commandId,
          status: "succeeded",
          outcome: { kind: "acknowledged" },
          retryable: false,
        })
        await run
        expect(controller.signal.aborted).toBe(false)
        expect(await transitionEvidence()).toMatchObject({
          task: "cancel_requested",
          step: "claimed",
          run: "running",
          outbox: 4,
          audits: 4,
        })
        await worker.recoverStale(now, 10)
        expect(await transitionEvidence()).toMatchObject({
          task: "needs_reconciliation",
          step: "claimed",
          run: "needs_reconciliation",
          outbox: 5,
          audits: 5,
        })
        expect(
          (
            await other`select released_at, recovery_reason from execution_task_device_lease where task_id = ${taskId}`
          )[0],
        ).toMatchObject({ released_at: null, recovery_reason: "reconciliation_required" })
        expect(submissions).toBe(1)
        const snapshot = await transitionRows()
        await worker.recoverStale(now + 30_000, 10)
        expect(await transitionRows()).toEqual(snapshot)
        if (Bun.env["TASK11_QA"] === "1")
          console.log(
            "Task11 expired deferred result",
            JSON.stringify(await transitionEvidence()),
            { submissions, queries },
          )
      } finally {
        clearTimeout(watchdog)
        controller.abort()
        poll.resolve({ commandId: command.commandId, status: "running", retryable: true })
        confirmation.resolve({ commandId: command.commandId, status: "running", retryable: true })
        await run?.catch(() => undefined)
        await client.end()
        await other.end()
      }
    },
  )

  for (const implementation of ["api", "worker"] as const) {
    for (const marked of [false, true]) {
      databaseTest(
        `${implementation} resolves expired cancellation safely marked=${marked}`,
        async () => {
          await prepare()
          const client = createSqlClient(getTestDatabaseUrl())
          try {
            const api = createPostgresExecutionTaskRepository(client, systemActor)
            const worker = createPostgresWorkerRepository(client, { systemActor })
            let providerCalls = 0
            const recoveryWorker = createPostgresWorkerRepository(client, {
              systemActor,
              getResult: async (requestedId) => {
                providerCalls += 1
                return { commandId: requestedId, status: "running", retryable: true }
              },
            })
            const repository = implementation === "api" ? api : recoveryWorker
            await api.submit(submission, actor)
            const now = Date.now()
            const claim = await worker.claimTask("worker-a", now, 30_000)
            if (claim === null) throw new Error("claim missing")
            await worker.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, now)
            await client`insert into execution_task_device_lease
            (task_id, group_id, device_id, lease_token, expires_at)
            values (${taskId}, ${groupId}, ${deviceId}, 'task11', ${new Date(now + 30_000)})`
            if (marked)
              await client`update execution_task_step set submit_started_at = ${new Date(now)} where id = ${stepId}`
            await api.requestCancel(groupId, taskId, actor, now)
            const before = await transitionEvidence()
            expect(before).toMatchObject({
              task: "cancel_requested",
              step: "claimed",
              run: "running",
              outbox: 4,
              audits: 4,
            })
            await repository.recoverStale(now + 30_001, 10)
            expect(await transitionEvidence()).toMatchObject({
              task: marked ? "needs_reconciliation" : "cancelled",
              step: marked ? "claimed" : "cancelled",
              run: marked ? "needs_reconciliation" : "recovered",
              outbox: 5,
              audits: 5,
            })
            expect(providerCalls).toBe(marked && implementation === "worker" ? 1 : 0)
            expect(
              (
                await client`select released_at, recovery_reason from execution_task_device_lease where task_id = ${taskId}`
              )[0],
            ).toMatchObject({
              released_at: marked ? null : new Date(now + 30_001),
              recovery_reason: marked ? "reconciliation_required" : "lease_expired",
            })
            const recovery =
              await client`select event.id, event.to_status, event.reason, event.actor_id,
              outbox.event_id from execution_task_event event join execution_task_outbox outbox
              on outbox.event_id = event.id where event.task_id = ${taskId} and event.source = 'recovery'`
            expect(recovery).toHaveLength(1)
            expect(recovery[0]).toMatchObject({
              to_status: marked ? "needs_reconciliation" : "cancelled",
              reason: marked ? "reconciliation_required" : "cancel_requested",
              actor_id: userId,
              event_id: recovery[0]?.["id"],
            })
            const unresolved =
              await client`select task.id from execution_task task where task.status = 'needs_reconciliation'
              and ((select count(*) from execution_task_run run where run.task_id = task.id
                and run.status = 'needs_reconciliation' and run.step_id in
                  (select step.id from execution_task_step step where step.task_id = task.id
                    and step.submit_started_at is not null and step.status in ('claimed', 'running'))) <> 1
                or (select count(*) from execution_task_device_lease lease where lease.task_id = task.id
                  and lease.released_at is null) <> 1)`
            expect(unresolved).toHaveLength(0)
            const frozen = await transitionRows()
            await repository.recoverStale(now + 60_000, 10)
            expect(await transitionRows()).toEqual(frozen)
            if (marked) {
              expect(
                await api.reconcile({
                  taskId,
                  groupId,
                  resolution: "cancelled",
                  evidenceHash: "a".repeat(64),
                  actor,
                  now: now + 60_001,
                }),
              ).toBe("resolved")
              expect((await api.get(groupId, taskId))?.state).toBe("cancelled")
            } else {
              expect(
                await api.reconcile({
                  taskId,
                  groupId,
                  resolution: "cancelled",
                  evidenceHash: "a".repeat(64),
                  actor,
                  now: now + 60_001,
                }),
              ).toBe("conflict")
            }
            if (Bun.env["TASK11_QA"] === "1")
              console.log(
                "Task11 recovery",
                implementation,
                marked,
                JSON.stringify(await transitionEvidence()),
              )
          } finally {
            await client.end()
          }
        },
      )
    }
  }

  databaseTest(
    "preserves earlier success when expiring an unmarked running cancellation",
    async () => {
      await prepare()
      const client = getClient()
      const api = createPostgresExecutionTaskRepository(client, systemActor)
      let providerCalls = 0
      const worker = createPostgresWorkerRepository(client, {
        systemActor,
        getResult: async (requestedId) => {
          providerCalls += 1
          return { commandId: requestedId, status: "running", retryable: true }
        },
      })
      const laterStepId = crypto.randomUUID()
      await api.submit(
        {
          ...submission,
          steps: [
            ...submission.steps,
            {
              stepId: laterStepId,
              sequence: 1,
              fingerprint: "later-step",
              command: parseExecutableCommand({
                ...command,
                commandId: parseExecutableCommand({ ...command, commandId: crypto.randomUUID() })
                  .commandId,
                idempotencyKey: "later-command-key",
              }),
            },
          ],
        },
        actor,
      )
      const now = Date.now()
      const claim = await worker.claimTask("worker-a", now, 30_000, taskId)
      if (claim === null) throw new Error("claim missing")
      expect(
        await worker.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, now),
      ).toMatchObject({ stepId })
      expect(
        await worker.finishStep(
          taskId,
          claim.runId,
          "worker-a",
          claim.claimToken,
          stepId,
          "succeeded",
          {
            commandId: command.commandId,
            status: "succeeded",
            outcome: { kind: "acknowledged" },
            retryable: false,
          },
          undefined,
          undefined,
          now,
        ),
      ).toBe(true)
      const prior = (
        await client`select status, result from execution_task_step where id = ${stepId}`
      )[0]
      expect(
        await worker.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, now),
      ).toMatchObject({ stepId: laterStepId })
      await client`update execution_task_step set status = 'running' where id = ${laterStepId}`
      await client`insert into execution_task_device_lease
      (task_id, group_id, device_id, lease_token, expires_at)
      values (${taskId}, ${groupId}, ${deviceId}, 'task14', ${new Date(now + 30_000)})`
      expect(await api.requestCancel(groupId, taskId, actor, now)).toBe(true)
      await worker.recoverStale(now + 30_001, 10)
      expect(providerCalls).toBe(0)
      expect(
        (await client`select status, result from execution_task_step where id = ${stepId}`)[0],
      ).toEqual(prior)
      expect(
        (
          await client`select status, submit_started_at from execution_task_step where id = ${laterStepId}`
        )[0],
      ).toMatchObject({ status: "cancelled", submit_started_at: null })
      expect(
        (
          await client`select task.status, run.status as run_status, lease.released_at
      from execution_task task join execution_task_run run on run.task_id = task.id
      join execution_task_device_lease lease on lease.task_id = task.id
      where task.id = ${taskId}`
        )[0],
      ).toMatchObject({
        status: "cancelled",
        run_status: "recovered",
        released_at: new Date(now + 30_001),
      })
      expect(
        (
          await client`select count(*)::int as count from audit_event
      where target = ${`execution-task:${taskId}`} and action = 'execution.task.recover'`
        )[0]?.["count"],
      ).toBe(1)
    },
  )

  databaseTest(
    "rejects unconfirmed, foreign and mismatched cancellation results without writes",
    async () => {
      await prepare()
      const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
      const worker = createPostgresWorkerRepository(getClient(), { systemActor })
      await api.submit(submission, actor)
      const now = Date.now()
      const claim = await worker.claimTask("worker-a", now, 30_000)
      if (claim === null) throw new Error("claim missing")
      await worker.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, now)
      await api.requestCancel(groupId, taskId, actor, now)
      const before = await transitionRows()
      for (const result of [
        undefined,
        { commandId: command.commandId, status: "running", retryable: true } as const,
        {
          commandId: parseExecutableCommand({ ...command, commandId: crypto.randomUUID() })
            .commandId,
          status: "cancelled",
          retryable: false,
        } as const,
      ]) {
        expect(
          await worker.finishStep(
            taskId,
            claim.runId,
            "worker-a",
            claim.claimToken,
            stepId,
            "cancelled",
            result,
            undefined,
            undefined,
            now,
          ),
        ).toBe(false)
        expect(await transitionRows()).toEqual(before)
      }
      expect(
        await worker.finishOwned(
          taskId,
          claim.runId,
          claim.claimToken,
          "cancel_requested",
          "cancelled",
          now,
        ),
      ).toBe(false)
      expect(
        await api.finishOwned(
          taskId,
          claim.runId,
          claim.claimToken,
          "cancel_requested",
          "cancelled",
          now,
        ),
      ).toBe(false)
      expect(await transitionRows()).toEqual(before)
    },
  )

  for (const ordering of ["cancel-first", "success-first", "concurrent", "partial"] as const) {
    databaseTest(
      `two clients preserve provider success with ${ordering} cancellation`,
      async () => {
        await prepare()
        const client = postgres(getTestDatabaseUrl(), { max: 1 })
        const other = postgres(getTestDatabaseUrl(), { max: 1 })
        try {
          const api = createPostgresExecutionTaskRepository(client, systemActor)
          const cancelApi = createPostgresExecutionTaskRepository(other, systemActor)
          const worker = createPostgresWorkerRepository(client, { systemActor })
          await api.submit(
            ordering === "partial"
              ? {
                  ...submission,
                  steps: [
                    ...submission.steps,
                    {
                      stepId: crypto.randomUUID(),
                      sequence: 1,
                      fingerprint: "later",
                      command: parseExecutableCommand({
                        ...command,
                        commandId: crypto.randomUUID(),
                        idempotencyKey: "later",
                      }),
                    },
                  ],
                }
              : submission,
            actor,
          )
          const now = Date.now()
          const claim = await worker.claimTask("worker-a", now, 30_000)
          if (claim === null) throw new Error("claim missing")
          await worker.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, now)
          const result = {
            commandId: command.commandId,
            status: "succeeded",
            outcome: { kind: "acknowledged" },
            retryable: false,
          } as const
          const finish = () =>
            worker.finishStep(
              taskId,
              claim.runId,
              "worker-a",
              claim.claimToken,
              stepId,
              "succeeded",
              result,
              undefined,
              undefined,
              now,
            )
          const cancel = () => cancelApi.requestCancel(groupId, taskId, actor, now)
          const claimed = await transitionRows()
          for (const fence of [
            { token: "stale-token", now },
            { token: claim.claimToken, now: now + 30_000 },
          ]) {
            expect(
              await worker.finishStep(
                taskId,
                claim.runId,
                "worker-a",
                fence.token,
                stepId,
                "succeeded",
                result,
                undefined,
                undefined,
                fence.now,
              ),
            ).toBe(false)
            expect(await transitionRows()).toEqual(claimed)
          }
          switch (ordering) {
            case "cancel-first":
              expect(await cancel()).toBe(true)
              expect(await finish()).toBe(true)
              break
            case "success-first":
            case "partial":
              expect(await finish()).toBe(true)
              expect(await cancel()).toBe(true)
              break
            case "concurrent": {
              const successBackend = (
                await client<{ pid: number }[]>`select pg_backend_pid() as pid`
              )[0]
              const cancelBackend = (
                await other<{ pid: number }[]>`select pg_backend_pid() as pid`
              )[0]
              if (successBackend === undefined || cancelBackend === undefined)
                throw new Error("backend missing")
              expect(successBackend.pid).not.toBe(cancelBackend.pid)
              await client`set statement_timeout = '10s'`
              await other`set statement_timeout = '10s'`
              let operations: Promise<PromiseSettledResult<boolean>[]> | undefined
              let results: PromiseSettledResult<boolean>[] = []
              try {
                await getClient().begin(async (barrier) => {
                  await barrier`select id from execution_task where id = ${taskId} for update`
                  const coordinator = (
                    await barrier<{ pid: number }[]>`select pg_backend_pid() as pid`
                  )[0]
                  if (coordinator === undefined) throw new Error("coordinator backend missing")
                  operations = Promise.allSettled([
                    finish(),
                    cancel(),
                    cancelApi.requestCancel(groupId, taskId, actor, now),
                  ])
                  const deadline = performance.now() + 5000
                  while (true) {
                    const waiting = await getClient()<{ pid: number; blockers: number[] }[]>`
                      select pid, pg_blocking_pids(pid) as blockers from pg_stat_activity
                      where pid in (${successBackend.pid}, ${cancelBackend.pid})
                        and state = 'active' and wait_event_type = 'Lock'
                        and query ilike '%execution_task%' and query ilike '%for update%'
                        and cardinality(pg_blocking_pids(pid)) > 0`
                    if (waiting.length === 2) {
                      expect(waiting.map((row) => row.pid).sort()).toEqual(
                        [successBackend.pid, cancelBackend.pid].sort(),
                      )
                      expect(
                        waiting.every((row) =>
                          row.blockers.some(
                            (pid) =>
                              pid === coordinator.pid ||
                              waiting.some(
                                (peer) =>
                                  peer.pid === pid && peer.blockers.includes(coordinator.pid),
                              ),
                          ),
                        ),
                      ).toBe(true)
                      expect(await transitionRows()).toEqual(claimed)
                      expect(claimed?.["events"]).toBe(3)
                      expect(await transitionEvidence()).toMatchObject({
                        task: "running",
                        step: "claimed",
                        run: "running",
                        outbox: 3,
                        audits: 3,
                      })
                      if (Bun.env["TASK11_QA"] === "1")
                        console.log("Task11 barrier observed before release", {
                          coordinator: coordinator.pid,
                          success: successBackend.pid,
                          cancellation: cancelBackend.pid,
                          waiting: [...waiting],
                          task: "running",
                          step: "claimed",
                          events: 3,
                          outbox: 3,
                          audits: 3,
                        })
                      break
                    }
                    if (performance.now() >= deadline)
                      throw new Error(
                        "Both repository transactions must be blocked before barrier release",
                      )
                  }
                })
              } finally {
                results = operations === undefined ? [] : await operations
              }
              expect(results.every((result) => result.status === "fulfilled")).toBe(true)
              expect(results[0]).toEqual({ status: "fulfilled", value: true })
              expect(
                results.slice(1).filter((result) => result.status === "fulfilled" && result.value),
              ).toHaveLength(1)
              break
            }
            default: {
              const exhaustive: never = ordering
              throw exhaustive
            }
          }
          const before = await transitionRows()
          expect(
            await worker.finishStep(
              taskId,
              claim.runId,
              "worker-a",
              "stale-token",
              stepId,
              "succeeded",
              result,
              undefined,
              undefined,
              now,
            ),
          ).toBe(false)
          expect(
            await worker.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, now),
          ).toBeNull()
          if (ordering !== "partial") {
            expect(
              await worker.finishOwned(
                taskId,
                claim.runId,
                claim.claimToken,
                "cancel_requested",
                "cancelled",
                now,
              ),
            ).toBe(false)
            expect(
              await cancelApi.finishOwned(
                taskId,
                claim.runId,
                claim.claimToken,
                "cancel_requested",
                "cancelled",
                now,
              ),
            ).toBe(false)
          }
          expect(await transitionRows()).toEqual(before)
          const terminal = ordering === "partial" ? "cancelled" : "succeeded"
          expect(
            await worker.finishOwned(
              taskId,
              claim.runId,
              claim.claimToken,
              "cancel_requested",
              terminal,
              now,
            ),
          ).toBe(true)
          expect(await transitionEvidence()).toMatchObject({
            task: terminal,
            step: "succeeded",
            run: terminal,
            outbox: 5,
            audits: 5,
          })
          const steps = await other`select sequence, status, result->>'status' as result_status
          from execution_task_step where task_id = ${taskId} order by sequence`
          expect([...steps]).toEqual(
            ordering === "partial"
              ? [
                  { sequence: 0, status: "succeeded", result_status: "succeeded" },
                  { sequence: 1, status: "pending", result_status: null },
                ]
              : [{ sequence: 0, status: "succeeded", result_status: "succeeded" }],
          )
          const snapshot = await transitionRows()
          expect(snapshot?.["events"]).toBe(5)
          expect(await cancel()).toBe(false)
          expect(
            await worker.finishOwned(
              taskId,
              claim.runId,
              claim.claimToken,
              "cancel_requested",
              "cancelled",
              now,
            ),
          ).toBe(false)
          expect(await transitionRows()).toEqual(snapshot)
          if (Bun.env["TASK11_QA"] === "1")
            console.log("Task11 race", ordering, JSON.stringify(await transitionEvidence()))
        } finally {
          await client.end()
          await other.end()
        }
      },
    )
  }
})

describe("Task 5 persisted transitions", () => {
  for (const implementation of ["api", "worker"] as const) {
    databaseTest(
      `${implementation} first claim and confirmed cancel/success are atomic`,
      async () => {
        await prepare()
        const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
        const worker = createPostgresWorkerRepository(getClient(), { systemActor })
        const repository = implementation === "api" ? api : worker
        await api.submit(submission, actor)
        const now = Date.now()
        const claim = await repository.claimTask("worker-a", now, 30_000)
        if (claim === null) throw new Error("claim missing")
        const before = await transitionRows()
        const competingClient = createSqlClient(getTestDatabaseUrl())
        const competitor =
          implementation === "api"
            ? createPostgresExecutionTaskRepository(competingClient, systemActor)
            : createPostgresWorkerRepository(competingClient, { systemActor })
        const claims = await Promise.all([
          repository.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, now),
          competitor.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, now),
        ]).finally(() => competingClient.end())
        expect(claims.filter((value) => value !== null)).toHaveLength(1)
        expect((await api.get(groupId, taskId))?.state).toBe("running")
        const started = await transitionRows()
        const firstClaimEvidence = await transitionEvidence()
        expect(started?.["events"]).toBe(Number(before?.["events"]) + 1)
        expect(started?.["outbox"]).toBe(Number(before?.["outbox"]) + 1)
        expect(started?.["audits"]).toBe(Number(before?.["audits"]) + 1)
        expect(
          (
            await getClient()`select status, step_id from execution_task_run where id = ${claim.runId}`
          )[0],
        ).toEqual(expect.objectContaining({ status: "running", step_id: stepId }))
        await api.requestCancel(groupId, taskId, actor, now)
        expect(
          await worker.finishStep(
            taskId,
            claim.runId,
            "worker-a",
            claim.claimToken,
            stepId,
            "succeeded",
            undefined,
            undefined,
            undefined,
            now,
          ),
        ).toBe(false)
        expect(
          await worker.finishStep(
            taskId,
            claim.runId,
            "worker-a",
            claim.claimToken,
            stepId,
            "succeeded",
            {
              commandId: command.commandId,
              status: "succeeded",
              outcome: { kind: "acknowledged" },
              retryable: false,
            },
            undefined,
            undefined,
            now,
          ),
        ).toBe(true)
        expect(
          await (implementation === "api"
            ? api.finishOwned(
                taskId,
                claim.runId,
                claim.claimToken,
                "cancel_requested",
                "succeeded",
                now,
              )
            : worker.finishOwned(
                taskId,
                claim.runId,
                claim.claimToken,
                "cancel_requested",
                "succeeded",
                now,
              )),
        ).toBe(true)
        const completed = await transitionRows()
        expect(await api.requestCancel(groupId, taskId, actor, now)).toBe(false)
        expect(
          await (implementation === "api"
            ? api.finishOwned(taskId, claim.runId, claim.claimToken, "succeeded", "failed", now)
            : worker.finishOwned(
                taskId,
                claim.runId,
                claim.claimToken,
                "succeeded",
                "failed",
                now,
              )),
        ).toBe(false)
        expect(
          await worker.finishStep(
            taskId,
            claim.runId,
            "worker-a",
            claim.claimToken,
            stepId,
            "cancelled",
            undefined,
            undefined,
            undefined,
            now,
          ),
        ).toBe(false)
        expect(await transitionRows()).toEqual(completed)
        if (Bun.env["TASK5_QA"] === "1")
          console.log(
            JSON.stringify({
              implementation,
              firstClaim: firstClaimEvidence,
              terminal: await transitionEvidence(),
              rejectedWritesUnchanged: true,
            }),
          )
      },
    )

    databaseTest(`${implementation} illegal and terminal writes add zero rows`, async () => {
      await prepare()
      const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
      const worker = createPostgresWorkerRepository(getClient(), { systemActor })
      const repository = implementation === "api" ? api : worker
      await api.submit(submission, actor)
      const now = Date.now()
      const claim = await repository.claimTask("worker-a", now, 30_000)
      if (claim === null) throw new Error("claim missing")
      const cases: readonly (readonly [TaskState, "succeeded" | "failed" | "cancelled"])[] = [
        ["dispatching", "succeeded"],
        ["dispatching", "cancelled"],
        ["queued", "failed"],
        ["succeeded", "succeeded"],
        ["failed", "failed"],
        ["cancelled", "cancelled"],
        ["timed_out", "failed"],
        ["needs_reconciliation", "failed"],
        ["cancel_requested", "succeeded"],
      ]
      for (const [from, to] of cases) {
        await getClient()`update execution_task set status = ${from} where id = ${taskId}`
        const before = await transitionRows()
        expect(
          await (implementation === "api"
            ? api.finishOwned(taskId, claim.runId, claim.claimToken, from, to, now)
            : worker.finishOwned(taskId, claim.runId, claim.claimToken, from, to, now)),
          `${from}->${to}`,
        ).toBe(false)
        expect(await transitionRows()).toEqual(before)
      }
      await getClient()`update execution_task set status = 'cancel_requested' where id = ${taskId}`
      const before = await transitionRows()
      expect(
        await repository.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, now),
      ).toBeNull()
      expect(await transitionRows()).toEqual(before)
    })
  }

  databaseTest("invalid persisted validation alone permits queued failure", async () => {
    await prepare()
    const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
    await api.submit(submission, actor)
    await getClient()`update execution_task set executor_key = 'unsupported' where id = ${taskId}`
    expect(await api.claimTask("owner", Date.now(), 30_000)).toBeNull()
    expect((await api.get(groupId, taskId))?.state).toBe("failed")
    const failed = await transitionRows()
    expect(failed).toEqual(expect.objectContaining({ events: 2, outbox: 2, audits: 2 }))
    expect(await api.claimTask("owner", Date.now(), 30_000)).toBeNull()
    expect(await transitionRows()).toEqual(failed)
  })

  databaseTest("malformed raw step state rolls claim back in both repositories", async () => {
    await prepare()
    const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
    const worker = createPostgresWorkerRepository(getClient(), { systemActor })
    await api.submit(submission, actor)
    await getClient()`alter table execution_task_step drop constraint execution_task_step_status_check`
    await getClient()`update execution_task_step set status = 'retry_waiting' where id = ${stepId}`
    const before = await transitionRows()
    for (const repository of [api, worker]) {
      expect(
        await captureError(() => repository.claimTask("worker-a", Date.now(), 30_000)),
      ).toBeInstanceOf(Error)
      expect(await transitionRows()).toEqual(before)
    }
    await getClient()`update execution_task_step set status = 'pending' where id = ${stepId}`
    await getClient()`alter table execution_task_step add constraint execution_task_step_status_check
      check (status in ('pending','claimed','running','succeeded','failed','timed_out','cancelled','skipped'))`
  })

  for (const implementation of ["api", "worker"] as const) {
    databaseTest(
      `${implementation} terminal cancellation fences later confirmed success`,
      async () => {
        await prepare()
        const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
        const worker = createPostgresWorkerRepository(getClient(), { systemActor })
        const repository = implementation === "api" ? api : worker
        await api.submit(submission, actor)
        const now = Date.now()
        const claim = await repository.claimTask("worker-a", now, 30_000)
        if (claim === null) throw new Error("claim missing")
        await repository.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, now)
        await api.requestCancel(groupId, taskId, actor, now)
        expect(
          await worker.finishStep(
            taskId,
            claim.runId,
            "worker-a",
            claim.claimToken,
            stepId,
            "cancelled",
            { commandId: command.commandId, status: "cancelled", retryable: false },
            undefined,
            undefined,
            now,
          ),
        ).toBe(true)
        expect(
          await (implementation === "api"
            ? api.finishOwned(
                taskId,
                claim.runId,
                claim.claimToken,
                "cancel_requested",
                "cancelled",
                now,
              )
            : worker.finishOwned(
                taskId,
                claim.runId,
                claim.claimToken,
                "cancel_requested",
                "cancelled",
                now,
              )),
        ).toBe(true)
        const before = await transitionRows()
        expect(
          await worker.finishStep(
            taskId,
            claim.runId,
            "worker-a",
            claim.claimToken,
            stepId,
            "succeeded",
            {
              commandId: command.commandId,
              status: "succeeded",
              outcome: { kind: "acknowledged" },
              retryable: false,
            },
            undefined,
            undefined,
            now,
          ),
        ).toBe(false)
        expect(await transitionRows()).toEqual(before)
        if (Bun.env["TASK5_QA"] === "1")
          console.log(
            JSON.stringify({
              implementation,
              cancellationWon: await transitionEvidence(),
              lateSuccessRejected: true,
            }),
          )
      },
    )

    databaseTest(`${implementation} repeated recovery preserves confirmed success`, async () => {
      await prepare()
      const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
      const worker = createPostgresWorkerRepository(getClient(), { systemActor })
      const repository = implementation === "api" ? api : worker
      await api.submit(submission, actor)
      const now = Date.now()
      const claim = await repository.claimTask("worker-a", now, 30_000)
      if (claim === null) throw new Error("claim missing")
      await repository.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, now)
      await api.requestCancel(groupId, taskId, actor, now)
      await worker.finishStep(
        taskId,
        claim.runId,
        "worker-a",
        claim.claimToken,
        stepId,
        "succeeded",
        {
          commandId: command.commandId,
          status: "succeeded",
          outcome: { kind: "acknowledged" },
          retryable: false,
        },
        undefined,
        undefined,
        now,
      )
      await repository.recoverStale(now + 30_001, 10)
      expect((await api.get(groupId, taskId))?.state).toBe("succeeded")
      const recovered = await transitionRows()
      await repository.recoverStale(now + 60_000, 10)
      expect(await transitionRows()).toEqual(recovered)
    })
  }
})

describe("PostgreSQL execution task repository", () => {
  databaseTest(
    "recovers a failed worker step as a terminal task without replaying it",
    async () => {
      await prepare()
      const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
      const worker = createPostgresWorkerRepository(getClient(), { systemActor })
      await api.submit(submission, actor)
      const claim = await worker.claimTask("worker-a", Date.now(), 30_000, taskId)
      if (claim === null) throw new Error("claim missing")
      const step = await worker.claimNext(
        taskId,
        claim.runId,
        "worker-a",
        claim.claimToken,
        Date.now(),
      )
      if (step === null) throw new Error("step missing")
      expect(
        await worker.finishStep(
          taskId,
          claim.runId,
          "worker-a",
          claim.claimToken,
          step.stepId,
          "failed",
          undefined,
          "failed",
          "provider error",
          Date.now(),
        ),
      ).toBe(true)
      await getClient()`update execution_task_run set claim_expires_at = now() - interval '1 second' where id = ${claim.runId}`

      await worker.recoverStale(Date.now(), 10)

      expect(
        (
          await getClient()`select status, next_retry_at, terminal_reason from execution_task where id = ${taskId}`
        )[0],
      ).toEqual(
        expect.objectContaining({
          status: "failed",
          next_retry_at: null,
          terminal_reason: "step_failed",
        }),
      )
      expect(
        (await getClient()`select status from execution_task_step where id = ${stepId}`)[0]?.[
          "status"
        ],
      ).toBe("failed")
      expect(
        (await getClient()`select status from execution_task_run where id = ${claim.runId}`)[0]?.[
          "status"
        ],
      ).toBe("recovered")
      const events =
        await getClient()`select id, to_status, source, reason from execution_task_event
      where task_id = ${taskId} and source = 'recovery'`
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual(
        expect.objectContaining({ to_status: "failed", source: "recovery", reason: "step_failed" }),
      )
      const outbox =
        await getClient()`select event_id from execution_task_outbox where task_id = ${taskId}
      and event_id in (select id from execution_task_event where task_id = ${taskId} and source = 'recovery')`
      expect(outbox).toHaveLength(1)
      expect(outbox[0]?.["event_id"]).toBe(events[0]?.["id"])
      expect(
        (
          await getClient()`select count(*)::integer as count from audit_event where action = 'execution.task.recover' and target = ${`execution-task:${taskId}`}`
        )[0]?.["count"],
      ).toBe(1)
      expect(await worker.claimTask("worker-b", Date.now(), 30_000, taskId)).toBeNull()
    },
  )

  databaseTest(
    "recovers an API-claimed timed-out step without scheduling a false success",
    async () => {
      await prepare()
      const repository = createPostgresExecutionTaskRepository(getClient(), systemActor)
      await repository.submit(submission, actor)
      const claim = await repository.claimTask("worker-a", Date.now(), 30_000)
      if (claim === null) throw new Error("claim missing")
      const step = await repository.claimNext(
        taskId,
        claim.runId,
        "worker-a",
        claim.claimToken,
        Date.now(),
      )
      if (step === null) throw new Error("step missing")
      await getClient()`update execution_task_step set status = 'timed_out', finished_at = now() where id = ${step.stepId}`
      await getClient()`update execution_task_run set claim_expires_at = now() - interval '1 second' where id = ${claim.runId}`

      await repository.recoverStale(Date.now(), 10)

      expect(
        (
          await getClient()`select status, next_retry_at from execution_task where id = ${taskId}`
        )[0],
      ).toEqual(expect.objectContaining({ status: "timed_out", next_retry_at: null }))
      expect(
        (
          await getClient()`select to_status, reason from execution_task_event where task_id = ${taskId} and source = 'recovery'`
        )[0],
      ).toEqual(expect.objectContaining({ to_status: "timed_out", reason: "step_timed_out" }))
      expect(
        (
          await getClient()`select count(*)::integer as count from execution_task_outbox where task_id = ${taskId}
      and event_id in (select id from execution_task_event where task_id = ${taskId} and source = 'recovery')`
        )[0]?.["count"],
      ).toBe(1)
      expect(
        (
          await getClient()`select count(*)::integer as count from audit_event where action = 'execution.task.recover' and target = ${`execution-task:${taskId}`}`
        )[0]?.["count"],
      ).toBe(1)
      expect(await repository.claimTask("worker-b", Date.now(), 30_000)).toBeNull()
    },
  )

  databaseTest("recovers an API-claimed step through its persisted run pointer", async () => {
    await prepare()
    const repository = createPostgresExecutionTaskRepository(getClient(), systemActor)
    await repository.submit(submission, actor)
    const claim = await repository.claimTask("worker-a", Date.now(), 30_000)
    if (claim === null) throw new Error("claim missing")
    expect(
      await repository.claimNext(taskId, claim.runId, "worker-b", claim.claimToken, Date.now()),
    ).toBeNull()
    const step = await repository.claimNext(
      taskId,
      claim.runId,
      "worker-a",
      claim.claimToken,
      Date.now(),
    )
    if (step === null) throw new Error("step missing")
    expect(
      (await getClient()`select step_id from execution_task_run where id = ${claim.runId}`)[0]?.[
        "step_id"
      ],
    ).toBe(stepId)
    await getClient()`update execution_task_run set claim_expires_at = now() - interval '1 second' where id = ${claim.runId}`

    await repository.recoverStale(Date.now(), 10)

    expect(
      (
        await getClient()`select status, command_id, command_idempotency_key from execution_task_step where id = ${stepId}`
      )[0],
    ).toEqual(
      expect.objectContaining({
        status: "pending",
        command_id: commandId,
        command_idempotency_key: "command-key",
      }),
    )
    const due = (
      await getClient()`select next_retry_at from execution_task where id = ${taskId}`
    )[0]?.["next_retry_at"]
    if (!(due instanceof Date)) throw new Error("retry deadline missing")
    const retry = await repository.claimTask("worker-b", due.getTime(), 30_000)
    if (retry === null) throw new Error("retry claim missing")
    expect(
      (await repository.claimNext(taskId, retry.runId, "worker-b", retry.claimToken, Date.now()))
        ?.command.commandId,
    ).toBe(step.command.commandId)
    expect(
      await repository.claimNext(taskId, retry.runId, "worker-b", retry.claimToken, Date.now()),
    ).toBeNull()
  })

  databaseTest(
    "records worker claims from queued and retry_waiting in event, outbox, and audit",
    async () => {
      await prepare()
      const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
      const worker = createPostgresWorkerRepository(getClient(), { systemActor })
      await api.submit(submission, actor)
      const first = await worker.claimTask("worker-a", Date.now(), 30_000, taskId)
      if (first === null) throw new Error("claim missing")
      expect(await worker.claimTask("worker-b", Date.now(), 30_000, taskId)).toBeNull()
      expect(
        await worker.finishOwned(
          taskId,
          first.runId,
          first.claimToken,
          "dispatching",
          "retry_waiting",
          Date.now(),
        ),
      ).toBe(true)
      const due = (
        await getClient()`select next_retry_at from execution_task where id = ${taskId}`
      )[0]?.["next_retry_at"]
      if (!(due instanceof Date)) throw new Error("retry deadline missing")
      const retry = await worker.claimTask("worker-b", due.getTime(), 30_000, taskId)
      if (retry === null) throw new Error("retry claim missing")

      const claims = await getClient()`select id, from_status, to_status, source, reason, actor_id
      from execution_task_event where task_id = ${taskId} and source = 'claim' order by created_at, id`
      expect(
        claims.map((row) => ({
          from: row["from_status"],
          to: row["to_status"],
          source: row["source"],
          reason: row["reason"],
          actor: row["actor_id"],
        })),
      ).toEqual([
        { from: "queued", to: "dispatching", source: "claim", reason: "claimed", actor: userId },
        {
          from: "retry_waiting",
          to: "dispatching",
          source: "claim",
          reason: "claimed",
          actor: userId,
        },
      ])
      const outbox = await getClient()`select event_id, payload from execution_task_outbox
      where task_id = ${taskId} and event_id in (select id from execution_task_event where task_id = ${taskId} and source = 'claim')`
      expect(outbox).toHaveLength(2)
      expect(outbox.map((row) => row["event_id"]).sort()).toEqual(
        claims.map((row) => row["id"]).sort(),
      )
      expect(outbox.map((row) => row["payload"])).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fromStatus: "queued",
            toStatus: "dispatching",
            source: "claim",
            reason: "claimed",
          }),
          expect.objectContaining({
            fromStatus: "retry_waiting",
            toStatus: "dispatching",
            source: "claim",
            reason: "claimed",
          }),
        ]),
      )
      expect(
        (
          await getClient()`select count(*)::integer as count from audit_event where action = 'execution.task.claim' and target = ${`execution-task:${taskId}`} and actor_id = ${userId}`
        )[0]?.["count"],
      ).toBe(2)
    },
  )

  databaseTest(
    "resets a stale claimed step and reclaims its original command exactly once",
    async () => {
      await prepare()
      const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
      const worker = createPostgresWorkerRepository(getClient(), { systemActor })
      await api.submit(submission, actor)
      const first = await worker.claimTask("worker-a", Date.now(), 30_000, taskId)
      if (first === null) throw new Error("claim missing")
      const claimed = await worker.claimNext(
        taskId,
        first.runId,
        "worker-a",
        first.claimToken,
        Date.now(),
      )
      if (claimed === null) throw new Error("step missing")
      await getClient()`update execution_task_run set claim_expires_at = now() - interval '1 second' where id = ${first.runId}`

      await worker.recoverStale(Date.now(), 10)

      const step =
        await getClient()`select status, command_id, command_idempotency_key, error_code from execution_task_step where id = ${stepId}`
      expect(step[0]).toEqual(
        expect.objectContaining({
          status: "pending",
          command_id: commandId,
          command_idempotency_key: "command-key",
          error_code: "lease_expired",
        }),
      )
      expect(
        (
          await getClient()`select to_status from execution_task_event where task_id = ${taskId} order by created_at desc limit 1`
        )[0]?.["to_status"],
      ).toBe("retry_waiting")
      expect(
        (
          await getClient()`select count(*)::integer as count from execution_task_outbox where task_id = ${taskId}`
        )[0]?.["count"],
      ).toBe(4)
      expect(
        (
          await getClient()`select count(*)::integer as count from audit_event where action = 'execution.task.recover' and target = ${`execution-task:${taskId}`}`
        )[0]?.["count"],
      ).toBe(1)
      const due = (
        await getClient()`select next_retry_at from execution_task where id = ${taskId}`
      )[0]?.["next_retry_at"]
      if (!(due instanceof Date)) throw new Error("retry deadline missing")
      const retry = await worker.claimTask("worker-b", due.getTime(), 30_000, taskId)
      if (retry === null) throw new Error("retry claim missing")
      expect(
        (await worker.claimNext(taskId, retry.runId, "worker-b", retry.claimToken, Date.now()))
          ?.command.commandId,
      ).toBe(claimed.command.commandId)
      expect(
        await worker.claimNext(taskId, retry.runId, "worker-b", retry.claimToken, Date.now()),
      ).toBeNull()
    },
  )

  databaseTest(
    "records worker finish and rejects duplicate finish without additional transition",
    async () => {
      await prepare()
      const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
      const worker = createPostgresWorkerRepository(getClient(), { systemActor })
      await api.submit(submission, actor)
      const claim = await worker.claimTask("worker-a", Date.now(), 30_000, taskId)
      if (claim === null) throw new Error("claim missing")
      expect(
        await worker.finishOwned(
          taskId,
          claim.runId,
          claim.claimToken,
          "dispatching",
          "retry_waiting",
          Date.now(),
        ),
      ).toBe(true)
      expect(
        await worker.finishOwned(
          taskId,
          claim.runId,
          claim.claimToken,
          "dispatching",
          "retry_waiting",
          Date.now(),
        ),
      ).toBe(false)
      expect(
        (
          await getClient()`select status, next_retry_at, finished_at from execution_task where id = ${taskId}`
        )[0],
      ).toEqual(expect.objectContaining({ status: "retry_waiting", finished_at: null }))
      expect(
        (await getClient()`select status from execution_task_run where id = ${claim.runId}`)[0]?.[
          "status"
        ],
      ).toBe("failed")
      expect(
        (
          await getClient()`select to_status from execution_task_event where task_id = ${taskId} order by created_at desc limit 1`
        )[0]?.["to_status"],
      ).toBe("retry_waiting")
      expect(
        (
          await getClient()`select count(*)::integer as count from execution_task_outbox where task_id = ${taskId}`
        )[0]?.["count"],
      ).toBe(3)
      expect(
        (
          await getClient()`select count(*)::integer as count from audit_event where action = 'execution.task.finish' and target = ${`execution-task:${taskId}`}`
        )[0]?.["count"],
      ).toBe(1)
    },
  )

  databaseTest("marks an exhausted worker retry terminal with no retry schedule", async () => {
    await prepare()
    const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
    const worker = createPostgresWorkerRepository(getClient(), { systemActor })
    await api.submit(submission, actor)
    await getClient()`update execution_task set retry_count = 2 where id = ${taskId}`
    const claim = await worker.claimTask("worker-a", Date.now(), 30_000, taskId)
    if (claim === null) throw new Error("claim missing")
    const step = await worker.claimNext(
      taskId,
      claim.runId,
      "worker-a",
      claim.claimToken,
      Date.now(),
    )
    if (step === null) throw new Error("step missing")
    expect(
      await worker.retryStep(
        taskId,
        claim.runId,
        "worker-a",
        claim.claimToken,
        step.stepId,
        "unavailable",
        "temporarily unavailable",
        Date.now(),
      ),
    ).toBe(true)

    expect(
      await worker.finishOwned(
        taskId,
        claim.runId,
        claim.claimToken,
        "running",
        "retry_waiting",
        Date.now(),
      ),
    ).toBe(true)

    expect(
      (
        await getClient()`select status, retry_count, finished_at, next_retry_at, terminal_reason from execution_task where id = ${taskId}`
      )[0],
    ).toEqual(
      expect.objectContaining({
        status: "failed",
        retry_count: 3,
        next_retry_at: null,
        terminal_reason: "retry_exhausted",
      }),
    )
    expect(
      (await getClient()`select status from execution_task_step where id = ${stepId}`)[0]?.[
        "status"
      ],
    ).toBe("failed")
    expect(
      (
        await getClient()`select to_status from execution_task_event where task_id = ${taskId} order by created_at desc limit 1`
      )[0]?.["to_status"],
    ).toBe("failed")
  })

  databaseTest(
    "persists successful worker finish with matching event, outbox and audit",
    async () => {
      await prepare()
      const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
      const worker = createPostgresWorkerRepository(getClient(), { systemActor })
      await api.submit(submission, actor)
      const claim = await worker.claimTask("worker-a", Date.now(), 30_000, taskId)
      if (claim === null) throw new Error("claim missing")
      const step = await worker.claimNext(
        taskId,
        claim.runId,
        "worker-a",
        claim.claimToken,
        Date.now(),
      )
      if (step === null) throw new Error("step missing")
      expect(
        await worker.finishStep(
          taskId,
          claim.runId,
          "worker-a",
          claim.claimToken,
          step.stepId,
          "succeeded",
          {
            commandId: command.commandId,
            status: "succeeded",
            outcome: { kind: "acknowledged" },
            retryable: false,
          },
          undefined,
          undefined,
          Date.now(),
        ),
      ).toBe(true)

      expect(
        await worker.finishOwned(
          taskId,
          claim.runId,
          claim.claimToken,
          "running",
          "succeeded",
          Date.now(),
        ),
      ).toBe(true)

      const events =
        await getClient()`select id, to_status from execution_task_event where task_id = ${taskId} order by created_at, id`
      expect(events.map((event) => event["to_status"])).toEqual([
        "queued",
        "dispatching",
        "running",
        "succeeded",
      ])
      const outbox = await getClient()`select event_id from execution_task_outbox
        where task_id = ${taskId} and event_type = 'execution_task.status_changed'`
      expect(outbox.map((row) => row["event_id"]).sort()).toEqual(
        events
          .slice(1)
          .map((event) => event["id"])
          .sort(),
      )
      expect(
        (
          await getClient()`select count(*)::integer as count from audit_event where action = 'execution.task.finish' and target = ${`execution-task:${taskId}`}`
        )[0]?.["count"],
      ).toBe(1)
      expect(
        (await getClient()`select status, finished_at from execution_task where id = ${taskId}`)[0],
      ).toEqual(expect.objectContaining({ status: "succeeded", finished_at: expect.any(Date) }))
    },
  )

  databaseTest(
    "never stores adapter result credentials or provider error text in step or transitions",
    async () => {
      await prepare()
      const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
      const worker = createPostgresWorkerRepository(getClient(), { systemActor })
      await api.submit(submission, actor)
      const claim = await worker.claimTask("worker-a", Date.now(), 30_000, taskId)
      if (claim === null) throw new Error("claim missing")
      const step = await worker.claimNext(
        taskId,
        claim.runId,
        "worker-a",
        claim.claimToken,
        Date.now(),
      )
      if (step === null) throw new Error("step missing")
      const result = {
        commandId: command.commandId,
        status: "failed" as const,
        retryable: false,
        providerReceiptId: "Bearer provider-receipt-secret",
        error: { code: "failed" as const, message: "password=raw-provider-secret" },
        nested: {
          password: "nested-password",
          token: "nested-token",
          authorization: "nested-auth",
        },
      }

      expect(
        await worker.finishStep(
          taskId,
          claim.runId,
          "worker-a",
          claim.claimToken,
          step.stepId,
          "failed",
          result,
          "failed",
          "Authorization: raw-provider-secret",
          Date.now(),
        ),
      ).toBe(true)
      expect(
        await worker.finishOwned(
          taskId,
          claim.runId,
          claim.claimToken,
          "running",
          "failed",
          Date.now(),
        ),
      ).toBe(true)

      const stored = (
        await getClient()`select result, error_code, error_message from execution_task_step where id = ${stepId}`
      )[0]
      expect(stored?.["result"]).toEqual({
        commandId,
        status: "failed",
        retryable: false,
        error: { code: "failed" },
      })
      expect(stored?.["error_code"]).toBe("failed")
      expect(String(stored?.["error_message"])).not.toContain("raw-provider-secret")
      expect(String(stored?.["error_message"]).length).toBeLessThanOrEqual(160)
      const transitions =
        await getClient()`select event_type, payload from execution_task_outbox where task_id = ${taskId}`
      const events =
        await getClient()`select source, reason from execution_task_event where task_id = ${taskId}`
      const audits =
        await getClient()`select action, metadata from audit_event where target = ${`execution-task:${taskId}`}`
      expect(JSON.stringify({ transitions, events, audits, stored })).not.toMatch(
        /raw-provider-secret|nested-password|nested-token|nested-auth|provider-receipt-secret/,
      )
    },
  )

  databaseTest("normalizes retryStep provider errors before pending-step persistence", async () => {
    await prepare()
    const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
    const worker = createPostgresWorkerRepository(getClient(), { systemActor })
    await api.submit(submission, actor)
    const claim = await worker.claimTask("worker-a", Date.now(), 30_000, taskId)
    if (claim === null) throw new Error("claim missing")
    const step = await worker.claimNext(
      taskId,
      claim.runId,
      "worker-a",
      claim.claimToken,
      Date.now(),
    )
    if (step === null) throw new Error("step missing")

    expect(
      await worker.retryStep(
        taskId,
        claim.runId,
        "worker-a",
        claim.claimToken,
        step.stepId,
        "Bearer raw-provider-secret",
        "token=raw-provider-secret",
        Date.now(),
      ),
    ).toBe(true)

    const stored = (
      await getClient()`select status, error_code, error_message from execution_task_step where id = ${stepId}`
    )[0]
    expect(stored?.["status"]).toBe("pending")
    expect(stored?.["error_code"]).toBe("unknown")
    expect(JSON.stringify(stored)).not.toContain("raw-provider-secret")
  })

  databaseTest("rejects success after cancellation without mutating the claimed step", async () => {
    await prepare()
    const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
    const worker = createPostgresWorkerRepository(getClient(), { systemActor })
    await api.submit(submission, actor)
    const claim = await worker.claimTask("worker-a", Date.now(), 30_000, taskId)
    if (claim === null) throw new Error("claim missing")
    await worker.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, Date.now())
    await api.requestCancel(groupId, taskId, actor, Date.now())
    expect(
      await worker.finishStep(
        taskId,
        claim.runId,
        "worker-a",
        claim.claimToken,
        stepId,
        "succeeded",
        undefined,
        undefined,
        undefined,
        Date.now(),
      ),
    ).toBe(false)
    expect(
      (await getClient()`select status from execution_task_step where id = ${stepId}`)[0]?.[
        "status"
      ],
    ).toBe("claimed")
  })

  databaseTest(
    "serializes wide and instance leases in both orders with direct commands",
    async () => {
      await prepare()
      const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
      const worker = createPostgresWorkerRepository(getClient(), { systemActor })
      const commands = createPostgresDeviceCommandRepository(getClient())
      const instanceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      await getClient()`insert into device_instance (id, device_id, instance_index, label) values (${instanceId}, ${deviceId}, 1, 'test')`
      await api.submit(submission, actor)
      const lease = (id: string, instance?: string) => ({
        leaseId: id,
        taskId,
        groupId,
        deviceId,
        ...(instance === undefined ? {} : { instanceId: instance }),
        leaseToken: id,
        workerId: "worker-a",
        expiresAt: Date.now() + 30_000,
      })
      const wide = lease("77777777-7777-4777-8777-777777777777")
      const narrow = lease("88888888-8888-4888-8888-888888888888", instanceId)
      const direct = {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        groupId,
        deviceId,
        instanceId,
        idempotencyKey: "direct",
        fingerprint: "direct",
        requesterId: userId,
        kind: "health_check" as const,
        parameters: {},
        timeoutMs: 1000,
      }
      const auditInput = {
        actorId: userId,
        action: "device.command.create",
        outcome: "allowed" as const,
        target: `device-command:${direct.id}`,
      }
      expect(await worker.acquireDeviceLease(wide)).toBe(true)
      expect(await api.acquireDeviceLease(narrow)).toBe(false)
      expect(await captureError(() => commands.submit(direct, auditInput))).toBeInstanceOf(
        CommandConflictError,
      )
      expect(await worker.releaseDeviceLease(wide.leaseId, wide.leaseToken, "finished")).toBe(true)
      expect(await api.acquireDeviceLease(narrow)).toBe(true)
      expect(await worker.acquireDeviceLease(lease("99999999-9999-4999-8999-999999999999"))).toBe(
        false,
      )
      expect(await captureError(() => commands.submit(direct, auditInput))).toBeInstanceOf(
        CommandConflictError,
      )
      expect(
        await captureError(() => commands.submit({ ...direct, instanceId: null }, auditInput)),
      ).toBeInstanceOf(CommandConflictError)
      expect(await api.releaseDeviceLease(narrow.leaseId, narrow.leaseToken, "finished")).toBe(true)
      await commands.submit(direct, auditInput)
      expect(await worker.acquireDeviceLease(lease("cccccccc-cccc-4ccc-8ccc-cccccccccccc"))).toBe(
        false,
      )
    },
  )

  databaseTest("serializes concurrent opposite-scope lease acquisitions", async () => {
    await prepare()
    const api = createPostgresExecutionTaskRepository(getClient(), systemActor)
    const worker = createPostgresWorkerRepository(getClient(), { systemActor })
    const instanceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    await getClient()`insert into device_instance (id, device_id, instance_index, label) values (${instanceId}, ${deviceId}, 1, 'test')`
    await api.submit(submission, actor)
    const wide = {
      leaseId: "77777777-7777-4777-8777-777777777777",
      taskId,
      groupId,
      deviceId,
      leaseToken: "wide",
      workerId: "worker-a",
      expiresAt: Date.now() + 30_000,
    }
    const narrow = {
      ...wide,
      leaseId: "88888888-8888-4888-8888-888888888888",
      leaseToken: "narrow",
      instanceId,
    }

    const results = await Promise.all([
      worker.acquireDeviceLease(wide),
      api.acquireDeviceLease(narrow),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
  })
  databaseTest("atomically submits task state, event, outbox, steps, and audit", async () => {
    await prepare()
    const repository = createPostgresExecutionTaskRepository(getClient(), systemActor)

    const created = await repository.submit(submission, actor)
    const duplicate = await repository.submit(submission, actor)

    expect(created.created).toBe(true)
    expect(duplicate.created).toBe(false)
    expect(
      (await getClient()`select count(*)::integer as count from execution_task`)[0]?.["count"],
    ).toBe(1)
    expect(
      (await getClient()`select count(*)::integer as count from execution_task_event`)[0]?.[
        "count"
      ],
    ).toBe(1)
    expect(
      (await getClient()`select count(*)::integer as count from execution_task_outbox`)[0]?.[
        "count"
      ],
    ).toBe(1)
    expect(
      (
        await getClient()`select count(*)::integer as count from audit_event where target = ${`execution-task:${taskId}`}`
      )[0]?.["count"],
    ).toBe(1)
    expect(
      await captureError(() => repository.submit({ ...submission, fingerprint: "changed" }, actor)),
    ).toBeInstanceOf(Error)
  })

  databaseTest("rolls back the aggregate when a step insert fails", async () => {
    await prepare()
    const repository = createPostgresExecutionTaskRepository(getClient(), systemActor)
    const firstStep = submission.steps[0]
    if (firstStep === undefined) throw new Error("test submission missing step")
    expect(
      await captureError(() =>
        repository.submit(
          {
            ...submission,
            taskId: "88888888-8888-4888-8888-888888888888",
            idempotencyKey: "rollback-key",
            steps: [firstStep, { ...firstStep, stepId: "99999999-9999-4999-8999-999999999999" }],
          },
          actor,
        ),
      ),
    ).toBeInstanceOf(Error)
    expect(
      (await getClient()`select count(*)::integer as count from execution_task`)[0]?.["count"],
    ).toBe(0)
    expect(
      (await getClient()`select count(*)::integer as count from execution_task_event`)[0]?.[
        "count"
      ],
    ).toBe(0)
    expect(
      (await getClient()`select count(*)::integer as count from execution_task_outbox`)[0]?.[
        "count"
      ],
    ).toBe(0)
  })

  databaseTest("serializes claims and rejects stale ownership on finish", async () => {
    await prepare()
    const repository = createPostgresExecutionTaskRepository(getClient(), systemActor)
    await repository.submit(submission, actor)
    const [first, second] = await Promise.all([
      repository.claimTask("worker-a", Date.now(), 30_000),
      repository.claimTask("worker-b", Date.now(), 30_000),
    ])
    const claim = first ?? second
    expect(claim).not.toBeNull()
    expect(first === null || second === null).toBe(true)
    if (claim === null) return
    const claimOwner = first === null ? "worker-b" : "worker-a"
    expect(
      await repository.claimNext(taskId, claim.runId, "wrong-owner", claim.claimToken, Date.now()),
    ).toBeNull()
    expect(
      await repository.claimNext(taskId, claim.runId, claimOwner, claim.claimToken, Date.now()),
    ).not.toBeNull()
    expect(
      await repository.finishOwned(
        taskId,
        claim.runId,
        "old-token",
        "dispatching",
        "succeeded",
        Date.now(),
      ),
    ).toBe(false)
    const worker = createPostgresWorkerRepository(getClient(), { systemActor })
    expect(
      await worker.finishStep(
        taskId,
        claim.runId,
        claimOwner,
        claim.claimToken,
        stepId,
        "succeeded",
        {
          commandId: command.commandId,
          status: "succeeded",
          outcome: { kind: "acknowledged" },
          retryable: false,
        },
        undefined,
        undefined,
        Date.now(),
      ),
    ).toBe(true)
    expect(
      await repository.finishOwned(
        taskId,
        claim.runId,
        claim.claimToken,
        "running",
        "succeeded",
        Date.now(),
      ),
    ).toBe(true)
  })

  databaseTest("claims steps strictly in sequence under the owning run", async () => {
    await prepare()
    const repository = createPostgresExecutionTaskRepository(getClient(), systemActor)
    await repository.submit(submission, actor)
    const secondStepId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    await getClient()`insert into execution_task_step
      (id, task_id, group_id, sequence, command_id, command_idempotency_key, fingerprint, kind, target, parameters)
      values (${secondStepId}, ${taskId}, ${groupId}, 1, ${commandId}, 'command-key-2', 'step-fingerprint-2', 'health_check',
        ${getClient().json(command.target)}, ${getClient().json(command)})`
    const claim = await repository.claimTask("worker-a", Date.now(), 30_000)
    if (claim === null) return
    expect(
      await repository.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, Date.now()),
    ).not.toBeNull()
    expect(
      await repository.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, Date.now()),
    ).toBeNull()
    await getClient()`update execution_task_step set status = 'succeeded' where sequence = 0 and task_id = ${taskId}`
    expect(
      await repository.claimNext(taskId, claim.runId, "worker-a", claim.claimToken, Date.now()),
    ).not.toBeNull()
  })

  databaseTest("cancels retry-waiting tasks and emits the transition work", async () => {
    await prepare()
    const repository = createPostgresExecutionTaskRepository(getClient(), systemActor)
    await repository.submit(submission, actor)
    await getClient()`update execution_task set status = 'retry_waiting' where id = ${taskId}`
    expect(await repository.requestCancel(groupId, taskId, actor, Date.now())).toBe(true)
    expect(
      (await getClient()`select status from execution_task where id = ${taskId}`)[0]?.["status"],
    ).toBe("cancelled")
    expect(
      (
        await getClient()`select to_status from execution_task_event where task_id = ${taskId} order by created_at desc limit 1`
      )[0]?.["to_status"],
    ).toBe("cancelled")
    expect(
      (
        await getClient()`select count(*)::integer as count from execution_task_outbox where task_id = ${taskId}`
      )[0]?.["count"],
    ).toBe(2)
  })

  databaseTest("recovers stale ownership with terminal event and outbox atomically", async () => {
    await prepare()
    const repository = createPostgresExecutionTaskRepository(getClient(), systemActor)
    await repository.submit(submission, actor)
    const claim = await repository.claimTask("worker-a", Date.now(), 30_000)
    if (claim === null) return
    await getClient()`update execution_task set retry_count = 2 where id = ${taskId}`
    await getClient()`update execution_task_run set claim_expires_at = now() - interval '1 second' where id = ${claim.runId}`
    await repository.recoverStale(Date.now(), 10)
    expect(
      (
        await getClient()`select status, finished_at, terminal_reason from execution_task where id = ${taskId}`
      )[0],
    ).toEqual(expect.objectContaining({ status: "failed", terminal_reason: "lease_expired" }))
    expect(
      (
        await getClient()`select to_status from execution_task_event where task_id = ${taskId} order by created_at desc limit 1`
      )[0]?.["to_status"],
    ).toBe("failed")
    expect(
      (
        await getClient()`select count(*)::integer as count from execution_task_outbox where task_id = ${taskId}`
      )[0]?.["count"],
    ).toBe(3)
  })

  databaseTest(
    "keeps outbox delivery owner-scoped and coordinates deletion protection",
    async () => {
      await prepare()
      const repository = createPostgresExecutionTaskRepository(getClient(), systemActor)
      await repository.submit(submission, actor)
      const messages = await repository.claimAvailable("outbox-a", Date.now(), 1)
      expect(messages).toHaveLength(1)
      const message = messages[0]
      if (message === undefined) return
      await repository.acknowledge({
        outboxId: message.outboxId,
        owner: "outbox-b",
        claimAttempt: message.claimAttempt ?? 0,
        now: Date.now(),
      })
      expect(
        (
          await getClient()`select status from execution_task_outbox where id = ${message.outboxId}`
        )[0]?.["status"],
      ).toBe("claimed")
      await repository.acknowledge({
        outboxId: message.outboxId,
        owner: "outbox-a",
        claimAttempt: message.claimAttempt ?? 0,
        now: Date.now(),
      })
      expect(
        (
          await getClient()`select status from execution_task_outbox where id = ${message.outboxId}`
        )[0]?.["status"],
      ).toBe("delivered")

      await repository.acquireDeviceLease({
        leaseId: "77777777-7777-4777-8777-777777777777",
        taskId,
        groupId,
        deviceId,
        leaseToken: "lease-token",
        workerId: "worker-a",
        expiresAt: Date.now() + 30_000,
      })
      const devices = createPostgresDeviceRepository(getClient())
      expect(
        await captureError(() =>
          devices.deleteDevice(GroupIdSchema.parse(groupId), DeviceIdSchema.parse(deviceId)),
        ),
      ).toBeInstanceOf(Error)
    },
  )

  databaseTest("rejects an expired API outbox ack from the same owner after reclaim", async () => {
    await prepare()
    const repository = createPostgresExecutionTaskRepository(getClient(), systemActor)
    await repository.submit(submission, actor)
    const started = Date.now() + 5000
    const first = (await repository.claimAvailable("outbox-a", started, 1))[0]
    const second = (await repository.claimAvailable("outbox-a", started + 30_000, 1))[0]
    if (first === undefined || second === undefined) throw new Error("Expected two delivery claims")

    await repository.acknowledge({
      outboxId: first.outboxId,
      owner: "outbox-a",
      claimAttempt: first.claimAttempt ?? 0,
      now: started + 30_000,
    })

    const rows =
      await getClient()`select status, attempt_count from execution_task_outbox where id = ${first.outboxId}`
    expect(rows[0]).toMatchObject({ status: "claimed", attempt_count: 2 })
    expect([first.claimAttempt, second.claimAttempt]).toEqual([1, 2])
    await repository.acknowledge({
      outboxId: second.outboxId,
      owner: "outbox-a",
      claimAttempt: second.claimAttempt ?? 0,
      now: started + 30_000,
    })
    expect(
      (
        await getClient()`select status from execution_task_outbox where id = ${second.outboxId}`
      )[0]?.["status"],
    ).toBe("delivered")
  })

  databaseTest("rejects an expired API outbox fail from the same owner after reclaim", async () => {
    await prepare()
    const repository = createPostgresExecutionTaskRepository(getClient(), systemActor)
    await repository.submit(submission, actor)
    const started = Date.now() + 5000
    const first = (await repository.claimAvailable("outbox-a", started, 1))[0]
    const second = (await repository.claimAvailable("outbox-a", started + 30_000, 1))[0]
    if (first === undefined || second === undefined) throw new Error("Expected two delivery claims")

    await repository.fail(
      {
        outboxId: first.outboxId,
        owner: "outbox-a",
        claimAttempt: first.claimAttempt ?? 0,
        now: started + 30_000,
      },
      started + 30_000,
    )

    const rows =
      await getClient()`select status, attempt_count from execution_task_outbox where id = ${first.outboxId}`
    expect(rows[0]).toMatchObject({ status: "claimed", attempt_count: 2 })
    expect([first.claimAttempt, second.claimAttempt]).toEqual([1, 2])
    await repository.fail(
      {
        outboxId: second.outboxId,
        owner: "outbox-a",
        claimAttempt: second.claimAttempt ?? 0,
        now: started + 30_000,
      },
      started + 30_000,
    )
    expect(
      (
        await getClient()`select status from execution_task_outbox where id = ${second.outboxId}`
      )[0]?.["status"],
    ).toBe("pending")
  })
})
