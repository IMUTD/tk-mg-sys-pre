import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { accessGroups, appUsers } from "./auth"
import { deviceInstances, devices } from "./devices"

export const operationAccountStatus = pgEnum("operation_account_status", [
  "ready",
  "suspended",
  "disabled",
])

export const operationAccountApp = pgEnum("operation_account_app", [
  "tiktok",
  "youtube",
  "facebook",
  "instagram",
  "twitter",
])

export const operationAccountBackupType = pgEnum("operation_account_backup_type", [
  "local",
  "private_cloud",
])

export const operationProxyStatus = pgEnum("operation_proxy_status", [
  "ready",
  "unavailable",
  "disabled",
])

export const operationResourceStatus = pgEnum("operation_resource_status", [
  "available",
  "allocated",
  "inactive",
])

export const operationResources = pgTable(
  "operation_resource",
  {
    category: text("category").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "cascade" }),
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    note: text("note").notNull().default(""),
    status: operationResourceStatus("status").notNull().default("available"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("operation_resource_group_created_index").on(table.groupId, table.createdAt)],
)

export const operationProxies = pgTable(
  "operation_proxy",
  {
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    encryptedCredentials: text("encrypted_credentials").notNull(),
    endpoint: text("endpoint").notNull(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "cascade" }),
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    note: text("note").notNull().default(""),
    status: operationProxyStatus("status").notNull().default("ready"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("operation_proxy_group_created_index").on(table.groupId, table.createdAt)],
)

export const operationAccounts = pgTable(
  "operation_account",
  {
    app: operationAccountApp("app"),
    avatar: text("avatar").notNull().default(""),
    backupKey: text("backup_key").notNull().default(""),
    backupSlot: text("backup_slot").notNull().default(""),
    backupType: operationAccountBackupType("backup_type"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    deleted: boolean("deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    deviceInstanceId: uuid("device_instance_id").references(() => deviceInstances.id, {
      onDelete: "set null",
    }),
    encryptedSecret: text("encrypted_secret").notNull(),
    encryptedTotp: text("encrypted_totp").notNull().default(""),
    encryptedTransferKey: text("encrypted_transfer_key").notNull().default(""),
    extra: jsonb("extra").notNull().default({}),
    favorite: bigint("favorite", { mode: "number" }),
    follower: bigint("follower", { mode: "number" }),
    following: bigint("following", { mode: "number" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "cascade" }),
    id: uuid("id").defaultRandom().primaryKey(),
    identifier: text("identifier").notNull(),
    name: text("name").notNull(),
    note: text("note").notNull().default(""),
    online: boolean("online").notNull().default(false),
    platformUid: text("platform_uid").notNull().default(""),
    proxyId: uuid("proxy_id").references(() => operationProxies.id, { onDelete: "set null" }),
    region: text("region").notNull().default(""),
    status: operationAccountStatus("status").notNull().default("ready"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    transferred: boolean("transferred").notNull().default(false),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("operation_account_app_index").on(table.groupId, table.app),
    index("operation_account_deleted_at_index").on(table.deleted, table.deletedAt),
    index("operation_account_device_instance_index").on(table.deviceId, table.deviceInstanceId),
    index("operation_account_group_active_index").on(table.groupId, table.deleted, table.createdAt),
    index("operation_account_group_created_index").on(table.groupId, table.createdAt),
    index("operation_account_platform_uid_index").on(table.groupId, table.platformUid),
    index("operation_account_proxy_index").on(table.proxyId),
    uniqueIndex("operation_account_group_identifier_unique").on(table.groupId, table.identifier),
  ],
)

export const operationAccountLeases = pgTable(
  "operation_account_lease",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => operationAccounts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "cascade" }),
    id: uuid("id").defaultRandom().primaryKey(),
    leasedByUserId: uuid("leased_by_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    releasedAt: timestamp("released_at", { mode: "date", withTimezone: true }),
  },
  (table) => [
    index("operation_account_lease_group_created_index").on(table.groupId, table.createdAt),
    uniqueIndex("operation_account_lease_active_unique")
      .on(table.accountId)
      .where(sql`${table.releasedAt} is null`),
  ],
)

export const operationResourceAllocations = pgTable(
  "operation_resource_allocation",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => operationAccounts.id, { onDelete: "cascade" }),
    allocatedByUserId: uuid("allocated_by_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "cascade" }),
    id: uuid("id").defaultRandom().primaryKey(),
    releasedAt: timestamp("released_at", { mode: "date", withTimezone: true }),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => operationResources.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("operation_resource_allocation_resource_created_index").on(
      table.resourceId,
      table.createdAt,
    ),
    uniqueIndex("operation_resource_allocation_active_unique")
      .on(table.resourceId)
      .where(sql`${table.releasedAt} is null`),
  ],
)
