import { sql } from "drizzle-orm"
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { accessGroups } from "./auth"
import { operationAccounts, operationResources } from "./operations"

export const operationTaskStatus = pgEnum("operation_task_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
])
export const operationTaskTemplates = pgTable("operation_task_template", {
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  executorKey: text("executor_key").notNull().default("device-health"),
  groupId: uuid("group_id")
    .notNull()
    .references(() => accessGroups.id, { onDelete: "cascade" }),
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  parameters: jsonb("parameters")
    .$type<Record<string, string>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
})
export const operationTasks = pgTable(
  "operation_task",
  {
    attempt: integer("attempt").notNull().default(0),
    cancelledAt: timestamp("cancelled_at", { mode: "date", withTimezone: true }),
    cancelRequestedAt: timestamp("cancel_requested_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    errorCode: text("error_code"),
    heartbeatAt: timestamp("heartbeat_at", { mode: "date", withTimezone: true }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "cascade" }),
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    name: text("name").notNull(),
    nextRunAt: timestamp("next_run_at", { mode: "date", withTimezone: true }),
    status: operationTaskStatus("status").notNull().default("queued"),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    templateId: uuid("template_id").references(() => operationTaskTemplates.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("operation_task_group_created_index").on(table.groupId, table.createdAt),
    uniqueIndex("operation_task_group_idempotency_unique").on(table.groupId, table.idempotencyKey),
  ],
)
export const operationTaskRuns = pgTable(
  "operation_task_run",
  {
    attempt: integer("attempt").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    errorCode: text("error_code"),
    id: uuid("id").defaultRandom().primaryKey(),
    level: text("level").notNull(),
    message: text("message").notNull(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => operationTasks.id, { onDelete: "cascade" }),
  },
  (table) => [index("operation_task_run_task_created_index").on(table.taskId, table.createdAt)],
)
export const operationTaskAllocations = pgTable("operation_task_allocation", {
  accountId: uuid("account_id").references(() => operationAccounts.id, { onDelete: "set null" }),
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => accessGroups.id, { onDelete: "cascade" }),
  releasedAt: timestamp("released_at", { mode: "date", withTimezone: true }),
  resourceId: uuid("resource_id").references(() => operationResources.id, { onDelete: "set null" }),
  taskId: uuid("task_id")
    .notNull()
    .references(() => operationTasks.id, { onDelete: "cascade" }),
})
export const operationTaskClaims = pgTable(
  "operation_task_claim",
  {
    claimKind: text("claim_kind").notNull(),
    entityId: uuid("entity_id").notNull(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "cascade" }),
    id: uuid("id").defaultRandom().primaryKey(),
    releasedAt: timestamp("released_at", { mode: "date", withTimezone: true }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => operationTasks.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("operation_task_claim_active_unique")
      .on(table.claimKind, table.entityId)
      .where(sql`${table.releasedAt} is null`),
    index("operation_task_claim_task_active_index")
      .on(table.taskId)
      .where(sql`${table.releasedAt} is null`),
  ],
)
