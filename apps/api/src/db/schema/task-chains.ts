import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

import { accessGroups, appUsers } from "./auth"
import { behaviorChains } from "./behavior-chains"

export const taskChains = pgTable(
  "task_chain",
  {
    administratorId: uuid("administrator_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "cascade" }),
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("task_chain_admin_updated_index").on(table.administratorId, table.updatedAt),
    check("task_chain_name_check", sql`char_length(btrim(${table.name})) between 1 and 80`),
  ],
)

export const taskChainItems = pgTable(
  "task_chain_item",
  {
    chainId: uuid("chain_id")
      .notNull()
      .references(() => behaviorChains.id, { onDelete: "restrict" }),
    id: uuid("id").defaultRandom().primaryKey(),
    position: integer("position").notNull(),
    taskChainId: uuid("task_chain_id")
      .notNull()
      .references(() => taskChains.id, { onDelete: "cascade" }),
  },
  (table) => [
    unique("task_chain_item_position_unique").on(table.taskChainId, table.position),
    index("task_chain_item_chain_index").on(table.chainId),
    check("task_chain_item_position_check", sql`${table.position} >= 0 and ${table.position} < 20`),
  ],
)
