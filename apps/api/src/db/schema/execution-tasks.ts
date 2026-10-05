import { sql } from "drizzle-orm"
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { accessGroups, appUsers } from "./auth"
import { deviceInstances, devices } from "./devices"

export const executionTasks = pgTable(
  "execution_task",
  {
    cancelRequestedAt: timestamp("cancel_requested_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    deviceId: uuid("device_id").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    executorKey: text("executor_key").notNull(),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true }),
    fingerprint: text("fingerprint").notNull(),
    groupId: uuid("group_id").notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    lastRetryAt: timestamp("last_retry_at", { mode: "date", withTimezone: true }),
    maxAttempts: integer("max_attempts").notNull().default(3),
    name: text("name").notNull(),
    nextRetryAt: timestamp("next_retry_at", { mode: "date", withTimezone: true }),
    parameters: jsonb("parameters").notNull(),
    result: jsonb("result"),
    requesterId: uuid("requester_id").notNull(),
    retryCount: integer("retry_count").notNull().default(0),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    status: text("status").notNull().default("queued"),
    terminalReason: text("terminal_reason"),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("execution_task_group_created_index").on(table.groupId, table.createdAt),
    index("execution_task_status_retry_index").on(table.status, table.nextRetryAt),
    unique("execution_task_id_group_unique").on(table.id, table.groupId),
    uniqueIndex("execution_task_group_idempotency_unique").on(table.groupId, table.idempotencyKey),
    foreignKey({
      columns: [table.deviceId, table.groupId],
      foreignColumns: [devices.id, devices.groupId],
      name: "execution_task_device_group_fk",
    }),
    foreignKey({
      columns: [table.groupId],
      foreignColumns: [accessGroups.id],
      name: "execution_task_group_fk",
    }),
    foreignKey({
      columns: [table.requesterId],
      foreignColumns: [appUsers.id],
      name: "execution_task_requester_fk",
    }),
  ],
)

export const executionTaskSteps = pgTable(
  "execution_task_step",
  {
    afterMs: integer("after_ms").notNull().default(0),
    commandId: uuid("command_id").defaultRandom().notNull(),
    commandIdempotencyKey: text("command_idempotency_key").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    fingerprint: text("fingerprint").notNull(),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true }),
    guardCode: text("guard_code"),
    guardIndex: integer("guard_index").notNull().default(0),
    guards: jsonb("guards").notNull().default(sql`'[]'::jsonb`),
    groupId: uuid("group_id").notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind").notNull(),
    parameters: jsonb("parameters").notNull(),
    parentStepId: uuid("parent_step_id"),
    phase: text("phase").notNull().default("skill"),
    result: jsonb("result"),
    role: text("role").notNull().default("native"),
    sequence: integer("sequence").notNull(),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    status: text("status").notNull().default("pending"),
    submitStartedAt: timestamp("submit_started_at", { mode: "date", withTimezone: true }),
    target: jsonb("target").notNull(),
    taskId: uuid("task_id").notNull(),
  },
  (table) => [
    index("execution_task_step_task_status_index").on(table.taskId, table.status),
    uniqueIndex("execution_task_step_task_sequence_unique").on(table.taskId, table.sequence),
    foreignKey({
      columns: [table.taskId, table.groupId],
      foreignColumns: [executionTasks.id, executionTasks.groupId],
      name: "execution_task_step_task_group_fk",
    }),
    unique("execution_task_step_id_task_group_unique").on(table.id, table.taskId, table.groupId),
  ],
)

