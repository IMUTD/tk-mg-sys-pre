import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"

import { accessGroups, appUsers } from "./auth"
import { executionTasks } from "./execution-tasks"

export const operationStageReplays = pgTable(
  "operation_stage_replay",
  {
    choices: jsonb("choices").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    dispatchId: uuid("dispatch_id").notNull(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "cascade" }),
    id: uuid("id").defaultRandom().primaryKey(),
    origin: text("origin").notNull().default("manual"),
    itemId: uuid("item_id").notNull(),
    repeatIndex: integer("repeat_index").notNull(),
    replayTaskId: uuid("replay_task_id")
      .notNull()
      .references(() => executionTasks.id, { onDelete: "restrict" }),
    sourceTaskId: uuid("source_task_id")
      .notNull()
      .references(() => executionTasks.id, { onDelete: "restrict" }),
    stagePosition: integer("stage_position").notNull(),
  },
  (table) => [
    unique("operation_stage_replay_task_unique").on(table.replayTaskId),
    index("operation_stage_replay_item_index").on(
      table.itemId,
      table.stagePosition,
      table.repeatIndex,
      table.createdAt,
    ),
  ],
)
