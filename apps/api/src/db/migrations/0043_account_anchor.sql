ALTER TABLE operation_account
  ADD COLUMN language text NOT NULL DEFAULT '',
  ADD COLUMN backup_device_id uuid,
  ADD COLUMN backup_sha256 text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE operation_account
  ADD CONSTRAINT operation_account_backup_device_id_device_id_fk
  FOREIGN KEY (backup_device_id) REFERENCES device(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE operation_account
  ADD CONSTRAINT operation_account_device_instance_pair_fk
  FOREIGN KEY (device_instance_id, device_id)
  REFERENCES device_instance(id, device_id);--> statement-breakpoint
CREATE FUNCTION operation_account_device_pair() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.device_id IS NULL) <> (NEW.device_instance_id IS NULL) THEN
    RAISE EXCEPTION 'device and pit must both be set or both be empty';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER operation_account_device_pair_trigger
AFTER INSERT OR UPDATE OF device_id, device_instance_id ON operation_account
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION operation_account_device_pair();--> statement-breakpoint
CREATE INDEX operation_account_backup_device_index ON operation_account (backup_device_id);--> statement-breakpoint
COMMENT ON COLUMN operation_account.language IS '上一次写入云机的语言';--> statement-breakpoint
COMMENT ON COLUMN operation_account.backup_device_id IS '上一次云机备份所在盒子，可以和当前盒子不同';--> statement-breakpoint
COMMENT ON COLUMN operation_account.backup_sha256 IS '上一次云机备份的校验';--> statement-breakpoint
ALTER TABLE behavior_chain
  ADD COLUMN anchor_table text NOT NULL DEFAULT '',
  ADD COLUMN anchor_key text NOT NULL DEFAULT '',
  ADD COLUMN param_sources jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE behavior_chain
  ADD CONSTRAINT behavior_chain_anchor_pair_check
  CHECK (
    (anchor_table = '' AND anchor_key = '')
    OR (anchor_table = 'operation_account' AND anchor_key = 'id')
  );--> statement-breakpoint
ALTER TABLE behavior_chain
  ADD CONSTRAINT behavior_chain_param_sources_array_check
  CHECK (jsonb_typeof(param_sources) = 'array');--> statement-breakpoint
COMMENT ON COLUMN behavior_chain.anchor_table IS '参数约束的数据表，空表示不约束';--> statement-breakpoint
COMMENT ON COLUMN behavior_chain.anchor_key IS '参数约束的主键，必须和数据表成对';--> statement-breakpoint
COMMENT ON COLUMN behavior_chain.param_sources IS '每个步骤的输入参数来源，与 parameters 等长';
