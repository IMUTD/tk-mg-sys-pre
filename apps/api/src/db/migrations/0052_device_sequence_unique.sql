CREATE UNIQUE INDEX device_assignee_sequence_unique
  ON device (assignee_user_id, sequence_no)
  WHERE assignee_user_id IS NOT NULL AND sequence_no IS NOT NULL;
