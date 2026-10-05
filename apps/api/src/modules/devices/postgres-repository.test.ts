// biome-ignore-all lint/complexity/useLiteralKeys: postgres row values are index-signature typed.
import { afterEach, describe, expect, it } from "bun:test"

import postgres, { type Sql } from "postgres"

import {
  createMigratedTestDatabase,
  getTestDatabaseUrl,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { GroupIdSchema } from "../../lib/authorization"
import { OperationDeleteConflictError } from "../../lib/operation-claim-guard"
import { createPostgresDeviceRepository } from "./postgres-repository"
import { DeviceIdSchema, DeviceInstanceIdSchema } from "./repository"

const databaseIntegrationTest = hasConfiguredTestDatabase ? it : it.skip
let activeDatabase: MigratedTestDatabase | null = null
let activeDeleteClient: Sql | null = null

afterEach(async () => {
  await activeDeleteClient?.end()
  activeDeleteClient = null
  if (activeDatabase !== null) {
    await activeDatabase.close()
    activeDatabase = null
  }
})

describe("createPostgresDeviceRepository", () => {
  databaseIntegrationTest("persists device instances", async () => {
    activeDatabase = await createMigratedTestDatabase()
    const groupId = GroupIdSchema.parse("11111111-1111-4111-8111-111111111111")
    await activeDatabase.client`insert into access_group (id, name) values (${groupId}, ${"Devices"})`
    const repository = createPostgresDeviceRepository(activeDatabase.client)
    const device = await repository.createDevice({
      bridge: false,
      groupId,
      host: "192.168.1.2",
      model: "Magic Cloud V3",
      name: "机柜 A",
      resourceCount: 2,
      version: "3.0.1",
    })
    const instance = await repository.createInstance({
      deviceId: device.id,
      enabled: true,
      index: 2,
      label: "V3-02",
    })
    const devices = await repository.list(groupId)

    expect(instance).not.toBeNull()
    expect(devices).toEqual([
      expect.objectContaining({
        id: device.id,
        instances: [expect.objectContaining({ index: 2, label: "V3-02" })],
      }),
    ])
  })

  databaseIntegrationTest(
    "serializes instance deletion against every unreleased device lease",
    async () => {
      activeDatabase = await createMigratedTestDatabase()
      const client = activeDatabase.client
      const groupId = GroupIdSchema.parse("11111111-1111-4111-8111-111111111111")
      const deviceId = crypto.randomUUID()
      const firstInstanceId = crypto.randomUUID()
      const secondInstanceId = crypto.randomUUID()
      const taskId = crypto.randomUUID()
      activeDeleteClient = postgres(getTestDatabaseUrl(), { max: 10 })
      await client`insert into access_group (id, name) values (${groupId}, ${"Devices"})`
      await client`insert into app_user (id, email, password_hash, role) values
      (${crypto.randomUUID()}, ${"device-lease@example.com"}, ${"unused"}, ${"operator"})`
      await client`insert into device (id, group_id, name, host, model) values
      (${deviceId}, ${groupId}, ${"Device"}, ${"device-lease"}, ${"V3"})`
      await client`insert into device_instance (id, device_id, instance_index, label) values
      (${firstInstanceId}, ${deviceId}, ${1}, ${"1"}),
      (${secondInstanceId}, ${deviceId}, ${2}, ${"2"})`
      await client`insert into execution_task (id, group_id, requester_id, device_id, idempotency_key,
      fingerprint, name, executor_key, parameters)
      select ${taskId}, ${groupId}, id, ${deviceId}, ${"device-lease-test"}, ${"fingerprint"},
        ${"Device lease test"}, ${"device-command"}, '{}'::jsonb
      from app_user where email = ${"device-lease@example.com"}`
      const repository = createPostgresDeviceRepository(activeDeleteClient)
      const device = DeviceIdSchema.parse(deviceId)
      const firstInstance = DeviceInstanceIdSchema.parse(firstInstanceId)
      const secondInstance = DeviceInstanceIdSchema.parse(secondInstanceId)

      await client`insert into execution_task_device_lease
      (task_id, group_id, device_id, lease_token, expires_at)
      values (${taskId}, ${groupId}, ${deviceId}, ${"whole-device"}, now() + interval '5 minutes')`
      await expect(
        repository.deleteInstance(groupId, device, firstInstance),
      ).rejects.toBeInstanceOf(OperationDeleteConflictError)
      await client`update execution_task_device_lease set released_at = now() where lease_token = ${"whole-device"}`

      await client`insert into execution_task_device_lease
      (task_id, group_id, device_id, instance_id, lease_token, expires_at)
      values (${taskId}, ${groupId}, ${deviceId}, ${firstInstanceId}, ${"same-instance"}, now() + interval '5 minutes')`
      await expect(
        repository.deleteInstance(groupId, device, firstInstance),
      ).rejects.toBeInstanceOf(OperationDeleteConflictError)
      await client`update execution_task_device_lease set released_at = now() where lease_token = ${"same-instance"}`

      await client`insert into execution_task_device_lease
      (task_id, group_id, device_id, instance_id, lease_token, expires_at)
      values (${taskId}, ${groupId}, ${deviceId}, ${firstInstanceId}, ${"unrelated-instance"}, now() + interval '5 minutes')`
      expect(await repository.deleteInstance(groupId, device, secondInstance)).toBe(true)
      await client`update execution_task_device_lease set released_at = now() where lease_token = ${"unrelated-instance"}`

      await client`insert into device_instance (id, device_id, instance_index, label)
      values (${secondInstanceId}, ${deviceId}, ${2}, ${"2"})`
      await client`insert into execution_task_device_lease
      (task_id, group_id, device_id, instance_id, lease_token, expires_at)
      values (${taskId}, ${groupId}, ${deviceId}, ${firstInstanceId}, ${"expired-unreconciled"}, now() - interval '5 minutes')`
      await expect(
        repository.deleteInstance(groupId, device, firstInstance),
      ).rejects.toBeInstanceOf(OperationDeleteConflictError)
    },
  )

  databaseIntegrationTest(
    "does not delete an instance while a concurrent lease commits",
    async () => {
      activeDatabase = await createMigratedTestDatabase()
      const client = activeDatabase.client
      const leaseClient = postgres(getTestDatabaseUrl(), { max: 1 })
      const deleteClient = postgres(getTestDatabaseUrl(), { max: 1 })
      try {
        const groupId = GroupIdSchema.parse("11111111-1111-4111-8111-111111111111")
        const deviceId = crypto.randomUUID()
        const instanceId = crypto.randomUUID()
        const taskId = crypto.randomUUID()
        const userId = crypto.randomUUID()
        await client`insert into access_group (id, name) values (${groupId}, ${"Race Devices"})`
        await client`insert into app_user (id, email, password_hash, role) values
        (${userId}, ${"device-race@example.com"}, ${"unused"}, ${"operator"})`
        await client`insert into device (id, group_id, name, host, model) values
        (${deviceId}, ${groupId}, ${"Race Device"}, ${"device-race"}, ${"V3"})`
        await client`insert into device_instance (id, device_id, instance_index, label) values
        (${instanceId}, ${deviceId}, ${1}, ${"1"})`
        await client`insert into execution_task (id, group_id, requester_id, device_id, idempotency_key,
        fingerprint, name, executor_key, parameters)
        values (${taskId}, ${groupId}, ${userId}, ${deviceId}, ${"device-race"}, ${"fingerprint"},
          ${"Device race"}, ${"device-command"}, '{}'::jsonb)`
        const before = await client<
          { readonly instanceCount: number; readonly leaseCount: number }[]
        >`
          select
            (select count(*)::int from device_instance where id = ${instanceId}) as "instanceCount",
            (select count(*)::int from execution_task_device_lease
              where instance_id = ${instanceId} and released_at is null) as "leaseCount"
        `
        expect(before[0]).toEqual({ instanceCount: 1, leaseCount: 0 })

        let releaseLease: (() => void) | undefined
        let signalLeaseLocked: (() => void) | undefined
        const leaseLocked = new Promise<void>((resolve) => {
          signalLeaseLocked = resolve
        })
        const leaseTransaction = leaseClient.begin(async (transaction) => {
          await transaction`select id from device where id = ${deviceId} and group_id = ${groupId} for update`
          signalLeaseLocked?.()
          await new Promise<void>((release) => {
            releaseLease = release
          })
          await transaction`insert into execution_task_device_lease
          (task_id, group_id, device_id, instance_id, lease_token, expires_at)
          values (${taskId}, ${groupId}, ${deviceId}, ${instanceId}, ${"race-lease"}, now() + interval '5 minutes')`
        })
        await leaseLocked
        const deleteRepository = createPostgresDeviceRepository(deleteClient)
        const deletePid = (await deleteClient`select pg_backend_pid() as pid`)[0]?.["pid"]
        const deletion = deleteRepository.deleteInstance(
          groupId,
          DeviceIdSchema.parse(deviceId),
          DeviceInstanceIdSchema.parse(instanceId),
        )
        let isWaiting = false
        for (let attempt = 0; attempt < 100 && !isWaiting; attempt += 1) {
          const waiting = await activeDatabase.client<{ readonly waiting: boolean }[]>`
          select exists (
            select 1 from pg_stat_activity
            where pid = ${deletePid} and wait_event_type = 'Lock'
          ) as waiting
        `
          isWaiting = waiting[0]?.waiting ?? false
          if (!isWaiting) await new Promise<void>((resolve) => setImmediate(resolve))
        }
        releaseLease?.()
        const [deleteResult, leaseResult] = await Promise.allSettled([deletion, leaseTransaction])
        expect(isWaiting).toBe(true)
        expect(deleteResult.status).toBe("rejected")
        if (deleteResult.status === "rejected") {
          expect(deleteResult.reason).toBeInstanceOf(OperationDeleteConflictError)
        }
        expect(leaseResult.status).toBe("fulfilled")
        const after = await client<
          { readonly instanceCount: number; readonly leaseCount: number }[]
        >`
        select
          (select count(*)::int from device_instance where id = ${instanceId}) as "instanceCount",
          (select count(*)::int from execution_task_device_lease
            where instance_id = ${instanceId} and released_at is null) as "leaseCount"
      `
        expect(after[0]).toEqual({ instanceCount: 1, leaseCount: 1 })
      } finally {
        await leaseClient.end()
        await deleteClient.end()
      }
    },
  )
})
