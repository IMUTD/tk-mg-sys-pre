CREATE TABLE box_share_scan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  started_at timestamptz,
  finished_at timestamptz,
  file_count integer NOT NULL DEFAULT 0,
  dir_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT box_share_scan_status_check
    CHECK (status IN ('pending', 'running', 'complete', 'failed'))
);--> statement-breakpoint
CREATE UNIQUE INDEX box_share_scan_one_active
  ON box_share_scan (device_id)
  WHERE status IN ('pending', 'running');--> statement-breakpoint
CREATE TABLE box_share_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  bucket text NOT NULL,
  relative_path text NOT NULL,
  parent_path text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  category text NOT NULL DEFAULT '',
  size_bytes bigint NOT NULL DEFAULT 0,
  mtime timestamptz,
  sha256 text NOT NULL DEFAULT '',
  last_scan_id uuid NOT NULL REFERENCES box_share_scan(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT box_share_entry_bucket_check CHECK (bucket IN ('share', 'video', 'mbp')),
  CONSTRAINT box_share_entry_kind_check CHECK (kind IN ('dir', 'file')),
  CONSTRAINT box_share_entry_category_check CHECK (category IN ('', 'video', 'text', 'image', 'other')),
  CONSTRAINT box_share_entry_sha_check CHECK (sha256 = '' OR sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT box_share_entry_path_shape CHECK (
    name <> ''
    AND position('/' IN name) = 0
    AND char_length(relative_path) <= 512
    AND (
      (parent_path = '' AND relative_path = name)
      OR relative_path = parent_path || '/' || name
    )
  ),
  CONSTRAINT box_share_entry_path_unique UNIQUE (device_id, bucket, relative_path)
);--> statement-breakpoint
CREATE INDEX box_share_entry_list ON box_share_entry (device_id, bucket, parent_path);--> statement-breakpoint
CREATE INDEX box_share_entry_scan ON box_share_entry (device_id, last_scan_id);--> statement-breakpoint
INSERT INTO role_page_permission (role, page_key, can_view, can_delete)
SELECT role, '/studio/video-resources', can_view, can_delete
FROM role_page_permission
WHERE page_key = '/studio/video-pool'
ON CONFLICT (role, page_key) DO NOTHING;
