ALTER TABLE app_user ADD COLUMN IF NOT EXISTS parent_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS app_user_parent_index ON app_user (parent_user_id);
