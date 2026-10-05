import { sql } from "drizzle-orm"
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { accessGroups } from "./auth"

export const registrationResourceKind = pgEnum("registration_resource_kind", [
  "google-email",
  "api-sms",
  "microsoft-oauth",
  "pop3",
])

export const registrationResourceStatus = pgEnum("registration_resource_status", [
  "unverified",
  "ready",
  "failed",
])

export const registrationResources = pgTable(
  "registration_resource",
  {
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    encryptedSecret: text("encrypted_secret").notNull(),
    fingerprint: text("fingerprint").notNull(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accessGroups.id, { onDelete: "cascade" }),
    id: uuid("id").defaultRandom().primaryKey(),
    identifier: text("identifier").notNull(),
    kind: registrationResourceKind("kind").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    note: text("note").notNull().default(""),
    status: registrationResourceStatus("status").notNull().default("unverified"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("registration_resource_group_created_index").on(table.groupId, table.createdAt),
    uniqueIndex("registration_resource_group_fingerprint_unique").on(
      table.groupId,
      table.fingerprint,
    ),
  ],
)
