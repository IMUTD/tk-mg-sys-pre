import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { accessGroups, appUsers } from "./auth"

export const deviceStatus = pgEnum("device_status", ["unknown", "online", "offline"])

export const devices = pgTable(
  "device",
  {
    bridge: boolean("bridge").notNull().default(false),
    assignmentPending: boolean("assignment_pending").notNull().default(false),
    assigneeUserId: uuid("assignee_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    externalId: text("external_id"),
    boxType: text("box_type").notNull().default(""),
    firmware: text("firmware").notNull().default(""),
    memory: text("memory").notNull().default(""),
    memoryPct: integer("memory_pct").notNull().default(0),
    cpuTemp: text("cpu_temp").notNull().default(""),
    cpuLoad: text("cpu_load").notNull().default(""),
    cpuPct: integer("cpu_pct").notNull().default(0),
    disk: text("disk").notNull().default(""),
    diskPct: integer("disk_pct").notNull().default(0),
    agentVersion: text("agent_version").notNull().default(""),
    apiVersion: text("api_version").notNull().default(""),
    lastSeenAt: timestamp("last_seen_at", { mode: "date", withTimezone: true }),
    sequenceNo: integer("sequence_no"),
    boxGroupId: uuid("box_group_id").references(() => businessLabels.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "cascade" }),
    host: text("host").notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    lastHealthAt: timestamp("last_health_at", { mode: "date", withTimezone: true }),
    lastHealthFailure: text("last_health_failure"),
    model: text("model").notNull(),
    name: text("name").notNull(),
    resourceCount: integer("resource_count").notNull().default(0),
    status: deviceStatus("status").notNull().default("unknown"),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    version: text("version"),
  },
  (table) => [
    index("device_group_created_index").on(table.groupId, table.createdAt),
    unique("device_group_id_unique").on(table.id, table.groupId),
    uniqueIndex("device_external_id_unique")
      .on(table.externalId)
      .where(sql`${table.externalId} is not null`),
    uniqueIndex("device_assignee_sequence_unique")
      .on(table.assigneeUserId, table.sequenceNo)
      .where(sql`${table.assigneeUserId} is not null and ${table.sequenceNo} is not null`),
    check(
      "device_sequence_no_check",
      sql`${table.sequenceNo} is null or (${table.sequenceNo} >= 1 and ${table.sequenceNo} <= 999)`,
    ),
  ],
)

export const deviceInstances = pgTable(
  "device_instance",
  {
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    apiPort: integer("api_port").notNull().default(0),
    rpaPort: integer("rpa_port").notNull().default(0),
    width: text("width").notNull().default(""),
    height: text("height").notNull().default(""),
    containerId: text("container_id").notNull().default(""),
    id: uuid("id").defaultRandom().primaryKey(),
    index: integer("instance_index").notNull(),
    lastHealthAt: timestamp("last_health_at", { mode: "date", withTimezone: true }),
    lastHealthFailure: text("last_health_failure"),
    lastPlaybackDiagnostic: text("last_playback_diagnostic"),
    label: text("label").notNull(),
    status: deviceStatus("status").notNull().default("unknown"),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("device_instance_device_enabled_index").on(table.deviceId, table.enabled),
    unique("device_instance_device_index_unique").on(table.deviceId, table.index),
    unique("device_instance_id_device_unique").on(table.id, table.deviceId),
  ],
)

export const deviceGroupHistory = pgTable(
  "device_group_history",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.deviceId, table.groupId] })],
)

export const businessLabels = pgTable(
  "business_label",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    administratorId: uuid("administrator_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").$type<"remark" | "group">().notNull(),
    scope: text("scope")
      .$type<
        "device" | "account" | "account-tag" | "proxy" | "resource" | "registration" | "legacy"
      >()
      .notNull()
      .default("legacy"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("business_label_admin_scope_kind_name_unique").on(
      table.administratorId,
      table.scope,
      table.kind,
      table.name,
    ),
    check("business_label_kind_check", sql`${table.kind} in ('remark', 'group')`),
    check(
      "business_label_scope_check",
      sql`${table.scope} in ('device', 'account', 'account-tag', 'proxy', 'resource', 'registration', 'legacy')`,
    ),
    check("business_label_name_check", sql`length(trim(${table.name})) > 0`),
  ],
)

export const deviceRemarks = pgTable(
  "device_remark",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => businessLabels.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.deviceId, table.labelId] }),
    index("device_remark_label_index").on(table.labelId),
  ],
)

export const deviceAgents = pgTable(
  "device_agent",
  {
    deviceId: uuid("device_id")
      .primaryKey()
      .references(() => devices.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    agentVersion: text("agent_version").notNull().default(""),
    registeredAt: timestamp("registered_at", { mode: "date", withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { mode: "date", withTimezone: true }),
    fileBrowserUrl: text("file_browser_url").notNull().default(""),
  },
  (table) => [uniqueIndex("device_agent_token_hash_unique").on(table.tokenHash)],
)

export const deviceWatches = pgTable(
  "device_watch",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    instanceIndex: integer("instance_index").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.deviceId, table.instanceIndex, table.userId] })],
)
