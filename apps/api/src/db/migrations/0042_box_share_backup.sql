ALTER TABLE box_share_entry DROP CONSTRAINT box_share_entry_bucket_check;--> statement-breakpoint
ALTER TABLE box_share_entry
  ADD CONSTRAINT box_share_entry_bucket_check
  CHECK (bucket IN ('share', 'video', 'mbp', 'backup'));--> statement-breakpoint
ALTER TABLE box_share_scan
  ADD COLUMN buckets text NOT NULL DEFAULT 'share,video,mbp';--> statement-breakpoint
ALTER TABLE box_share_scan
  ADD CONSTRAINT box_share_scan_buckets_check
  CHECK (buckets IN ('share,video,mbp', 'backup'));--> statement-breakpoint
INSERT INTO role_page_permission (role, page_key, can_view, can_delete)
SELECT role, '/studio/backup-resources', can_view, can_delete
FROM role_page_permission
WHERE page_key = '/studio/video-resources'
ON CONFLICT (role, page_key) DO NOTHING;--> statement-breakpoint
INSERT INTO user_page_permission (user_id, page_key, can_view, can_delete)
SELECT user_id, '/studio/backup-resources', can_view, can_delete
FROM user_page_permission
WHERE page_key = '/studio/video-resources'
ON CONFLICT (user_id, page_key) DO NOTHING;
