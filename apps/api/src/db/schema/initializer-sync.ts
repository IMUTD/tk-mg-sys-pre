import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { accessGroups, appUsers } from "./auth"
import { devices } from "./devices"

export const initAdminMappings = pgTable(
  "init_admin_mapping",
  {
    sourceKey: text("source_key").notNull(),
    sourceId: text("source_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "restrict" }),
  },
  (table) => [primaryKey({ columns: [table.sourceKey, table.sourceId] })],
)
export const initBoxMappings = pgTable(
  "init_box_mapping",
  {
    sourceKey: text("source_key").notNull(),
    externalId: text("external_id").notNull(),
    deviceId: uuid("device_id")
      .notNull()
      .unique()
      .references(() => devices.id, { onDelete: "restrict" }),
  },
  (table) => [primaryKey({ columns: [table.sourceKey, table.externalId] })],
)
export const initSyncState = pgTable("init_sync_state", {
  sourceKey: text("source_key").primaryKey(),
  lastSuccessAt: timestamp("last_success_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
})
