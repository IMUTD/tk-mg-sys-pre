import { afterEach, describe, expect, it } from "bun:test"
import { createSqlClient } from "../../db/client"

import {
  createMigratedTestDatabase,
  getTestDatabaseUrl,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { Role } from "../../lib/authorization"
import { createPostgresDeviceCommandRepository } from "./postgres-repository"
import { CommandConflictError } from "./repository"

const databaseIntegrationTest = hasConfiguredTestDatabase ? it : it.skip

const actorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const commandId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const deviceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const groupId = "11111111-1111-4111-8111-111111111111"
const instanceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

let activeDatabase: MigratedTestDatabase | null = null

afterEach(async () => {
  if (activeDatabase !== null) {
    await activeDatabase.close()
    activeDatabase = null
  }
})

describe("createPostgresDeviceCommandRepository", () => {
  for (const { operation, scope } of (["submit", "claim"] as const).flatMap((operation) =>
    (["whole", "same", "other"] as const).map((scope) => ({ operation, scope })),
  )) {
    databaseIntegrationTest(
      `checks ${operation} against ${scope} instance expired unreleased task lease`,
      async () => {
        activeDatabase = await createMigratedTestDatabase()
        const client = activeDatabase.client
        await client`insert into access_group (id, name) values (${groupId}, 'Task quarantine')`
        await client`insert into app_user (id, email, password_hash, role)
        values (${actorId}, 'quarantine@example.test', 'hash', ${Role.Administrator})`
        await client`insert into device (id, group_id, name, host, model)
        values (${deviceId}, ${groupId}, 'Quarantine', 'quarantine', 'test')`
        const otherInstance = crypto.randomUUID()
        await client`insert into device_instance (id, device_id, instance_index, label)
          values (${instanceId}, ${deviceId}, 1, 'one'), (${otherInstance}, ${deviceId}, 2, 'two')`
        const repositoryClient = createSqlClient(getTestDatabaseUrl())
        const repository = createPostgresDeviceCommandRepository(repositoryClient)
        const input = {
          id: commandId,
          groupId,
          deviceId,
          instanceId,
          requesterId: actorId,
          idempotencyKey: "queued-before-quarantine",
          fingerprint: "test",
          kind: "health_check" as const,
          parameters: {},
          timeoutMs: 5000,
        }
        const audit = {
          action: "device.command.create",
          actorId,
          outcome: "allowed" as const,
          target: `device-command:${commandId}`,
        }
        if (operation === "claim") await repository.submit(input, audit)
        const taskId = crypto.randomUUID()
        await client`insert into execution_task
        (id, group_id, device_id, requester_id, name, executor_key, parameters, idempotency_key, fingerprint)
        values (${taskId}, ${groupId}, ${deviceId}, ${actorId}, 'Task', 'device-command', '{}', 'task', 'task')`
        await client`insert into execution_task_device_lease
        (task_id, group_id, device_id, instance_id, lease_token, expires_at)
        values (${taskId}, ${groupId}, ${deviceId}, ${scope === "whole" ? null : scope === "same" ? instanceId : otherInstance}, 'lease', now() - interval '1 hour')`

        try {
          if (scope === "other") {
            if (operation === "submit")
              expect((await repository.submit(input, audit)).created).toBe(true)
            else expect((await repository.claim(commandId))?.status).toBe("running")
            return
          }
          if (operation === "submit") {
            await expect(repository.submit(input, audit)).rejects.toBeInstanceOf(
              CommandConflictError,
            )
          } else {
            expect(await repository.claim(commandId)).toBeNull()
            expect((await repository.find(groupId, deviceId, commandId))?.status).toBe("queued")
          }
        } finally {
          await repositoryClient.end()
        }
      },
    )
  }
  databaseIntegrationTest(
    "persists idempotent commands, events, cancellation and redaction",
    async () => {
      activeDatabase = await createMigratedTestDatabase()
      const client = activeDatabase.client
      await client`insert into access_group (id, name) values (${groupId}, ${"Devices"})`
      await client`
      insert into app_user (id, email, password_hash, role, enabled)
      values (${actorId}, ${"operator@example.com"}, ${"hash"}, ${Role.Operator}, true)
    `
      await client`
        insert into device (id, group_id, name, host, model, resource_count)
        values (${deviceId}, ${groupId}, '设备 A', 'device-a', 'test', 0)
      `
      await client`
        insert into device_instance (id, device_id, instance_index, label)
        values (${instanceId}, ${deviceId}, 1, 'A-01')
      `
      const repository = createPostgresDeviceCommandRepository(client)
      const audit = {
        action: "device.command.create",
        actorId,
        metadata: { deviceId, groupId },
        outcome: "allowed" as const,
        target: `device-command:${commandId}`,
      }
      const command = {
        deviceId,
        fingerprint: "fingerprint-1",
        groupId,
        id: commandId,
        idempotencyKey: "client-key",
        instanceId,
        kind: "input_text" as const,
        parameters: { textLength: 12 },
        requesterId: actorId,
        timeoutMs: 5000,
      }

      const created = await repository.submit(command, audit)
      const duplicate = await repository.submit(command, audit)
      let conflictError: unknown = null
      try {
        await repository.submit({ ...command, fingerprint: "different" }, audit)
      } catch (error) {
        conflictError = error
      }
      expect(conflictError).toBeInstanceOf(CommandConflictError)
      const claimed = await repository.claim(commandId)
      expect(claimed?.status).toBe("running")
      const cancelRequested = await repository.requestCancel(groupId, deviceId, commandId, {
        ...audit,
        action: "device.command.cancel",
      })
      const cancelled =
        claimed === null ? null : await repository.finalizeCancel(commandId, claimed.claimToken)
      const secondCancel = await repository.requestCancel(groupId, deviceId, commandId, {
        ...audit,
        action: "device.command.cancel",
      })
      const events = await client<{ readonly status: string }[]>`
      select status from device_command_event where command_id = ${commandId} order by created_at asc
    `
      const audits = await client<{ readonly action: string }[]>`
      select action from audit_event where actor_id = ${actorId} order by created_at asc
    `
      const stored = await repository.find(groupId, deviceId, commandId)

      expect(created.created).toBe(true)
      expect(duplicate.created).toBe(false)
      expect(duplicate.command.id).toBe(commandId)
      expect(cancelRequested?.changed).toBe(true)
      expect(cancelRequested?.command.cancelRequestedAt).not.toBeNull()
      expect(cancelled?.status).toBe("cancelled")
      expect(secondCancel?.changed).toBe(false)
      expect(stored).toEqual(
        expect.objectContaining({
          id: commandId,
          parameters: { textLength: 12 },
          status: "cancelled",
        }),
      )
      expect(JSON.stringify(stored)).not.toContain("very private")
      expect(events).toHaveLength(3)
      expect(events.map((event) => event.status)).toEqual(
        expect.arrayContaining(["queued", "running", "cancelled"]),
      )
      expect(audits).toHaveLength(2)
      expect(audits.map((auditRow) => auditRow.action)).toEqual(
        expect.arrayContaining(["device.command.create", "device.command.cancel"]),
      )
    },
  )
})
