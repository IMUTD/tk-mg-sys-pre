ALTER TYPE operation_account_status ADD VALUE IF NOT EXISTS 'expired';
--> statement-breakpoint
ALTER TYPE operation_account_status ADD VALUE IF NOT EXISTS 'hidden';
--> statement-breakpoint
ALTER TYPE operation_account_backup_type ADD VALUE IF NOT EXISTS 'cloud';
--> statement-breakpoint
ALTER TYPE operation_account_backup_type ADD VALUE IF NOT EXISTS 'full';
--> statement-breakpoint
ALTER TABLE operation_account ADD COLUMN IF NOT EXISTS transfer_key_hash text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS operation_account_group_tag_index ON operation_account (group_id, (tags[1])) WHERE NOT deleted;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS operation_account_group_follower_index ON operation_account (group_id, follower);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS operation_account_group_transfer_hash_index ON operation_account (group_id, transfer_key_hash) WHERE transfer_key_hash IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS operation_account_transfer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES access_group (id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
  code_hash text NOT NULL,
  encrypted_code text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  split_size integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  consumed_at timestamptz,
  CONSTRAINT operation_account_transfer_status_check CHECK (status IN ('active', 'revoked', 'consumed')),
  CONSTRAINT operation_account_transfer_code_unique UNIQUE (code_hash)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS operation_account_transfer_item (
  transfer_id uuid NOT NULL REFERENCES operation_account_transfer (id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES operation_account (id) ON DELETE CASCADE,
  position integer NOT NULL,
  PRIMARY KEY (transfer_id, account_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS operation_account_transfer_group_status_index ON operation_account_transfer (group_id, status);
