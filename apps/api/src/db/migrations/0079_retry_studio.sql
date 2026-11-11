ALTER TABLE business_label
  ADD COLUMN last_account_id uuid REFERENCES operation_account(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE operation_resource
  ADD COLUMN last_account_id uuid REFERENCES operation_account(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE box_share_entry
  ADD COLUMN last_account_id uuid REFERENCES operation_account(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX business_label_last_account_index ON business_label (last_account_id);
--> statement-breakpoint
CREATE INDEX operation_resource_last_account_index ON operation_resource (last_account_id);
--> statement-breakpoint
CREATE INDEX box_share_entry_last_account_index ON box_share_entry (last_account_id);
--> statement-breakpoint
CREATE TABLE quick_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  administrator_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 40),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quick_task_admin_name_unique UNIQUE (administrator_id, name)
);
--> statement-breakpoint
CREATE TABLE match_image (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  administrator_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2000000),
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_image_admin_sha_unique UNIQUE (administrator_id, sha256)
);
