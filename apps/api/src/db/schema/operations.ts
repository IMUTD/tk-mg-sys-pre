import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
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
import { deviceInstances, devices } from "./devices"

export const operationAccountStatus = pgEnum("operation_account_status", [
  "ready",
  "suspended",
  "disabled",
  "expired",
  "hidden",
  "unregistered",
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
  "cloud",
  "full",
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
    displayId: bigint("display_id", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    configuration: jsonb("configuration"),
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
    checkResult: jsonb("check_result"),
    probeToken: uuid("probe_token"),
    probeStartedAt: timestamp("probe_started_at", { mode: "date", withTimezone: true }),
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
  (table) => [
    index("operation_proxy_group_created_index").on(table.groupId, table.createdAt),
    uniqueIndex("operation_proxy_display_id_unique").on(table.displayId),
    uniqueIndex("operation_proxy_group_id_unique").on(table.groupId, table.id),
    check("operation_proxy_revision_positive", sql`${table.revision} > 0`),
    check(
      "operation_proxy_configuration_object",
      sql`${table.configuration} is null or jsonb_typeof(${table.configuration}) = 'object'`,
    ),
    check(
      "operation_proxy_result_object",
      sql`${table.checkResult} is null or jsonb_typeof(${table.checkResult}) = 'object'`,
    ),
  ],
)

export const operationProxyAccelerators = pgTable(
  "operation_proxy_accelerator",
  {
    groupId: uuid("group_id").notNull(),
    proxyId: uuid("proxy_id").notNull(),
    acceleratorId: uuid("accelerator_id").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.proxyId, table.acceleratorId] }),
    unique("operation_proxy_accelerator_position_unique").on(table.proxyId, table.position),
    index("operation_proxy_accelerator_target_index").on(table.acceleratorId),
    foreignKey({
      name: "operation_proxy_accelerator_owner_fk",
      columns: [table.groupId, table.proxyId],
      foreignColumns: [operationProxies.groupId, operationProxies.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "operation_proxy_accelerator_target_fk",
      columns: [table.groupId, table.acceleratorId],
      foreignColumns: [operationProxies.groupId, operationProxies.id],
    }).onDelete("restrict"),
    check(
      "operation_proxy_accelerator_position_check",
      sql`${table.position} >= 0 and ${table.position} <= 10`,
    ),
    check("operation_proxy_accelerator_check", sql`${table.proxyId} <> ${table.acceleratorId}`),
  ],
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
    language: text("language").notNull().default(""),
    backupDeviceId: uuid("backup_device_id").references(() => devices.id, { onDelete: "set null" }),
    backupSha256: text("backup_sha256").notNull().default(""),
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
    transferKeyHash: text("transfer_key_hash"),
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
    index("operation_account_group_transfer_hash_index").on(table.groupId, table.transferKeyHash),
    index("operation_account_backup_device_index").on(table.backupDeviceId),
    uniqueIndex("operation_account_group_identifier_unique").on(table.groupId, table.identifier),
    foreignKey({
      columns: [table.deviceInstanceId, table.deviceId],
      foreignColumns: [deviceInstances.id, deviceInstances.deviceId],
      name: "operation_account_device_instance_pair_fk",
    }),
  ],
)

export const operationAccountTransfers = pgTable(
  "operation_account_transfer",
  {
    codeHash: text("code_hash").notNull(),
    consumedAt: timestamp("consumed_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    encryptedCode: text("encrypted_code").notNull(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "cascade" }),
    id: uuid("id").defaultRandom().primaryKey(),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    splitSize: integer("split_size"),
    status: text("status").notNull().default("active"),
  },
  (table) => [
    uniqueIndex("operation_account_transfer_code_unique").on(table.codeHash),
    index("operation_account_transfer_group_status_index").on(table.groupId, table.status),
    check(
      "operation_account_transfer_status_check",
      sql`${table.status} in ('active', 'revoked', 'consumed')`,
    ),
  ],
)

export const operationAccountTransferItems = pgTable(
  "operation_account_transfer_item",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => operationAccounts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    transferId: uuid("transfer_id")
      .notNull()
      .references(() => operationAccountTransfers.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.transferId, table.accountId] })],
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
