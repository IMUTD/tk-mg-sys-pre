import { afterEach, describe, expect, it } from "bun:test"
import { createUnconfiguredDeviceAdapter } from "@tk-mg/device-adapter"

import { createApp } from "../../app"
import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { Role } from "../../lib/authorization"
import { OperationDeleteConflictError } from "../../lib/operation-claim-guard"
import { createPostgresAuditRepository } from "../audit/service"
import { createPostgresAuthRepository } from "../auth/postgres-repository"
import { createAuthService } from "../auth/service"
import { createPostgresDeviceRepository } from "../devices/postgres-repository"
import { DeviceIdSchema } from "../devices/repository"
import { createPostgresDeviceCommandRepository } from "./postgres-repository"
import { createDeviceCommandService } from "./service"

const databaseIntegrationTest = hasConfiguredTestDatabase ? it : it.skip
const groupId = "11111111-1111-4111-8111-111111111111"
const secondGroupId = "22222222-2222-4222-8222-222222222222"
const actorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const deviceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const secondDeviceId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
const secondInstanceId = "ffffffff-ffff-4fff-8fff-ffffffffffff"

let activeDatabase: MigratedTestDatabase | null = null

const expectDatabaseRejection = async (operation: () => Promise<unknown>): Promise<void> => {
  let caughtError: unknown = null
  try {
    await operation()
  } catch (error) {
    caughtError = error
  }
  expect(caughtError).toBeInstanceOf(Error)
}

afterEach(async () => {
  if (activeDatabase !== null) {
    await activeDatabase.close()
    activeDatabase = null
  }
})

describe("device command PostgreSQL API integration", () => {
  databaseIntegrationTest("creates, queries, cancels, and persists command state", async () => {
    activeDatabase = await createMigratedTestDatabase()
    const client = activeDatabase.client
    await client`
      insert into access_group (id, name)
      values (${groupId}, '设备组'), (${secondGroupId}, '其他组')
    `
    await client`
      insert into app_user (id, email, password_hash, role, enabled)
      values (${actorId}, 'admin@example.com', 'password-hash', ${Role.Administrator}, true)
    `
    await client`insert into user_group (user_id, group_id) values (${actorId}, ${groupId})`
    await client`
      insert into device (id, group_id, name, host, model, resource_count)
      values (${deviceId}, ${groupId}, '设备 A', 'device-a', 'test', 0),
        (${secondDeviceId}, ${groupId}, '设备 B', 'device-b', 'test', 0)
    `
    await client`
      insert into device_instance (id, device_id, instance_index, label)
      values (${secondInstanceId}, ${secondDeviceId}, 1, 'B-01')
    `

    const auditRepository = createPostgresAuditRepository(client)
    const deviceRepository = createPostgresDeviceRepository(client)
    const commandRepository = createPostgresDeviceCommandRepository(client)
    const service = createDeviceCommandService({
      adapter: createUnconfiguredDeviceAdapter(),
      deviceRepository,
      dispatchImmediately: false,
      repository: commandRepository,
    })
    const app = createApp({
      auditRepository,
      authService: createAuthService(
        createPostgresAuthRepository(client),
        async (value, hash) => value === hash,
      ),
      deviceCommandService: service,
    })
    const login = await app.request("/api/auth/login", {
      body: JSON.stringify({ email: "admin@example.com", password: "password-hash" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
    const cookie = login.headers.get("set-cookie") ?? ""
    const path = `/api/groups/${groupId}/devices/${deviceId}/commands`

    const created = await app.request(path, {
      body: JSON.stringify({ idempotencyKey: "cancel-me", type: "health_check" }),
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      method: "POST",
    })
    const command = (await created.json()) as { readonly id: string; readonly status: string }
    const detail = await app.request(`${path}/${command.id}`, { headers: { Cookie: cookie } })
    const cancelled = await app.request(`${path}/${command.id}/cancel`, {
      headers: { Cookie: cookie },
      method: "POST",
    })
    const stored = await commandRepository.find(groupId, deviceId, command.id)
    const events = await client<{ readonly status: string }[]>`
      select status from device_command_event where command_id = ${command.id} order by created_at asc
    `

    expect(login.status).toBe(200)
    expect(created.status).toBe(201)
    expect(command.status).toBe("queued")
    expect(detail.status).toBe(200)
    expect(cancelled.status).toBe(200)
    expect(stored?.status).toBe("cancelled")
    expect(events).toHaveLength(2)
    expect(events.map((event) => event.status)).toEqual(
      expect.arrayContaining(["queued", "cancelled"]),
    )

    await expectDatabaseRejection(async () => {
      await commandRepository.submit(
        {
          deviceId: "99999999-9999-4999-8999-999999999999",
          fingerprint: "orphan",
          groupId,
          id: "99999999-9999-4999-8999-999999999998",
          idempotencyKey: "orphan",
          instanceId: null,
          kind: "health_check",
          parameters: {},
          requesterId: actorId,
          timeoutMs: 5_000,
        },
        {
          action: "device.command.create",
          actorId,
          metadata: { groupId },
          outcome: "allowed",
          target: "device-command:orphan",
        },
      )
    })

    await expectDatabaseRejection(async () => {
      await commandRepository.submit(
        {
          deviceId,
          fingerprint: "cross-device-instance",
          groupId,
          id: "99999999-9999-4999-8999-999999999997",
          idempotencyKey: "cross-device-instance",
          instanceId: secondInstanceId,
          kind: "health_check",
          parameters: {},
          requesterId: actorId,
          timeoutMs: 5_000,
        },
        {
          action: "device.command.create",
          actorId,
          metadata: { groupId },
          outcome: "allowed",
          target: "device-command:cross-device-instance",
        },
      )
    })

    const active = await commandRepository.submit(
      {
        deviceId,
        fingerprint: "active-delete",
        groupId,
        id: "99999999-9999-4999-8999-999999999996",
        idempotencyKey: "active-delete",
        instanceId: null,
        kind: "health_check",
        parameters: {},
        requesterId: actorId,
        timeoutMs: 5_000,
      },
      {
        action: "device.command.create",
        actorId,
        metadata: { groupId },
        outcome: "allowed",
        target: "device-command:active-delete",
      },
    )
    expect(active.created).toBe(true)
    let deleteError: unknown = null
    try {
      await deviceRepository.deleteDevice(groupId as never, DeviceIdSchema.parse(deviceId))
    } catch (error) {
      deleteError = error
    }
    expect(deleteError).toBeInstanceOf(OperationDeleteConflictError)
  })
})
