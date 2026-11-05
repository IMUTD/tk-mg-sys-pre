import { sql } from "drizzle-orm"
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { appUsers } from "./auth"

export const adminIdentityVerifications = pgTable(
  "admin_identity_verification",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("unverified"),
    version: integer("version").notNull().default(0),
    currentAttemptId: uuid("current_attempt_id"),
    encryptedName: text("encrypted_name"),
    encryptedNumber: text("encrypted_number"),
    maskedName: text("masked_name"),
    maskedNumber: text("masked_number"),
    certNoHmac: text("cert_no_hmac"),
    hmacKeyVersion: text("hmac_key_version"),
    lastErrorCode: text("last_error_code"),
    verifiedAt: timestamp("verified_at", { mode: "date", withTimezone: true }),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("admin_identity_verified_hmac_unique")
      .on(table.certNoHmac)
      .where(sql`${table.status} = 'verified'`),
  ],
)

export const identityVerificationAttempts = pgTable(
  "identity_verification_attempt",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    bindingVersion: integer("binding_version").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint"),
    status: text("status").notNull(),
    provider: text("provider").notNull().default("aliyun"),
    providerRequestId: text("provider_request_id"),
    providerCode: text("provider_code"),
    providerBizCode: text("provider_biz_code"),
    errorCode: text("error_code"),
    consentVersion: text("consent_version").notNull(),
    consentedAt: timestamp("consented_at", { mode: "date", withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }).notNull(),
    deadlineAt: timestamp("deadline_at", { mode: "date", withTimezone: true }).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { mode: "date", withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true }),
  },
  (table) => [
    uniqueIndex("identity_verification_attempt_user_id_idempotency_key_key").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("identity_attempt_user_started").on(table.userId, table.startedAt),
    index("identity_attempt_started").on(table.startedAt),
    index("identity_attempt_processing_lease")
      .on(table.leaseExpiresAt)
      .where(sql`${table.status} = 'verifying'`),
  ],
)
export const identityPasswordFailures = pgTable(
  "identity_password_failure",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    attemptedAt: timestamp("attempted_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("identity_password_failure_actor_time").on(table.actorId, table.attemptedAt)],
)
