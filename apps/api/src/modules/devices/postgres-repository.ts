import type { Sql, TransactionSql } from "postgres"

import { GroupIdSchema } from "../../lib/authorization"
import {
  assertNoActiveExecutionLeases,
  assertNoActiveTaskClaims,
  OperationDeleteConflictError,
} from "../../lib/operation-claim-guard"
import type { AuditEventInput } from "../audit/service"
import {
  type Device,
  DeviceConflictError,
  type DeviceId,
  DeviceIdSchema,
  type DeviceInstance,
  type DeviceInstanceId,
  DeviceInstanceIdSchema,
  type DeviceRepository,
  DeviceStatusSchema,
  type HealthObservation,
  PlaybackDiagnosticSchema,
} from "./repository"

type DeviceRow = {
  readonly bridge: boolean
  readonly createdAt: Date
  readonly enabled: boolean
  readonly groupId: string
  readonly host: string
  readonly id: string
  readonly lastHealthAt: Date | null
  readonly lastHealthFailure: string | null
  readonly model: string
  readonly name: string
  readonly resourceCount: number
  readonly status: string
  readonly updatedAt: Date
  readonly version: string | null
}

type QueryClient = Sql | TransactionSql

type DeviceInstanceRow = {
  readonly createdAt: Date
  readonly deviceId: string
  readonly enabled: boolean
  readonly id: string
  readonly index: number
  readonly lastHealthAt: Date | null
  readonly lastHealthFailure: string | null
  readonly lastPlaybackDiagnostic: string | null
  readonly label: string
  readonly status: string
  readonly updatedAt: Date
}

const deviceColumns = (client: QueryClient) => client`
  id, group_id as "groupId", name, host, model, version, bridge, enabled,
  resource_count as "resourceCount", status, last_health_at as "lastHealthAt",
  last_health_failure as "lastHealthFailure",
  created_at as "createdAt", updated_at as "updatedAt"
`

const instanceColumns = (client: QueryClient) => client`
  id, device_id as "deviceId", instance_index as "index", label, enabled, status,
  last_health_at as "lastHealthAt", last_health_failure as "lastHealthFailure",
  last_playback_diagnostic as "lastPlaybackDiagnostic",
  created_at as "createdAt", updated_at as "updatedAt"
`

const toInstance = (row: DeviceInstanceRow): DeviceInstance => ({
  createdAt: row.createdAt,
  deviceId: DeviceIdSchema.parse(row.deviceId),
  enabled: row.enabled,
  id: DeviceInstanceIdSchema.parse(row.id),
  index: row.index,
  lastHealthAt: row.lastHealthAt,
  lastHealthFailure: row.lastHealthFailure,
  lastPlaybackDiagnostic:
    row.lastPlaybackDiagnostic === null
      ? null
      : PlaybackDiagnosticSchema.parse(row.lastPlaybackDiagnostic),
  label: row.label,
  status: DeviceStatusSchema.parse(row.status),
  updatedAt: row.updatedAt,
})

const toDevice = (row: DeviceRow, instances: readonly DeviceInstance[]): Device => ({
  bridge: row.bridge,
  createdAt: row.createdAt,
  enabled: row.enabled,
  groupId: GroupIdSchema.parse(row.groupId),
  host: row.host,
  id: DeviceIdSchema.parse(row.id),
  instances,
  lastHealthAt: row.lastHealthAt,
  lastHealthFailure: row.lastHealthFailure,
  model: row.model,
  name: row.name,
  resourceCount: row.resourceCount,
  status: DeviceStatusSchema.parse(row.status),
  updatedAt: row.updatedAt,
  version: row.version,
})

const instancesFor = async (
  client: QueryClient,
  deviceIds: readonly string[],
): Promise<ReadonlyMap<string, readonly DeviceInstance[]>> => {
  if (deviceIds.length === 0) {
    return new Map()
  }
  const rows = await client<DeviceInstanceRow[]>`
    select ${instanceColumns(client)} from device_instance
    where device_id = any(${deviceIds}) order by instance_index asc
  `
  const grouped = new Map<string, readonly DeviceInstance[]>()
  for (const row of rows) {
    const existing = grouped.get(row.deviceId) ?? []
    grouped.set(row.deviceId, [...existing, toInstance(row)])
  }
  return grouped
}

const withInstances = async (
  client: QueryClient,
  rows: readonly DeviceRow[],
): Promise<readonly Device[]> => {
  const instances = await instancesFor(
    client,
    rows.map((row) => row.id),
  )
  return rows.map((row) => toDevice(row, instances.get(row.id) ?? []))
}

const findPostgresDevice = async (
  client: QueryClient,
  groupId: string,
  deviceId: DeviceId,
): Promise<Device | null> => {
  const rows = await client<DeviceRow[]>`
    select ${deviceColumns(client)} from device where id = ${deviceId} and not assignment_pending and (
      group_id = ${groupId}
      or assignee_user_id in (select user_id from user_group where group_id = ${groupId})
    )
  `
  const devices = await withInstances(client, rows)
  return devices[0] ?? null
}

