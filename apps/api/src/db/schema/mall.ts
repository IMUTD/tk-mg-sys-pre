import { sql } from "drizzle-orm"
import { bigint, check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"

import { accessGroups, appUsers } from "./auth"

export const mallWallets = pgTable(
  "mall_wallet",
  {
    balance: bigint("balance", { mode: "number" }).notNull().default(0),
    groupId: uuid("group_id")
      .primaryKey()
      .references(() => accessGroups.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check("mall_wallet_balance_check", sql`${table.balance} >= 0`)],
)

export const mallOrders = pgTable(
  "mall_order",
  {
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    description: text("description").notNull().default(""),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "restrict" }),
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    orderNo: text("order_no").notNull().unique(),
    paidAt: timestamp("paid_at", { mode: "date", withTimezone: true }),
    paymentMethod: text("payment_method").notNull(),
    points: bigint("points", { mode: "number" }).notNull(),
    product: text("product").notNull(),
    remark: text("remark").notNull().default(""),
    status: text("status").notNull(),
    title: text("title").notNull(),
    type: text("type").notNull(),
  },
  (table) => [
    index("mall_order_group_created_index").on(table.groupId, table.createdAt, table.id),
    unique("mall_order_idempotency_unique").on(table.groupId, table.idempotencyKey),
    check("mall_order_type_check", sql`${table.type} in ('points')`),
    check("mall_order_status_check", sql`${table.status} in ('paid')`),
    check("mall_order_payment_method_check", sql`${table.paymentMethod} in ('manual')`),
    check("mall_order_amount_check", sql`${table.amountCents} > 0`),
    check("mall_order_points_check", sql`${table.points} > 0`),
  ],
)

export const mallPointLedger = pgTable(
  "mall_point_ledger",
  {
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    delta: bigint("delta", { mode: "number" }).notNull(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "restrict" }),
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    orderId: uuid("order_id").references(() => mallOrders.id, { onDelete: "restrict" }),
    remark: text("remark").notNull().default(""),
    type: text("type").notNull(),
  },
  (table) => [
    index("mall_point_ledger_group_created_index").on(table.groupId, table.createdAt, table.id),
    index("mall_point_ledger_created_index").on(table.createdAt, table.id),
    unique("mall_point_ledger_idempotency_unique").on(table.groupId, table.idempotencyKey),
    check(
      "mall_point_ledger_type_check",
      sql`${table.type} in ('recharge', 'spend', 'refund', 'adjust')`,
    ),
    check("mall_point_ledger_delta_check", sql`${table.delta} <> 0`),
    check("mall_point_ledger_balance_check", sql`${table.balanceAfter} >= 0`),
  ],
)
