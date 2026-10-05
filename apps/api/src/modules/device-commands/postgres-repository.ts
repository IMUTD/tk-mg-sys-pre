import type { Sql, TransactionSql } from "postgres"
import { z } from "zod"

import type { AuditEventInput } from "../audit/service"
import {
  CommandConflictError,
  type CommandRecord,
  type DeviceCommandRepository,
} from "./repository"

type Query = Sql | TransactionSql
type Row = Omit<CommandRecord, "kind" | "status" | "parameters"> & {
  readonly kind: string
  readonly status: string
  readonly parameters: unknown
}
const KindSchema = z.enum([
  "health_check",
  "capture_screen",
  "launch_app",
  "stop_app",
  "tap",
  "swipe",
  "input_text",
])
const StatusSchema = z.enum(["queued", "running", "succeeded", "failed", "timed_out", "cancelled"])
const ParametersSchema = z.record(z.string(), z.union([z.string(), z.number()]))
const ProviderReceiptSchema = z.object({
  status: z.literal("queued"),
  providerReceiptId: z.string().nullable(),
  retryable: z.boolean(),
})
const ResultSchema = z.union([
  z.object({ kind: z.literal("acknowledged") }),
  z.object({ kind: z.literal("no_artifact") }),
  z.object({ kind: z.literal("artifact"), reference: z.string() }),
  z.object({
    kind: z.literal("health"),
    status: z.enum(["available", "unavailable", "timed_out", "unconfigured", "rejected"]),
  }),
])

const columns = (db: Query) => db`
  id, idempotency_key as "idempotencyKey", fingerprint, device_id as "deviceId",
  instance_id as "instanceId", group_id as "groupId", requester_id as "requesterId",
  kind, parameters, timeout_ms as "timeoutMs", status,
  provider_receipt as "providerReceipt", error_code as "errorCode",
  result_reference as "resultReference", result, created_at as "createdAt",
   started_at as "startedAt", finished_at as "finishedAt", claim_token as "claimToken",
   claimed_at as "claimedAt", lease_expires_at as "leaseExpiresAt", attempt_count as "attemptCount",
   cancel_requested_at as "cancelRequestedAt", cancel_error_code as "cancelErrorCode"
`
const mapRow = (row: Row): CommandRecord => ({
  ...row,
  kind: KindSchema.parse(row.kind),
  status: StatusSchema.parse(row.status),
  parameters: ParametersSchema.parse(row.parameters),
  providerReceipt:
    row.providerReceipt === null ? null : ProviderReceiptSchema.parse(row.providerReceipt),
  result: row.result === null ? null : ResultSchema.parse(row.result),
})
const audit = async (db: TransactionSql, input: AuditEventInput): Promise<void> => {
  await db`insert into audit_event (id, actor_id, action, outcome, target, metadata)
    values (${crypto.randomUUID()}, ${input.actorId}, ${input.action}, ${input.outcome}, ${input.target}, ${db.json(input.metadata ?? {})})`
}
const event = async (db: TransactionSql, commandId: string, status: string): Promise<void> => {
  await db`insert into device_command_event (id, command_id, status) values (${crypto.randomUUID()}, ${commandId}, ${status})`
}

