import { describe, expect, it } from "bun:test"

import { createMigratedTestDatabase, hasConfiguredTestDatabase } from "./test-database"

const databaseIntegrationTest = hasConfiguredTestDatabase ? it : it.skip

const tableNames = [
  "execution_task",
  "execution_task_step",
  "execution_task_event",
  "execution_task_outbox",
  "execution_task_run",
  "execution_task_device_lease",
] as const

const idOf = (rows: readonly { readonly id: string }[]): string => {
  const row = rows[0]
  if (row === undefined) {
    throw new Error("expected inserted row")
  }
  return row.id
}

const expectDatabaseRejection = async (operation: () => Promise<unknown>): Promise<void> => {
  let caughtError: unknown = null
  try {
    await operation()
  } catch (error) {
    caughtError = error
  }
  expect(caughtError).toBeInstanceOf(Error)
}

describe("execution task schema", () => {
  databaseIntegrationTest(
    "preserves historical tasks and enforces execution integrity",
    async () => {
      const database = await createMigratedTestDatabase()
      try {
        const historicalColumns = await database.client<{ column_name: string }[]>`
        select column_name
        from information_schema.columns
        where table_schema = 'public' and table_name = 'operation_task'
        order by ordinal_position
      `
        expect(historicalColumns.map(({ column_name }) => column_name).sort()).toEqual(
          [
            "attempt",
            "cancelled_at",
            "cancel_requested_at",
            "created_at",
            "error_code",
            "group_id",
            "heartbeat_at",
            "id",
            "idempotency_key",
            "name",
            "next_run_at",
            "started_at",
            "status",
            "template_id",
            "updated_at",
          ].sort(),
        )

        const tables = await database.client<{ table_name: string }[]>`
        select table_name
        from information_schema.tables
        where table_schema = 'public' and table_name = any(${tableNames})
        order by table_name
        `
        expect(tables.map(({ table_name }) => table_name)).toEqual([...tableNames].sort())

        const columns = await database.client<{ table_name: string; column_name: string }[]>`
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'public' and table_name = any(${tableNames})
        order by table_name, ordinal_position
      `
        const columnsByTable = Map.groupBy(columns, ({ table_name }) => table_name)
        expect(columnsByTable.get("execution_task")?.map(({ column_name }) => column_name)).toEqual(
          [
            "id",
            "group_id",
            "requester_id",
            "device_id",
            "idempotency_key",
            "fingerprint",
            "name",
            "executor_key",
            "parameters",
            "status",
            "retry_count",
            "max_attempts",
            "next_retry_at",
            "last_retry_at",
            "created_at",
            "updated_at",
            "started_at",
            "finished_at",
            "cancel_requested_at",
            "terminal_reason",
            "error_code",
            "error_message",
            "result",
            "account_id",
          ],
        )
        expect(
          columnsByTable.get("execution_task_outbox")?.map(({ column_name }) => column_name),
        ).toEqual([
          "id",
          "event_id",
          "task_id",
          "group_id",
          "available_at",
          "claimed_at",
          "claimed_by",
          "claim_expires_at",
          "delivered_at",
          "dead_lettered_at",
          "event_type",
          "attempt_count",
          "last_error",
          "payload",
          "status",
          "created_at",
        ])

        const groupId = await database.client<{ id: string }[]>`
        insert into access_group (name) values ('execution-test-group') returning id
      `
        const otherGroupId = await database.client<{ id: string }[]>`
        insert into access_group (name) values ('execution-test-other-group') returning id
      `
        const userId = await database.client<{ id: string }[]>`
        insert into app_user (email, password_hash, role) values ('execution-test@example.com', 'hash', 'administrator') returning id
      `
        const deviceId = await database.client<{ id: string }[]>`
        insert into device (group_id, host, model, name) values (${idOf(groupId)}, 'lease-host', 'model', 'Lease') returning id
      `
        const otherDeviceId = await database.client<{ id: string }[]>`
        insert into device (group_id, host, model, name) values (${idOf(otherGroupId)}, 'other-lease-host', 'model', 'Other Lease') returning id
      `
        const taskId = await database.client<{ id: string }[]>`
        insert into execution_task (group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters)
        values (${idOf(groupId)}, ${idOf(userId)}, ${idOf(deviceId)}, 'same-key', 'fingerprint-a', 'Task', 'executor', '{}'::jsonb)
        returning id
      `
        const otherTaskId = await database.client<{ id: string }[]>`
        insert into execution_task (group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters)
        values (${idOf(otherGroupId)}, ${idOf(userId)}, ${idOf(otherDeviceId)}, 'other-key', 'fingerprint-b', 'Other task', 'executor', '{}'::jsonb)
        returning id
      `

        await expectDatabaseRejection(async () => {
          await database.client`
          insert into execution_task (group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters)
          values (${idOf(groupId)}, ${idOf(userId)}, ${idOf(deviceId)}, 'same-key', 'fingerprint-c', 'Duplicate', 'executor', '{}'::jsonb)
        `
        })
        expect(
          (await database.client<{ count: string }[]>`select count(*) from execution_task_step`)[0]
            ?.count,
        ).toBe("0")

        await database.client`
        insert into execution_task_step
          (task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters)
        values (${idOf(taskId)}, ${idOf(groupId)}, 1, 'step-key-a', 'step-a', 'command', '{}'::jsonb, '{}'::jsonb)
      `
        expect(
          (await database.client<{ count: string }[]>`select count(*) from execution_task_step`)[0]
            ?.count,
        ).toBe("1")
        await expectDatabaseRejection(async () => {
          await database.client`delete from device where id = ${idOf(deviceId)}`
        })
        await expectDatabaseRejection(async () => {
          await database.client`
          insert into execution_task_step
            (task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters)
          values (${idOf(taskId)}, ${idOf(groupId)}, 1, 'step-key-b', 'step-b', 'command', '{}'::jsonb, '{}'::jsonb)
        `
        })

        await expectDatabaseRejection(async () => {
          await database.client`
          insert into execution_task (group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters, status)
          values (${idOf(groupId)}, ${idOf(userId)}, ${idOf(deviceId)}, 'bad-status', 'fingerprint-d', 'Bad', 'executor', '{}'::jsonb, 'bogus')
        `
        })

        await database.client`
          insert into execution_task (group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters, status)
          values (${idOf(groupId)}, ${idOf(userId)}, ${idOf(deviceId)}, 'reconciliation-status', 'fingerprint-e', 'Reconciliation', 'executor', '{}'::jsonb, 'needs_reconciliation')
        `
        await database.client`
          insert into execution_task_event (task_id, group_id, to_status, source)
          values (${idOf(taskId)}, ${idOf(groupId)}, 'needs_reconciliation', 'schema-test')
        `

        await expectDatabaseRejection(async () => {
          await database.client`
          insert into execution_task_step
            (task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters)
          values (${idOf(taskId)}, ${idOf(otherGroupId)}, 2, 'step-key-cross-group', 'cross-group', 'command', '{}'::jsonb, '{}'::jsonb)
        `
        })

        await database.client`
        insert into execution_task_run (task_id, group_id, attempt, status, worker_id, claim_token)
        values (${idOf(taskId)}, ${idOf(groupId)}, 1, 'claimed', 'schema-test-worker', 'claim-a')
      `
        await database.client`
        insert into execution_task_device_lease
          (task_id, group_id, device_id, lease_token, expires_at)
        values (${idOf(taskId)}, ${idOf(groupId)}, ${idOf(deviceId)}, 'lease-a', now() + interval '5 minutes')
      `
        await expectDatabaseRejection(async () => {
          await database.client`
          insert into execution_task_device_lease
            (task_id, group_id, device_id, lease_token, expires_at)
          values (${idOf(taskId)}, ${idOf(groupId)}, ${idOf(deviceId)}, 'lease-b', now() + interval '5 minutes')
          `
        })

        await expectDatabaseRejection(async () => {
          await database.client`
          insert into execution_task_device_lease
            (task_id, group_id, device_id, lease_token, expires_at)
          values (${idOf(otherTaskId)}, ${idOf(otherGroupId)}, ${idOf(deviceId)}, 'lease-cross-group', now() + interval '5 minutes')
          `
        })

        await expectDatabaseRejection(async () => {
          await database.client`delete from access_group where id = ${idOf(groupId)}`
        })
      } finally {
        await database.close()
      }
    },
  )
})