export const executionTaskEvents = pgTable(
  "execution_task_event",
  {
    actorId: uuid("actor_id"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    fromStatus: text("from_status"),
    groupId: uuid("group_id").notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    reason: text("reason"),
    source: text("source").notNull(),
    taskId: uuid("task_id").notNull(),
    toStatus: text("to_status").notNull(),
    workerId: text("worker_id"),
  },
  (table) => [
    index("execution_task_event_task_created_index").on(table.taskId, table.createdAt),
    foreignKey({
      columns: [table.taskId, table.groupId],
      foreignColumns: [executionTasks.id, executionTasks.groupId],
      name: "execution_task_event_task_group_fk",
    }),
    unique("execution_task_event_id_task_group_unique").on(table.id, table.taskId, table.groupId),
    foreignKey({
      columns: [table.actorId],
      foreignColumns: [appUsers.id],
      name: "execution_task_event_actor_fk",
    }),
  ],
)

export const executionTaskOutbox = pgTable(
  "execution_task_outbox",
  {
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: timestamp("available_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    claimedAt: timestamp("claimed_at", { mode: "date", withTimezone: true }),
    claimedBy: text("claimed_by"),
    claimExpiresAt: timestamp("claim_expires_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    deadLetteredAt: timestamp("dead_lettered_at", { mode: "date", withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { mode: "date", withTimezone: true }),
    eventId: uuid("event_id").notNull(),
    eventType: text("event_type").notNull(),
    groupId: uuid("group_id").notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    lastError: text("last_error"),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    taskId: uuid("task_id").notNull(),
  },
  (table) => [
    index("execution_task_outbox_claim_index").on(table.availableAt, table.claimedAt),
    index("execution_task_outbox_task_index").on(table.taskId, table.createdAt),
    foreignKey({
      columns: [table.taskId, table.groupId],
      foreignColumns: [executionTasks.id, executionTasks.groupId],
      name: "execution_task_outbox_task_group_fk",
    }),
    foreignKey({
      columns: [table.eventId, table.taskId, table.groupId],
      foreignColumns: [
        executionTaskEvents.id,
        executionTaskEvents.taskId,
        executionTaskEvents.groupId,
      ],
      name: "execution_task_outbox_event_task_group_fk",
    }),
  ],
)

export const executionTaskRuns = pgTable(
  "execution_task_run",
  {
    attempt: integer("attempt").notNull(),
    claimExpiresAt: timestamp("claim_expires_at", { mode: "date", withTimezone: true }),
    claimToken: text("claim_token"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    errorCode: text("error_code"),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true }),
    groupId: uuid("group_id").notNull(),
    heartbeatAt: timestamp("heartbeat_at", { mode: "date", withTimezone: true }),
    id: uuid("id").defaultRandom().primaryKey(),
    recoveryReason: text("recovery_reason"),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    status: text("status").notNull().default("claimed"),
    stepId: uuid("step_id"),
    taskId: uuid("task_id").notNull(),
    workerId: text("worker_id").notNull(),
  },
  (table) => [
    index("execution_task_run_task_created_index").on(table.taskId, table.createdAt),
    index("execution_task_run_claim_index").on(table.status, table.claimExpiresAt),
    foreignKey({
      columns: [table.taskId, table.groupId],
      foreignColumns: [executionTasks.id, executionTasks.groupId],
      name: "execution_task_run_task_group_fk",
    }),
    foreignKey({
      columns: [table.stepId, table.taskId, table.groupId],
      foreignColumns: [
        executionTaskSteps.id,
        executionTaskSteps.taskId,
        executionTaskSteps.groupId,
      ],
      name: "execution_task_run_step_task_group_fk",
    }),
  ],
)

export const executionTaskDeviceLeases = pgTable(
  "execution_task_device_lease",
  {
    acquiredAt: timestamp("acquired_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    groupId: uuid("group_id").notNull(),
    heartbeatAt: timestamp("heartbeat_at", { mode: "date", withTimezone: true }),
    id: uuid("id").defaultRandom().primaryKey(),
    instanceId: uuid("instance_id"),
    leaseToken: text("lease_token").notNull(),
    releasedAt: timestamp("released_at", { mode: "date", withTimezone: true }),
    recoveryReason: text("recovery_reason"),
    taskId: uuid("task_id").notNull(),
    workerId: text("worker_id"),
    deviceId: uuid("device_id").notNull(),
  },
  (table) => [
    index("execution_task_device_lease_task_index").on(table.taskId, table.releasedAt),
    uniqueIndex("execution_task_device_lease_active_unique")
      .on(
        table.deviceId,
        sql`coalesce(${table.instanceId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${table.releasedAt} is null`),
    foreignKey({
      columns: [table.taskId, table.groupId],
      foreignColumns: [executionTasks.id, executionTasks.groupId],
      name: "execution_task_device_lease_task_group_fk",
    }),
    foreignKey({
      columns: [table.deviceId, table.groupId],
      foreignColumns: [devices.id, devices.groupId],
      name: "execution_task_device_lease_device_group_fk",
    }),
    foreignKey({
      columns: [table.instanceId, table.deviceId],
      foreignColumns: [deviceInstances.id, deviceInstances.deviceId],
      name: "execution_task_device_lease_instance_device_fk",
    }),
  ],
)
