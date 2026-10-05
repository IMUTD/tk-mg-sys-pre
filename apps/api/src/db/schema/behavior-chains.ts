import { sql } from "drizzle-orm"
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

import { accessGroups, appUsers } from "./auth"

export const behaviorChains = pgTable(
  "behavior_chain",
  {
    administratorId: uuid("administrator_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    delays: jsonb("delays").notNull().default(sql`'[]'::jsonb`),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    executorKey: text("executor_key").notNull().default("box-agent"),
    guards: jsonb("guards").notNull().default(sql`'[]'::jsonb`),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "restrict" }),
    id: uuid("id").defaultRandom().primaryKey(),
    lastTestedAt: timestamp("last_tested_at", { mode: "date", withTimezone: true }),
    name: text("name").notNull(),
    origin: text("origin").notNull(),
    parameters: jsonb("parameters").notNull(),
    paramScopes: jsonb("param_scopes").notNull().default(sql`'[]'::jsonb`),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("behavior_chain_administrator_updated_index").on(table.administratorId, table.updatedAt),
    index("behavior_chain_group_created_index").on(table.groupId, table.createdAt),
  ],
)
