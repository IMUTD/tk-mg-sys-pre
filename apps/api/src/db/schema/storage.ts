import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

import { appUsers } from "./auth"

export const storageSettings = pgTable("storage_setting", {
  encryptedCredentials: text("encrypted_credentials"),
  key: text("key").primaryKey(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  updatedBy: uuid("updated_by")
    .notNull()
    .references(() => appUsers.id, { onDelete: "restrict" }),
  value: jsonb("value").notNull().default({}),
})
