ALTER TABLE business_label DROP CONSTRAINT business_label_scope_check;
--> statement-breakpoint
ALTER TABLE business_label ADD CONSTRAINT business_label_scope_check
  CHECK (scope IN (
    'device', 'account', 'account-tag', 'proxy', 'resource', 'registration', 'legacy',
    'behavior', 'task-chain'
  ));
--> statement-breakpoint
CREATE TABLE behavior_chain_remark (
  chain_id uuid NOT NULL REFERENCES behavior_chain(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES business_label(id) ON DELETE RESTRICT,
  PRIMARY KEY (chain_id, label_id)
);
--> statement-breakpoint
CREATE INDEX behavior_chain_remark_label_index ON behavior_chain_remark (label_id);
--> statement-breakpoint
CREATE TABLE task_chain_remark (
  task_chain_id uuid NOT NULL REFERENCES task_chain(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES business_label(id) ON DELETE RESTRICT,
  PRIMARY KEY (task_chain_id, label_id)
);
--> statement-breakpoint
CREATE INDEX task_chain_remark_label_index ON task_chain_remark (label_id);
--> statement-breakpoint
CREATE FUNCTION validate_behavior_chain_remark() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner uuid;
BEGIN
  SELECT administrator_id INTO owner FROM behavior_chain WHERE id = NEW.chain_id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM business_label l
    WHERE l.id = NEW.label_id AND l.scope = 'behavior' AND l.kind = 'remark'
      AND l.administrator_id = owner
  ) THEN
    RAISE EXCEPTION 'Invalid behavior chain remark' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER behavior_chain_remark_validate
  BEFORE INSERT OR UPDATE ON behavior_chain_remark
  FOR EACH ROW EXECUTE FUNCTION validate_behavior_chain_remark();
--> statement-breakpoint
CREATE FUNCTION validate_task_chain_remark() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner uuid;
BEGIN
  SELECT administrator_id INTO owner FROM task_chain WHERE id = NEW.task_chain_id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM business_label l
    WHERE l.id = NEW.label_id AND l.scope = 'task-chain' AND l.kind = 'remark'
      AND l.administrator_id = owner
  ) THEN
    RAISE EXCEPTION 'Invalid task chain remark' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER task_chain_remark_validate
  BEFORE INSERT OR UPDATE ON task_chain_remark
  FOR EACH ROW EXECUTE FUNCTION validate_task_chain_remark();
