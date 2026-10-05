import { sql } from "drizzle-orm"
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { accessGroups } from "./auth"

export const deviceStatus = pgEnum("device_status", ["unknown", "online", "offline"])

export const devices = pgTable(
  "device",
  {
    bridge: boolean("bridge").notNull().default(false),
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
    uniqueIndex("device_group_host_unique").on(table.groupId, sql`lower(trim(${table.host}))`),
    unique("device_group_id_unique").on(table.id, table.groupId),
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
