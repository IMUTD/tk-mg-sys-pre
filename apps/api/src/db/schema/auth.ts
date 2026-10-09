import {
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { Role } from "../../lib/authorization"

export const appRole = pgEnum("app_role", [
  Role.Administrator,
  Role.OperationsDirector,
  Role.Operator,
  Role.SalesDirector,
  Role.Salesperson,
  Role.EngineeringDirector,
  Role.Engineer,
])

export const accessGroups = pgTable("access_group", {
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
})

export const appUsers = pgTable("app_user", {
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  displayName: text("display_name").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  email: text("email").notNull().unique(),
  id: uuid("id").defaultRandom().primaryKey(),
  passwordHash: text("password_hash").notNull(),
  passwordPlain: text("password_plain").notNull().default(""),
  provisionedBy: text("provisioned_by").notNull().default("sys"),
  role: appRole("role").notNull(),
})

export const systemSettings = pgTable("system_setting", {
  encryptedValue: text("encrypted_value"),
  key: text("key").primaryKey(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  updatedBy: uuid("updated_by")
    .notNull()
    .references(() => appUsers.id, { onDelete: "restrict" }),
  value: jsonb("value").notNull().default({}),
})

export const userGroups = pgTable(
  "user_group",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.groupId] })],
)

export const rolePagePermissions = pgTable(
  "role_page_permission",
  {
    canDelete: boolean("can_delete").notNull(),
    canView: boolean("can_view").notNull(),
    pageKey: text("page_key").notNull(),
    role: appRole("role").notNull(),
  },
  (table) => [primaryKey({ columns: [table.role, table.pageKey] })],
)

export const userPagePermissions = pgTable(
  "user_page_permission",
  {
    canDelete: boolean("can_delete").notNull(),
    canView: boolean("can_view").notNull(),
    pageKey: text("page_key").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.pageKey] })],
)

export const appSessions = pgTable("app_session", {
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
  id: uuid("id").primaryKey(),
  revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => appUsers.id, { onDelete: "cascade" }),
})

export const auditEvents = pgTable("audit_event", {
  action: text("action").notNull(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => appUsers.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  id: uuid("id").primaryKey(),
  metadata: jsonb("metadata").notNull().default({}),
  outcome: text("outcome").notNull(),
  target: text("target").notNull(),
})
