ALTER TABLE box_share_entry
  ADD COLUMN place text NOT NULL DEFAULT 'box',
  ADD COLUMN nas_id uuid,
  ADD COLUMN nas_key text NOT NULL DEFAULT '';

ALTER TABLE box_share_entry
  ADD CONSTRAINT box_share_entry_place_check CHECK (place IN ('box', 'nas')),
  ADD CONSTRAINT box_share_entry_nas_shape_check CHECK (
    (place = 'box' AND nas_id IS NULL AND nas_key = '')
    OR (place = 'nas' AND nas_id IS NOT NULL AND nas_key <> '')
  );

CREATE UNIQUE INDEX box_share_entry_nas_object
  ON box_share_entry (assignee_user_id, nas_id, nas_key)
  WHERE place = 'nas';

UPDATE storage_setting
SET key = 'private-cloud:' || updated_by::text
WHERE key = 'private-cloud' AND updated_by IS NOT NULL;
