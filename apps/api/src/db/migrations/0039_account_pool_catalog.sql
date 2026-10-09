CREATE TABLE "operation_account_pool" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "display_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL UNIQUE,
  "group_id" uuid NOT NULL REFERENCES "access_group"("id") ON DELETE RESTRICT,
  "created_by_user_id" uuid NOT NULL REFERENCES "app_user"("id") ON DELETE RESTRICT,
  "key" text NOT NULL,
  "remark" text NOT NULL DEFAULT '',
  "back_type" text NOT NULL,
  "device_id" uuid,
  "device_seq" integer,
  "device_label" text NOT NULL DEFAULT '',
  "times" integer NOT NULL DEFAULT 1,
  "member_count" integer NOT NULL,
  "filter_condition" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  "deleted_at" timestamptz,
  CONSTRAINT "operation_account_pool_back_type_check" CHECK ("back_type" IN ('1','2','3','4','5')),
  CONSTRAINT "operation_account_pool_times_check" CHECK ("times" BETWEEN 1 AND 20),
  CONSTRAINT "operation_account_pool_size_check" CHECK ("member_count" BETWEEN 1 AND 3000),
  CONSTRAINT "operation_account_pool_key_check" CHECK (length(trim("key")) BETWEEN 1 AND 160 AND position('+' in "key") = 0),
  CONSTRAINT "operation_account_pool_device_check" CHECK (
    ("back_type" IN ('1','2','4') AND "device_id" IS NOT NULL)
    OR ("back_type" IN ('3','5') AND "device_id" IS NULL)),
  CONSTRAINT "operation_account_pool_seq_check" CHECK (
    ("back_type" = '1' AND ("device_seq" IS NULL OR "device_seq" BETWEEN 1 AND 12))
    OR ("back_type" <> '1' AND "device_seq" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "operation_account_pool_active_key_unique"
  ON "operation_account_pool" ("group_id", "key") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "operation_account_pool_group_created_index"
  ON "operation_account_pool" ("group_id", "created_at", "id");
--> statement-breakpoint
CREATE TABLE "operation_account_pool_member" (
  "pool_id" uuid NOT NULL REFERENCES "operation_account_pool"("id") ON DELETE RESTRICT,
  "account_id" uuid NOT NULL,
  "position" integer NOT NULL CHECK ("position" BETWEEN 1 AND 3000),
  "snapshot" jsonb NOT NULL,
  PRIMARY KEY ("pool_id", "account_id"),
  UNIQUE ("pool_id", "position")
);
--> statement-breakpoint
CREATE TABLE "operation_account_pool_consumption" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "pool_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "round" integer NOT NULL CHECK ("round" BETWEEN 1 AND 20),
  "consumption_key" text NOT NULL CHECK (length("consumption_key") BETWEEN 1 AND 160),
  "actor_id" uuid NOT NULL REFERENCES "app_user"("id") ON DELETE RESTRICT,
  "origin" text NOT NULL DEFAULT 'reported' CHECK ("origin" IN ('reported','simulation')),
  "consumed_at" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("pool_id", "account_id") REFERENCES "operation_account_pool_member"("pool_id", "account_id") ON DELETE RESTRICT,
  UNIQUE ("pool_id", "round", "account_id"),
  UNIQUE ("pool_id", "consumption_key")
);
--> statement-breakpoint
CREATE INDEX "operation_account_pool_consumption_round_index"
  ON "operation_account_pool_consumption" ("pool_id", "round");
