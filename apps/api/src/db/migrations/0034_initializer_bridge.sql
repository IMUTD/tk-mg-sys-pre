ALTER TABLE device ADD COLUMN assignment_pending boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE execution_task_step ADD COLUMN guard_probe_index integer;--> statement-breakpoint
ALTER TABLE execution_task_step ADD COLUMN guard_response jsonb;--> statement-breakpoint
CREATE TABLE device_group_history (
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES access_group(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, group_id)
);--> statement-breakpoint
INSERT INTO device_group_history (device_id, group_id) SELECT id, group_id FROM device;--> statement-breakpoint
CREATE FUNCTION record_device_group() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO device_group_history(device_id, group_id)
  VALUES (NEW.id, NEW.group_id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER device_group_history_record AFTER INSERT OR UPDATE OF group_id ON device
FOR EACH ROW EXECUTE FUNCTION record_device_group();--> statement-breakpoint
ALTER TABLE execution_task DROP CONSTRAINT execution_task_device_group_fk;--> statement-breakpoint
ALTER TABLE execution_task ADD CONSTRAINT execution_task_device_group_fk
FOREIGN KEY(device_id, group_id) REFERENCES device_group_history(device_id, group_id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE execution_task_device_lease DROP CONSTRAINT execution_task_device_lease_device_group_fk;--> statement-breakpoint
ALTER TABLE execution_task_device_lease ADD CONSTRAINT execution_task_device_lease_device_group_fk
FOREIGN KEY(device_id, group_id) REFERENCES device_group_history(device_id, group_id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE device_command DROP CONSTRAINT device_command_device_fk;--> statement-breakpoint
ALTER TABLE device_command ADD CONSTRAINT device_command_device_fk
FOREIGN KEY(device_id, group_id) REFERENCES device_group_history(device_id, group_id) ON DELETE RESTRICT;--> statement-breakpoint
CREATE FUNCTION require_current_device_group() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM device WHERE id = NEW.device_id AND group_id = NEW.group_id AND NOT assignment_pending) THEN
    RAISE EXCEPTION 'device is not assigned to the requested group' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER execution_task_current_group BEFORE INSERT OR UPDATE OF device_id, group_id ON execution_task
FOR EACH ROW EXECUTE FUNCTION require_current_device_group();--> statement-breakpoint
CREATE TRIGGER execution_lease_current_group BEFORE INSERT OR UPDATE OF device_id, group_id ON execution_task_device_lease
FOR EACH ROW EXECUTE FUNCTION require_current_device_group();--> statement-breakpoint
CREATE TRIGGER device_command_current_group BEFORE INSERT OR UPDATE OF device_id, group_id ON device_command
FOR EACH ROW EXECUTE FUNCTION require_current_device_group();--> statement-breakpoint
CREATE TABLE init_admin_mapping (
  source_key text NOT NULL,
  source_id text NOT NULL,
  user_id uuid NOT NULL UNIQUE REFERENCES app_user(id) ON DELETE RESTRICT,
  group_id uuid NOT NULL REFERENCES access_group(id) ON DELETE RESTRICT,
  PRIMARY KEY(source_key, source_id)
);--> statement-breakpoint
CREATE TABLE init_box_mapping (
  source_key text NOT NULL,
  external_id text NOT NULL,
  device_id uuid NOT NULL UNIQUE REFERENCES device(id) ON DELETE RESTRICT,
  PRIMARY KEY(source_key, external_id)
);--> statement-breakpoint
CREATE TABLE init_sync_state (
  source_key text PRIMARY KEY,
  last_success_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX execution_guard_active_unique
ON execution_task_step(parent_step_id, guard_code)
WHERE parent_step_id IS NOT NULL AND status IN ('pending','claimed','running');
