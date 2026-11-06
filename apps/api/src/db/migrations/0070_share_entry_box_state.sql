ALTER TABLE box_share_entry
  ADD COLUMN box_online boolean NOT NULL DEFAULT false,
  ADD COLUMN assignee_user_id uuid;

UPDATE box_share_entry AS entry
SET box_online = device.status = 'online' AND device.enabled,
    assignee_user_id = device.assignee_user_id
FROM device
WHERE device.id = entry.device_id;

CREATE INDEX box_share_entry_assignee_online_idx
  ON box_share_entry (assignee_user_id, box_online, category)
  WHERE assignee_user_id IS NOT NULL AND box_online;
