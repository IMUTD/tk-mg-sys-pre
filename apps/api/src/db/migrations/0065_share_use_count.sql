ALTER TABLE box_share_entry
  ADD COLUMN use_count integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE box_share_entry
  ADD CONSTRAINT box_share_entry_use_count_check
  CHECK (use_count >= 0);--> statement-breakpoint
CREATE INDEX box_share_entry_backup_name
  ON box_share_entry (name)
  WHERE bucket = 'backup' AND kind = 'file' AND sha256 <> '';
