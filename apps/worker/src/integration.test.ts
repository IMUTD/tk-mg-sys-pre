// biome-ignore-all lint/complexity/useLiteralKeys: Bun.env is index-signature typed.
import { describe, expect, it } from "bun:test"
import { createPostgresWorkerRepository } from "@tk-mg/task-execution"
import postgres from "postgres"

describe("worker PostgreSQL integration", () => {
  it.skipIf(Bun.env["TEST_DATABASE_URL"] === undefined)(
    "rejects both stale run and device lease renewals after a second client takes ownership",
    async () => {
      const url = Bun.env["TEST_DATABASE_URL"]
      if (url === undefined || !new URL(url).pathname.slice(1).startsWith("tk_mg_test_"))
        throw new Error("A disposable tk_mg_test_* database is required")
      const first = postgres(url, { max: 1 })
      const second = postgres(url, { max: 1 })
      const actorId = crypto.randomUUID()
      const groupId = crypto.randomUUID()
      const deviceId = crypto.randomUUID()
      const taskId = crypto.randomUUID()
      const runId = crypto.randomUUID()
      const leaseId = crypto.randomUUID()
      const now = Date.now()
      try {
        await first`insert into access_group (id, name) values (${groupId}, ${`ownership-${groupId}`})`
        await first`insert into app_user (id, email, password_hash, role)
          values (${actorId}, ${`ownership-${actorId}@example.test`}, 'test', 'administrator')`
        await first`insert into device (id, group_id, name, host, model)
          values (${deviceId}, ${groupId}, 'ownership device', ${`ownership-${deviceId}`}, 'test')`
        await first`insert into execution_task
          (id, group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters)
          values (${taskId}, ${groupId}, ${actorId}, ${deviceId}, 'ownership', 'ownership', 'ownership', 'device-command', '{}'::jsonb)`
        await first`insert into execution_task_run
          (id, task_id, group_id, attempt, status, worker_id, claim_token, claim_expires_at)
          values (${runId}, ${taskId}, ${groupId}, 1, 'claimed', 'worker-a', 'token-a', ${new Date(now + 30_000)})`
        await first`insert into execution_task_device_lease
          (id, task_id, group_id, device_id, lease_token, worker_id, expires_at)
          values (${leaseId}, ${taskId}, ${groupId}, ${deviceId}, 'lease-a', 'worker-a', ${new Date(now + 30_000)})`
        const repository = createPostgresWorkerRepository(first)
        await second`update execution_task_run set worker_id = 'worker-b', claim_token = 'token-b'
          where id = ${runId}`
        await second`update execution_task_device_lease set worker_id = 'worker-b', lease_token = 'lease-b'
          where id = ${leaseId}`

        expect(await repository.renewTask(taskId, runId, "token-a", now, 30_000)).toBe(false)
        expect(await repository.renewDeviceLease(leaseId, "lease-a", now + 30_000, now)).toBe(false)
        expect(await repository.renewTask(taskId, runId, "token-b", now, 30_000)).toBe(true)
        expect(await repository.renewDeviceLease(leaseId, "lease-b", now + 30_000, now)).toBe(true)
        const state = await second<{ readonly owner: string; readonly token: string }[]>`
          select worker_id as owner, claim_token as token from execution_task_run where id = ${runId}`
        expect(state[0]).toEqual({ owner: "worker-b", token: "token-b" })
      } finally {
        try {
          await first`delete from execution_task_device_lease where id = ${leaseId}`
          await first`delete from execution_task_run where id = ${runId}`
          await first`delete from execution_task where id = ${taskId}`
          await first`delete from device where id = ${deviceId}`
          await first`delete from app_user where id = ${actorId}`
          await first`delete from access_group where id = ${groupId}`
        } finally {
          await first.end()
          await second.end()
        }
      }
    },
  )
  it.skipIf(Bun.env["TEST_DATABASE_URL"] === undefined)(
    "connects to the migrated disposable database and exposes worker readiness",
    async () => {
      const url = Bun.env["TEST_DATABASE_URL"]
      if (url === undefined) throw new Error("TEST_DATABASE_URL is required")
      const client = postgres(url, { max: 1 })
      const actorId = crypto.randomUUID()
      try {
        await client`insert into app_user (id, email, password_hash, role, enabled)
          values (${actorId}, ${`worker-actor-${actorId}@example.test`}, 'test', 'administrator', false)`
        const repository = createPostgresWorkerRepository(client, {
          systemActor: {
            actorId,
            actorType: "system",
            requestId: "worker-integration",
          },
        })
        await repository.checkReadiness()
        const rows = await client<{ readonly tableName: string | null }[]>`
          select to_regclass('public.execution_task_outbox') as "tableName"
        `
        expect(rows[0]?.tableName).toBe("execution_task_outbox")
      } finally {
        try {
          await client`delete from app_user where id = ${actorId}`
        } finally {
          await client.end()
        }
      }
    },
  )

  it.skipIf(Bun.env["TEST_DATABASE_URL"] === undefined)(
    "requires an existing disabled administrator system actor for readiness",
    async () => {
      const url = Bun.env["TEST_DATABASE_URL"]
      if (url === undefined) throw new Error("TEST_DATABASE_URL is required")
      const client = postgres(url, { max: 1 })
      const actorId = crypto.randomUUID()
      try {
        const repository = createPostgresWorkerRepository(client, {
          systemActor: {
            actorId,
            actorType: "system",
            requestId: "worker-actor-readiness",
          },
        })
        expect(
          await repository.checkReadiness().then(
            () => undefined,
            (error: unknown) => error,
          ),
        ).toHaveProperty(
          "message",
          "Configured system actor must be an existing disabled administrator",
        )

        await client`insert into app_user (id, email, password_hash, role, enabled)
          values (${actorId}, ${`worker-actor-${actorId}@example.test`}, 'test', 'administrator', false)`
        await repository.checkReadiness()

        await client`update app_user set enabled = true where id = ${actorId}`
        expect(
          await repository.checkReadiness().then(
            () => undefined,
            (error: unknown) => error,
          ),
        ).toHaveProperty(
          "message",
          "Configured system actor must be an existing disabled administrator",
        )

        await client`update app_user set enabled = false, role = 'operator' where id = ${actorId}`
        expect(
          await repository.checkReadiness().then(
            () => undefined,
            (error: unknown) => error,
          ),
        ).toHaveProperty(
          "message",
          "Configured system actor must be an existing disabled administrator",
        )
      } finally {
        try {
          await client`delete from app_user where id = ${actorId}`
        } finally {
          await client.end()
        }
      }
    },
  )
})
