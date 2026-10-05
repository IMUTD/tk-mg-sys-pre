import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { accessGroups, appUsers } from "./auth"
import { deviceInstances, devices } from "./devices"

export const deviceCommands = pgTable(
  "device_command",
  {
    id: uuid("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "restrict" }),
    instanceId: uuid("instance_id").references(() => deviceInstances.id, { onDelete: "restrict" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "restrict" }),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    parameters: jsonb("parameters").notNull(),
    timeoutMs: integer("timeout_ms").notNull(),
    status: text("status").notNull(),
    providerReceipt: jsonb("provider_receipt"),
    errorCode: text("error_code"),
    resultReference: text("result_reference"),
    result: jsonb("result"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true }),
    claimToken: text("claim_token"),
    claimedAt: timestamp("claimed_at", { mode: "date", withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { mode: "date", withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    cancelRequestedAt: timestamp("cancel_requested_at", { mode: "date", withTimezone: true }),
    cancelErrorCode: text("cancel_error_code"),
  },
  (table) => [
    uniqueIndex("device_command_group_device_key_unique").on(
      table.groupId,
      table.deviceId,
      table.idempotencyKey,
    ),
    index("device_command_device_created_index").on(table.groupId, table.deviceId, table.createdAt),
    foreignKey({
      columns: [table.deviceId, table.groupId],
      foreignColumns: [devices.id, devices.groupId],
      name: "device_command_device_group_fk",
    }),
    foreignKey({
      columns: [table.instanceId, table.deviceId],
      foreignColumns: [deviceInstances.id, deviceInstances.deviceId],
      name: "device_command_instance_device_fk",
    }),
  ],
)

export const deviceCommandEvents = pgTable(
  "device_command_event",
  {
    id: uuid("id").primaryKey(),
    commandId: uuid("command_id")
      .notNull()
      .references(() => deviceCommands.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("device_command_event_command_index").on(table.commandId, table.createdAt)],
)
