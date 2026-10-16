CREATE TABLE device_remark (
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES business_label(id) ON DELETE CASCADE,
  PRIMARY KEY (device_id, label_id)
);
--> statement-breakpoint
CREATE INDEX device_remark_label_index ON device_remark (label_id);
--> statement-breakpoint
INSERT INTO device_remark (device_id, label_id)
SELECT id, remark_id FROM device WHERE remark_id IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_device_business_labels() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.box_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM business_label l WHERE l.id = NEW.box_group_id AND l.scope = 'device'
      AND l.kind = 'group' AND (
        l.administrator_id = NEW.assignee_user_id OR (
          NEW.assignee_user_id IS NULL AND NEW.assignment_pending AND EXISTS (
            SELECT 1 FROM user_group ug
            WHERE ug.group_id = NEW.group_id AND ug.user_id = l.administrator_id
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Invalid device group classification' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER device_validate_business_labels ON device;
--> statement-breakpoint
CREATE TRIGGER device_validate_business_labels
  BEFORE INSERT OR UPDATE OF box_group_id, assignee_user_id ON device
  FOR EACH ROW EXECUTE FUNCTION validate_device_business_labels();
--> statement-breakpoint
ALTER TABLE device DROP COLUMN remark_id;
--> statement-breakpoint
ALTER TABLE device ADD COLUMN sequence_no integer;
--> statement-breakpoint
ALTER TABLE device ADD CONSTRAINT device_sequence_no_check
  CHECK (sequence_no IS NULL OR (sequence_no >= 1 AND sequence_no <= 999));
--> statement-breakpoint
CREATE FUNCTION validate_device_remark() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner uuid;
  pending boolean;
  owner_group uuid;
BEGIN
  SELECT assignee_user_id, assignment_pending, group_id
    INTO owner, pending, owner_group
  FROM device WHERE id = NEW.device_id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM business_label l WHERE l.id = NEW.label_id AND l.scope = 'device'
      AND l.kind = 'remark' AND (
        l.administrator_id = owner OR (
          owner IS NULL AND pending AND EXISTS (
            SELECT 1 FROM user_group ug
            WHERE ug.group_id = owner_group AND ug.user_id = l.administrator_id
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Invalid device remark classification' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER device_remark_validate
  BEFORE INSERT OR UPDATE ON device_remark
  FOR EACH ROW EXECUTE FUNCTION validate_device_remark();