export const createPostgresDeviceCommandRepository = (db: Sql): DeviceCommandRepository => ({
  submit: async (input, auditInput) =>
    db.begin(async (tx) => {
      await tx`select id from device where id = ${input.deviceId} and group_id = ${input.groupId} for update`
      const activeExecutionLeases = await tx<{ readonly id: string }[]>`
        select id from execution_task_device_lease
        where group_id = ${input.groupId} and device_id = ${input.deviceId}
          and (${input.instanceId}::uuid is null or instance_id is null
            or instance_id = ${input.instanceId}::uuid)
          and released_at is null for key share limit 1
      `
      if (activeExecutionLeases[0] !== undefined) throw new CommandConflictError()
      const inserted = await tx<Row[]>`
      insert into device_command (id, idempotency_key, fingerprint, device_id, instance_id, group_id,
        requester_id, kind, parameters, timeout_ms, status)
      values (${input.id}, ${input.idempotencyKey}, ${input.fingerprint}, ${input.deviceId},
        ${input.instanceId}, ${input.groupId}, ${input.requesterId}, ${input.kind},
        ${tx.json(input.parameters)}, ${input.timeoutMs}, 'queued')
       on conflict (group_id, device_id, idempotency_key) do nothing returning ${columns(tx)}
    `
      const created = inserted[0]
      if (created !== undefined) {
        await event(tx, created.id, "queued")
        await audit(tx, auditInput)
        return { command: mapRow(created), created: true }
      }
      const existing = await tx<Row[]>`select ${columns(tx)} from device_command
       where group_id = ${input.groupId} and device_id = ${input.deviceId}
         and idempotency_key = ${input.idempotencyKey}`
      const command = existing[0]
      if (command === undefined || command.fingerprint !== input.fingerprint)
        throw new CommandConflictError()
      return { command: mapRow(command), created: false }
    }),
  find: async (groupId, deviceId, commandId) => {
    const rows = await db<Row[]>`select ${columns(db)} from device_command
      where group_id = ${groupId} and device_id = ${deviceId} and id = ${commandId}`
    return rows[0] === undefined ? null : mapRow(rows[0])
  },
  list: async (groupId, deviceId, page, pageSize) => {
    const rows = await db<Row[]>`select ${columns(db)} from device_command
      where group_id = ${groupId} and device_id = ${deviceId}
      order by created_at desc, id desc limit ${pageSize} offset ${(page - 1) * pageSize}`
    const counts = await db<
      { readonly total: number }[]
    >`select count(*)::integer as total from device_command
      where group_id = ${groupId} and device_id = ${deviceId}`
    return { items: rows.map(mapRow), total: counts[0]?.total ?? 0, page, pageSize }
  },
  claim: async (commandId) =>
    db.begin(async (tx) => {
      const devices = await tx`select device.id from device
        join device_command command on command.device_id = device.id
          and command.group_id = device.group_id
        where command.id = ${commandId} for update of device`
      if (devices.length === 0) return null
      const conflicts = await tx`select lease.id from execution_task_device_lease lease
        join device_command command on command.device_id = lease.device_id
          and command.group_id = lease.group_id
        where command.id = ${commandId} and lease.released_at is null
          and (command.instance_id is null or lease.instance_id is null
            or command.instance_id = lease.instance_id) limit 1`
      if (conflicts.length > 0) return null
      const token = crypto.randomUUID()
      const rows = await tx<
        Row[]
      >`update device_command set status = 'running', started_at = coalesce(started_at, now()),
       claim_token = ${token}, claimed_at = now(), lease_expires_at = now() + (timeout_ms * interval '1 millisecond'),
       attempt_count = attempt_count + 1, cancel_error_code = null
       where id = ${commandId} and (status = 'queued' or (status = 'running' and lease_expires_at <= now())) returning ${columns(tx)}`
      const row = rows[0]
      if (row === undefined) return null
      await event(tx, commandId, "running")
      return { ...mapRow(row), command: mapRow(row), claimToken: token }
    }),
  renew: async (commandId, claimToken) => {
    const rows = await db<
      Row[]
    >`update device_command set lease_expires_at = now() + (timeout_ms * interval '1 millisecond')
      where id = ${commandId} and status = 'running' and claim_token = ${claimToken} returning ${columns(db)}`
    return rows[0] === undefined ? null : mapRow(rows[0])
  },
  recordReceipt: async (commandId, claimToken, receipt) => {
    const rows = await db<Row[]>`update device_command set provider_receipt = ${db.json(receipt)}
      where id = ${commandId} and status = 'running' and claim_token = ${claimToken} returning ${columns(db)}`
    return rows[0] === undefined ? null : mapRow(rows[0])
  },
  finish: async (commandId, claimToken, result) =>
    db.begin(async (tx) => {
      const rows = await tx<Row[]>`update device_command
      set status = ${result.status}, provider_receipt = ${result.providerReceipt === null ? null : tx.json(result.providerReceipt)},
        error_code = ${result.errorCode}, result_reference = ${result.resultReference},
        result = ${result.result === null ? null : tx.json(result.result)}, finished_at = now()
       where id = ${commandId} and status = 'running' and claim_token = ${claimToken} returning ${columns(tx)}`
      const row = rows[0]
      if (row === undefined) return null
      await event(tx, commandId, result.status)
      return mapRow(row)
    }),
  requestCancel: async (groupId, deviceId, commandId, auditInput) =>
    db.begin(async (tx) => {
      const rows = await tx<Row[]>`select ${columns(tx)} from device_command
      where id = ${commandId} and group_id = ${groupId} and device_id = ${deviceId} for update`
      const row = rows[0]
      if (row === undefined) return null
      if (row.status !== "queued" && row.status !== "running")
        return { command: mapRow(row), changed: false }
      if (row.status === "queued") {
        const updated = await tx<
          Row[]
        >`update device_command set status = 'cancelled', finished_at = now()
           where id = ${commandId} and status = 'queued' returning ${columns(tx)}`
        const cancelled = updated[0]
        if (cancelled === undefined) return { command: mapRow(row), changed: false }
        await event(tx, commandId, "cancelled")
        await audit(tx, auditInput)
        return { command: mapRow(cancelled), changed: true }
      }
      const updated = await tx<Row[]>`update device_command set cancel_requested_at = now()
       where id = ${commandId} and status in ('queued', 'running') returning ${columns(tx)}`
      const requested = updated[0]
      if (requested === undefined) return { command: mapRow(row), changed: false }
      await audit(tx, auditInput)
      return { command: mapRow(requested), changed: true }
    }),
  finalizeCancel: async (commandId, claimToken) =>
    db.begin(async (tx) => {
      const rows = await tx<
        Row[]
      >`update device_command set status = 'cancelled', finished_at = now()
      where id = ${commandId} and status = 'running' and claim_token = ${claimToken} and cancel_requested_at is not null
      returning ${columns(tx)}`
      const row = rows[0]
      if (row === undefined) return null
      await event(tx, commandId, "cancelled")
      return mapRow(row)
    }),
  recordCancelFailure: async (commandId, claimToken) => {
    const rows = await db<Row[]>`update device_command set cancel_error_code = 'cancel_failed'
      where id = ${commandId} and status = 'running' and claim_token = ${claimToken} returning ${columns(db)}`
    return rows[0] === undefined ? null : mapRow(rows[0])
  },
  cancel: async (groupId, deviceId, commandId, auditInput) =>
    db.begin(async (tx) => {
      const rows = await tx<
        Row[]
      >`update device_command set status = 'cancelled', finished_at = now()
        where id = ${commandId} and group_id = ${groupId} and device_id = ${deviceId} and status = 'queued'
        returning ${columns(tx)}`
      const row = rows[0]
      if (row === undefined) return null
      await event(tx, commandId, "cancelled")
      await audit(tx, auditInput)
      return { command: mapRow(row), changed: true }
    }),
})
