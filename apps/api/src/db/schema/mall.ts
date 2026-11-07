import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

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

export const mallProducts = pgTable(
  "mall_product",
  {
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    enabled: boolean("enabled").notNull().default(true),
    id: uuid("id").defaultRandom().primaryKey(),
    inventoryGroupId: uuid("inventory_group_id").references(() => accessGroups.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    minQuantity: integer("min_quantity").notNull().default(1),
    name: text("name").notNull(),
    pricePoints: bigint("price_points", { mode: "number" }).notNull(),
    spec: text("spec").notNull().default(""),
    stock: bigint("stock", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("mall_product_enabled_kind_index").on(
      table.enabled,
      table.kind,
      table.createdAt,
      table.id,
    ),
    check("mall_product_kind_check", sql`${table.kind} in ('account', 'proxy')`),
    check("mall_product_price_check", sql`${table.pricePoints} > 0`),
    check("mall_product_stock_check", sql`${table.stock} >= 0`),
    check("mall_product_min_quantity_check", sql`${table.minQuantity} >= 1`),
  ],
)

export const mallOrders = pgTable(
  "mall_order",
  {
    alipayTradeNo: text("alipay_trade_no"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    cancelReason: text("cancel_reason").notNull().default(""),
    cancelledAt: timestamp("cancelled_at", { mode: "date", withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => appUsers.id, { onDelete: "restrict" }),
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
    productId: uuid("product_id").references(() => mallProducts.id, { onDelete: "restrict" }),
    productKind: text("product_kind"),
    quantity: integer("quantity"),
    refundedAt: timestamp("refunded_at", { mode: "date", withTimezone: true }),
    refundedBy: uuid("refunded_by").references(() => appUsers.id, { onDelete: "restrict" }),
    remark: text("remark").notNull().default(""),
    shippedAt: timestamp("shipped_at", { mode: "date", withTimezone: true }),
    shippedBy: uuid("shipped_by").references(() => appUsers.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    title: text("title").notNull(),
    type: text("type").notNull(),
    unitPoints: bigint("unit_points", { mode: "number" }),
  },
  (table) => [
    index("mall_order_group_created_index").on(table.groupId, table.createdAt, table.id),
    index("mall_order_created_index").on(table.createdAt, table.id),
    index("mall_order_status_created_index").on(table.status, table.createdAt, table.id),
    unique("mall_order_idempotency_unique").on(table.groupId, table.idempotencyKey),
    check("mall_order_type_check", sql`${table.type} in ('points', 'resource')`),
    check(
      "mall_order_status_check",
      sql`${table.status} in ('unpaid', 'paid', 'closed', 'pending_ship', 'shipped', 'refunded', 'cancelled')`,
    ),
    check(
      "mall_order_payment_method_check",
      sql`${table.paymentMethod} in ('manual', 'points', 'alipay')`,
    ),
    check("mall_order_amount_check", sql`${table.amountCents} >= 0`),
    check(
      "mall_order_shape_check",
      sql`(${table.type} = 'points' and ${table.status} in ('unpaid', 'paid', 'closed') and ${table.amountCents} > 0
          and ${table.productId} is null and (${table.status} <> 'paid' or ${table.paidAt} is not null))
        or (${table.type} = 'resource' and ${table.status} in ('pending_ship', 'shipped', 'refunded', 'cancelled')
          and ${table.amountCents} = 0 and ${table.productId} is not null
          and ${table.productKind} in ('account', 'proxy') and ${table.quantity} > 0
          and ${table.unitPoints} > 0 and ${table.points} = ${table.quantity} * ${table.unitPoints})`,
    ),
    check("mall_order_points_check", sql`${table.points} > 0`),
    check(
      "mall_order_shipped_check",
      sql`(${table.status} in ('shipped', 'refunded')) = (${table.shippedAt} is not null)`,
    ),
    check(
      "mall_order_refunded_check",
      sql`(${table.status} = 'refunded') = (${table.refundedAt} is not null)`,
    ),
    uniqueIndex("mall_order_alipay_trade_no_unique")
      .on(table.alipayTradeNo)
      .where(sql`${table.alipayTradeNo} is not null`),
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

export const mallResourceTransfers = pgTable(
  "mall_resource_transfer",
  {
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    displayName: text("display_name").notNull(),
    entityId: uuid("entity_id").notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind").notNull(),
    movedBy: uuid("moved_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").references(() => mallOrders.id, { onDelete: "restrict" }),
    reason: text("reason").notNull().default(""),
    sourceGroupId: uuid("source_group_id").references(() => accessGroups.id, {
      onDelete: "set null",
    }),
    targetGroupId: uuid("target_group_id").references(() => accessGroups.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("mall_resource_transfer_order_entity_unique")
      .on(table.orderId, table.entityId)
      .where(sql`${table.orderId} is not null`),
    index("mall_resource_transfer_created_index").on(table.createdAt, table.id),
    check("mall_resource_transfer_kind_check", sql`${table.kind} in ('account', 'proxy')`),
  ],
)

const bytea = customType<{ data: Uint8Array }>({ dataType: () => "bytea" })

export const mallInvoices = pgTable(
  "mall_invoice",
  {
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "restrict" }),
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    invoiceNumber: text("invoice_number").notNull().default(""),
    invoiceType: text("invoice_type").notNull(),
    rejectReason: text("reject_reason").notNull().default(""),
    remark: text("remark").notNull().default(""),
    reviewedAt: timestamp("reviewed_at", { mode: "date", withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => appUsers.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("pending"),
    taxNumber: text("tax_number").notNull().default(""),
    title: text("title").notNull(),
    titleType: text("title_type").notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("mall_invoice_idempotency_unique").on(table.groupId, table.idempotencyKey),
    index("mall_invoice_group_created_index").on(table.groupId, table.createdAt, table.id),
    index("mall_invoice_status_created_index").on(table.status, table.createdAt, table.id),
    check("mall_invoice_amount_check", sql`${table.amountCents} > 0`),
    check("mall_invoice_type_check", sql`${table.invoiceType} in ('normal', 'special')`),
    check("mall_invoice_title_type_check", sql`${table.titleType} in ('company', 'personal')`),
    check("mall_invoice_status_check", sql`${table.status} in ('pending', 'issued', 'rejected')`),
    check(
      "mall_invoice_tax_check",
      sql`(${table.titleType} = 'company' and ${table.taxNumber} <> '')
        or (${table.titleType} = 'personal' and ${table.taxNumber} = '' and ${table.invoiceType} = 'normal')`,
    ),
    check(
      "mall_invoice_review_check",
      sql`(${table.status} = 'pending' and ${table.reviewedAt} is null)
        or (${table.status} = 'issued' and ${table.reviewedAt} is not null and ${table.invoiceNumber} <> '')
        or (${table.status} = 'rejected' and ${table.reviewedAt} is not null and ${table.rejectReason} <> '')`,
    ),
  ],
)

export const mallInvoiceFiles = pgTable(
  "mall_invoice_file",
  {
    content: bytea("content").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    fileName: text("file_name").notNull(),
    invoiceId: uuid("invoice_id")
      .primaryKey()
      .references(() => mallInvoices.id, { onDelete: "restrict" }),
  },
  (table) => [
    check(
      "mall_invoice_file_size_check",
      sql`octet_length(${table.content}) between 1 and 5242880`,
    ),
  ],
)
