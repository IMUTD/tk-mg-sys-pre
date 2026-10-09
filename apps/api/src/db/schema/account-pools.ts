import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { accessGroups, appUsers } from "./auth"

export const operationAccountPools = pgTable(
  "operation_account_pool",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    displayId: bigint("display_id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull()
      .unique(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "restrict" }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    remark: text("remark").notNull().default(""),
    backType: text("back_type").notNull(),
    deviceId: uuid("device_id"),
    deviceSeq: integer("device_seq"),
    deviceLabel: text("device_label").notNull().default(""),
    times: integer("times").notNull().default(1),
    memberCount: integer("member_count").notNull(),
    filterCondition: jsonb("filter_condition"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true })
      .default(sql`now() + interval '30 days'`)
      .notNull(),
    deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
  },
  (table) => [
    uniqueIndex("operation_account_pool_active_key_unique")
      .on(table.groupId, table.key)
      .where(sql`${table.deletedAt} is null`),
    index("operation_account_pool_group_created_index").on(
      table.groupId,
      table.createdAt,
      table.id,
    ),
    check(
      "operation_account_pool_back_type_check",
      sql`${table.backType} in ('1','2','3','4','5')`,
    ),
    check("operation_account_pool_times_check", sql`${table.times} between 1 and 20`),
    check("operation_account_pool_size_check", sql`${table.memberCount} between 1 and 3000`),
    check(
      "operation_account_pool_key_check",
      sql`length(trim(${table.key})) between 1 and 160 and position('+' in ${table.key}) = 0`,
    ),
    check(
      "operation_account_pool_device_check",
      sql`(${table.backType} in ('1','2','4') and ${table.deviceId} is not null) or (${table.backType} in ('3','5') and ${table.deviceId} is null)`,
    ),
    check(
      "operation_account_pool_seq_check",
      sql`(${table.backType} = '1' and (${table.deviceSeq} is null or ${table.deviceSeq} between 1 and 12)) or (${table.backType} <> '1' and ${table.deviceSeq} is null)`,
    ),
  ],
)

// Source UUIDs and sanitized snapshots survive source deletion or reassignment.
export const operationAccountPoolMembers = pgTable(
  "operation_account_pool_member",
  {
    poolId: uuid("pool_id")
      .notNull()
      .references(() => operationAccountPools.id, { onDelete: "restrict" }),
    accountId: uuid("account_id").notNull(),
    position: integer("position").notNull(),
    snapshot: jsonb("snapshot").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.poolId, table.accountId] }),
    unique().on(table.poolId, table.position),
    check(
      "operation_account_pool_member_position_check",
      sql`${table.position} between 1 and 3000`,
    ),
  ],
)

export const operationAccountPoolConsumptions = pgTable(
  "operation_account_pool_consumption",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    poolId: uuid("pool_id").notNull(),
    accountId: uuid("account_id").notNull(),
    round: integer("round").notNull(),
    consumptionKey: text("consumption_key").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    origin: text("origin").notNull().default("reported"),
    consumedAt: timestamp("consumed_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.poolId, table.accountId],
      foreignColumns: [operationAccountPoolMembers.poolId, operationAccountPoolMembers.accountId],
    }).onDelete("restrict"),
    unique().on(table.poolId, table.round, table.accountId),
    unique().on(table.poolId, table.consumptionKey),
    check("operation_account_pool_consumption_round_check", sql`${table.round} between 1 and 20`),
    check(
      "operation_account_pool_consumption_key_check",
      sql`length(${table.consumptionKey}) between 1 and 160`,
    ),
    check(
      "operation_account_pool_consumption_origin_check",
      sql`${table.origin} in ('reported','simulation')`,
    ),
    index("operation_account_pool_consumption_round_index").on(table.poolId, table.round),
  ],
)