const normalizeHost = (host: string): string => host.trim().toLowerCase()

const isPgError = (error: unknown, code: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  Object.getOwnPropertyDescriptor(error, "code")?.value === code

const mapPostgresConflict = (error: unknown): never => {
  if (isPgError(error, "23505")) throw new DeviceConflictError("device_instance_index_conflict")
  throw error
}

const appendAudit = async (client: QueryClient, input: AuditEventInput): Promise<void> => {
  await client`
    insert into audit_event (id, actor_id, action, outcome, target, metadata)
    values (
      ${crypto.randomUUID()},
      ${input.actorId},
      ${input.action},
      ${input.outcome},
      ${input.target},
      ${client.json(input.metadata ?? {})}
    )
  `
}

const createDevice = async (
  client: QueryClient,
  input: Parameters<DeviceRepository["createDevice"]>[0],
): Promise<Device> => {
  const host = normalizeHost(input.host)
  const conflicts = await client<{ readonly id: string }[]>`
    select id from device where group_id = ${input.groupId} and lower(trim(host)) = ${host} limit 1
  `
  if (conflicts[0] !== undefined) throw new DeviceConflictError("device_host_conflict")
  const rows = await client<DeviceRow[]>`
    insert into device (group_id, name, host, model, version, bridge, resource_count)
    values (${input.groupId}, ${input.name}, ${host}, ${input.model}, ${input.version}, ${input.bridge}, ${input.resourceCount})
    returning ${deviceColumns(client)}
  `
  const row = rows[0]
  if (row === undefined) throw new DevicePersistenceError("Device insert did not return a record")
  return toDevice(row, [])
}

const createInstance = async (
  client: QueryClient,
  input: Parameters<DeviceRepository["createInstance"]>[0],
): Promise<DeviceInstance | null> => {
  try {
    const rows = await client<DeviceInstanceRow[]>`
      insert into device_instance (device_id, instance_index, label, enabled)
      values (${input.deviceId}, ${input.index}, ${input.label}, ${input.enabled})
      returning ${instanceColumns(client)}
    `
    const row = rows[0]
    return row === undefined ? null : toInstance(row)
  } catch (error) {
    return mapPostgresConflict(error)
  }
}

const deleteDevice = async (
  client: TransactionSql,
  groupId: string,
  deviceId: DeviceId,
): Promise<boolean> => {
  const devices = await client<{ readonly id: string }[]>`
    select id from device where id = ${deviceId} and group_id = ${groupId} for update
  `
  if (devices[0] === undefined) return false
  const instances = await client<{ readonly id: string }[]>`
    select id from device_instance where device_id = ${deviceId} for update
  `
  await assertNoActiveTaskClaims(
    client,
    groupId,
    "device-instance",
    instances.map((instance) => instance.id),
  )
  await assertNoActiveExecutionLeases(client, groupId, deviceId)
  const activeCommands = await client<{ readonly id: string }[]>`
    select id from device_command where group_id = ${groupId} and device_id = ${deviceId}
      and status in ('queued', 'running') limit 1 for key share
  `
  if (activeCommands[0] !== undefined) throw new OperationDeleteConflictError()
  const rows = await client<{ readonly id: string }[]>`
    delete from device where id = ${deviceId} and group_id = ${groupId} returning id
  `
  return rows.length === 1
}

const deleteInstance = async (
  client: TransactionSql,
  groupId: string,
  deviceId: DeviceId,
  instanceId: DeviceInstanceId,
): Promise<boolean> => {
  const devices = await client<{ readonly id: string }[]>`
    select id from device where id = ${deviceId} and group_id = ${groupId} for update
  `
  if (devices[0] === undefined) return false
  const rows = await client<{ readonly id: string }[]>`
    select device_instance.id
    from device_instance
    where device_id = ${deviceId} and id = ${instanceId}
    for update
  `
  if (rows[0] === undefined) return false
  await assertNoActiveTaskClaims(client, groupId, "device-instance", [instanceId])
  await assertNoActiveExecutionLeases(client, groupId, deviceId, instanceId)
  const activeCommands = await client<{ readonly id: string }[]>`
    select id from device_command where group_id = ${groupId} and device_id = ${deviceId}
      and instance_id = ${instanceId} and status in ('queued', 'running') limit 1 for key share
  `
  if (activeCommands[0] !== undefined) throw new OperationDeleteConflictError()
  const deleted = await client<{ readonly id: string }[]>`
    delete from device_instance where id = ${instanceId} and device_id = ${deviceId} returning id
  `
  return deleted.length === 1
}

const updateDevice = async (
  client: QueryClient,
  groupId: string,
  deviceId: DeviceId,
  input: Parameters<DeviceRepository["updateDevice"]>[2],
): Promise<Device | null> => {
  const current = await findPostgresDevice(client, groupId, deviceId)
  if (current === null) return null
  const next = {
    ...current,
    ...input,
    host: input.host === undefined ? current.host : normalizeHost(input.host),
  }
  if (next.host !== current.host) {
    const conflicts = await client<{ readonly id: string }[]>`
      select id from device
      where group_id = ${groupId} and id <> ${deviceId} and lower(trim(host)) = ${next.host}
      limit 1
    `
    if (conflicts[0] !== undefined) throw new DeviceConflictError("device_host_conflict")
  }
  const rows = await client<DeviceRow[]>`
    update device set name = ${next.name}, host = ${next.host}, model = ${next.model},
    version = ${next.version}, bridge = ${next.bridge}, enabled = ${next.enabled},
    resource_count = ${next.resourceCount}, updated_at = now()
    where id = ${deviceId} and group_id = ${groupId}
    returning ${deviceColumns(client)}
  `
  const row = rows[0]
  return row === undefined ? null : toDevice(row, current.instances)
}

const updateInstance = async (
  client: QueryClient,
  groupId: string,
  deviceId: DeviceId,
  instanceId: DeviceInstanceId,
  input: Parameters<DeviceRepository["updateInstance"]>[3],
): Promise<DeviceInstance | null> => {
  const device = await findPostgresDevice(client, groupId, deviceId)
  const instance = device?.instances.find((candidate) => candidate.id === instanceId)
  if (device === null || device === undefined || instance === undefined) return null
  const next = { ...instance, ...input }
  try {
    const rows = await client<DeviceInstanceRow[]>`
      update device_instance set instance_index = ${next.index}, label = ${next.label},
      enabled = ${next.enabled}, updated_at = now()
      where id = ${instanceId} and device_id = ${deviceId}
      returning ${instanceColumns(client)}
    `
    const row = rows[0]
    return row === undefined ? null : toInstance(row)
  } catch (error) {
    return mapPostgresConflict(error)
  }
}

const recordHealth = async (
  client: QueryClient,
  groupId: string,
  deviceId: DeviceId,
  instanceId: DeviceInstanceId | null,
  observation: HealthObservation,
): Promise<void> => {
  if (instanceId === null) {
    await client`update device set status = ${observation.status}, last_health_at = ${observation.observedAt},
      last_health_failure = ${observation.failure}, updated_at = now()
      where id = ${deviceId} and group_id = ${groupId}`
    return
  }
  await client`update device_instance set status = ${observation.status}, last_health_at = ${observation.observedAt},
    last_health_failure = ${observation.failure}, updated_at = now()
    where id = ${instanceId} and device_id = ${deviceId}`
}

export const createPostgresDeviceRepository = (client: Sql): DeviceRepository => ({
  createDevice: async (input) => client.begin((transaction) => createDevice(transaction, input)),
  createInstance: async (input) =>
    client.begin((transaction) => createInstance(transaction, input)),
  deleteDevice: async (groupId, deviceId) =>
    client.begin((transaction) => deleteDevice(transaction, groupId, deviceId)),
  deleteInstance: async (groupId, deviceId, instanceId) =>
    client.begin((transaction) => deleteInstance(transaction, groupId, deviceId, instanceId)),
  findDevice: async (groupId, deviceId) => findPostgresDevice(client, groupId, deviceId),
  findInstance: async (groupId, deviceId, instanceId) => {
    const device = await findPostgresDevice(client, groupId, deviceId)
    const instance = device?.instances.find((candidate) => candidate.id === instanceId)
    return device === null || instance === undefined ? null : { device, instance }
  },
  list: async (groupId) => {
    const rows = await client<DeviceRow[]>`
      select ${deviceColumns(client)} from device
      where not assignment_pending and (group_id = ${groupId}
        or assignee_user_id in (select user_id from user_group where group_id = ${groupId}))
      order by created_at desc, id desc
    `
    return withInstances(client, rows)
  },
  recordHealth: async (groupId, deviceId, instanceId, observation) =>
    recordHealth(client, groupId, deviceId, instanceId, observation),
  transaction: async (callback) =>
    client.begin(async (transaction) =>
      callback({
        appendAudit: (input) => appendAudit(transaction, input),
        createDevice: (input) => createDevice(transaction, input),
        createInstance: (input) => createInstance(transaction, input),
        deleteDevice: (groupId, deviceId) => deleteDevice(transaction, groupId, deviceId),
        deleteInstance: (groupId, deviceId, instanceId) =>
          deleteInstance(transaction, groupId, deviceId, instanceId),
        findDevice: (groupId, deviceId) => findPostgresDevice(transaction, groupId, deviceId),
        updateDevice: (groupId, deviceId, input) =>
          updateDevice(transaction, groupId, deviceId, input),
        updateInstance: (groupId, deviceId, instanceId, input) =>
          updateInstance(transaction, groupId, deviceId, instanceId, input),
      }),
    ) as Promise<ReturnType<typeof callback> extends Promise<infer Result> ? Result : never>,
  updateDevice: async (groupId, deviceId, input) =>
    client.begin((transaction) => updateDevice(transaction, groupId, deviceId, input)),
  updateInstance: async (groupId, deviceId, instanceId, input) =>
    client.begin((transaction) =>
      updateInstance(transaction, groupId, deviceId, instanceId, input),
    ),
})

class DevicePersistenceError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "DevicePersistenceError"
  }
}
