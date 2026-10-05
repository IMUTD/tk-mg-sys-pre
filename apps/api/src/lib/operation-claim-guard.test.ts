import { afterEach, describe, expect, it } from "bun:test"

import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../db/test-database"
import {
  createPostgresAccountRepository,
  OperationAccountIdSchema,
} from "../modules/accounts/repository"
import { createPostgresDeviceRepository } from "../modules/devices/postgres-repository"
import { DeviceIdSchema } from "../modules/devices/repository"
import { createPostgresProxyRepository, ProxyIdSchema } from "../modules/proxies/repository"
import {
  createPostgresResourceRepository,
  OperationResourceIdSchema,
} from "../modules/resources/repository"
import { GroupIdSchema } from "./authorization"
import { OperationDeleteConflictError } from "./operation-claim-guard"

const databaseIntegrationTest = hasConfiguredTestDatabase ? it : it.skip
const groupId = GroupIdSchema.parse("11111111-1111-4111-8111-111111111111")
const actorId = "22222222-2222-4222-8222-222222222222"
let activeDatabase: MigratedTestDatabase | null = null
afterEach(async () => {
  await activeDatabase?.close()
  activeDatabase = null
})

describe("operation deletion guards", () => {
  databaseIntegrationTest("keeps claimed operations entities and history intact", async () => {
    // Given
    activeDatabase = await createMigratedTestDatabase()
    const client = activeDatabase.client
    const accountId = crypto.randomUUID()
    const deviceId = crypto.randomUUID()
    const instanceId = crypto.randomUUID()
    const proxyId = crypto.randomUUID()
    const resourceId = crypto.randomUUID()
    const taskId = crypto.randomUUID()
    await client`insert into access_group (id, name) values (${groupId}, ${"Operations"})`
    await client`insert into app_user (id, email, password_hash, role) values (${actorId}, ${"operator@example.com"}, ${"unused"}, ${"operator"})`
    await client`insert into operation_account (id, group_id, name, identifier, encrypted_secret) values (${accountId}, ${groupId}, ${"账号"}, ${"a@example.com"}, ${"cipher"})`
    await client`insert into operation_resource (id, group_id, name, category, status) values (${resourceId}, ${groupId}, ${"资源"}, ${"邮箱"}, 'allocated')`
    await client`insert into operation_proxy (id, group_id, name, endpoint, encrypted_credentials) values (${proxyId}, ${groupId}, ${"代理"}, ${"http://proxy"}, ${"cipher"})`
    await client`insert into device (id, group_id, name, host, model) values (${deviceId}, ${groupId}, ${"设备"}, ${"192.168.1.2"}, ${"V3"})`
    await client`insert into device_instance (id, device_id, instance_index, label) values (${instanceId}, ${deviceId}, ${1}, ${"1号"})`
    await client`insert into operation_task (id, group_id, name, idempotency_key, status) values (${taskId}, ${groupId}, ${"运行任务"}, ${"deletion-guard"}, 'running')`
    await client`insert into operation_task_claim (task_id, group_id, claim_kind, entity_id) values (${taskId}, ${groupId}, 'resource', ${resourceId}), (${taskId}, ${groupId}, 'account', ${accountId}), (${taskId}, ${groupId}, 'proxy', ${proxyId}), (${taskId}, ${groupId}, 'device-instance', ${instanceId})`
    await client`insert into operation_task_allocation (task_id, resource_id, account_id, group_id) values (${taskId}, ${resourceId}, ${accountId}, ${groupId})`
    await client`insert into operation_resource_allocation (resource_id, account_id, group_id, allocated_by_user_id) values (${resourceId}, ${accountId}, ${groupId}, ${actorId})`
    await client`insert into operation_account_lease (account_id, group_id, leased_by_user_id) values (${accountId}, ${groupId}, ${actorId})`

    // When
    const results = await Promise.allSettled([
      createPostgresResourceRepository(client).delete(groupId, [
        OperationResourceIdSchema.parse(resourceId),
      ]),
      createPostgresAccountRepository(client).recycle(groupId, [
        OperationAccountIdSchema.parse(accountId),
      ]),
      createPostgresProxyRepository(client).delete(groupId, [ProxyIdSchema.parse(proxyId)]),
      createPostgresDeviceRepository(client).deleteDevice(groupId, DeviceIdSchema.parse(deviceId)),
    ])
    const counts = await client<{ readonly count: number }[]>`
      select (select count(*)::int from operation_resource where id = ${resourceId}) +
             (select count(*)::int from operation_account where id = ${accountId}) +
             (select count(*)::int from operation_proxy where id = ${proxyId}) +
             (select count(*)::int from device where id = ${deviceId}) as count
    `
    const history = await client<{ readonly count: number }[]>`
      select (select count(*)::int from operation_task_claim where task_id = ${taskId}) +
             (select count(*)::int from operation_task_allocation where task_id = ${taskId}) +
             (select count(*)::int from operation_resource_allocation where resource_id = ${resourceId}) +
             (select count(*)::int from operation_account_lease where account_id = ${accountId}) as count
    `

    // Then
    expect(
      results.every(
        (result) =>
          result.status === "rejected" && result.reason instanceof OperationDeleteConflictError,
      ),
    ).toBe(true)
    expect(counts[0]?.count).toBe(4)
    expect(history[0]?.count).toBe(7)
  })
})
