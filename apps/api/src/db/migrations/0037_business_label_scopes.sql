ALTER TABLE business_label ADD COLUMN scope text NOT NULL DEFAULT 'legacy';
ALTER TABLE business_label ADD CONSTRAINT business_label_scope_check
  CHECK (scope IN ('device', 'account', 'account-tag', 'proxy', 'resource', 'registration', 'legacy'));
--> statement-breakpoint
-- Keep the original ID for a device reference, or a deterministic existing business use.
-- Unused labels have no recorded origin and remain recoverable in the legacy scope.
CREATE TEMP TABLE business_label_scope_usage ON COMMIT DROP AS
SELECT DISTINCT l.id, 'device'::text AS scope
FROM business_label l JOIN device d
  ON (l.kind = 'group' AND d.box_group_id = l.id)
  OR (l.kind = 'remark' AND d.remark_id = l.id)
UNION
SELECT DISTINCT l.id, r.scope
FROM (
  SELECT group_id, tag.name,
    CASE WHEN tag.position = 1 THEN 'account' ELSE 'account-tag' END AS scope
  FROM operation_account CROSS JOIN unnest(tags) WITH ORDINALITY AS tag(name, position)
  UNION ALL
  SELECT group_id, unnest(tags), 'proxy' FROM operation_proxy
  UNION ALL
  SELECT group_id, unnest(tags), 'resource' FROM operation_resource
  UNION ALL
  SELECT group_id, unnest(tags), 'registration' FROM registration_resource
) r
JOIN user_group ug ON ug.group_id = r.group_id
JOIN business_label l ON l.administrator_id = ug.user_id AND l.kind = 'group' AND l.name = r.name;
--> statement-breakpoint
ALTER TABLE business_label DROP CONSTRAINT business_label_admin_kind_name_unique;
ALTER TABLE business_label ADD CONSTRAINT business_label_admin_scope_kind_name_unique
  UNIQUE (administrator_id, scope, kind, name);
UPDATE business_label l SET scope = (
  SELECT u.scope FROM business_label_scope_usage u WHERE u.id = l.id
  ORDER BY (u.scope = 'device') DESC, u.scope LIMIT 1
) WHERE EXISTS (SELECT 1 FROM business_label_scope_usage u WHERE u.id = l.id);
INSERT INTO business_label (administrator_id, scope, kind, name, created_at)
SELECT l.administrator_id, u.scope, l.kind, l.name, l.created_at
FROM business_label_scope_usage u JOIN business_label l ON l.id = u.id
WHERE l.scope <> u.scope
ON CONFLICT (administrator_id, scope, kind, name) DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE VIEW box_remark AS SELECT id, administrator_id, name, created_at
  FROM business_label WHERE scope = 'device' AND kind = 'remark' WITH LOCAL CHECK OPTION;
CREATE OR REPLACE VIEW box_group AS SELECT id, administrator_id, name, created_at
  FROM business_label WHERE scope = 'device' AND kind = 'group' WITH LOCAL CHECK OPTION;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION collect_business_labels() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  label record;
BEGIN
  FOR label IN
    SELECT DISTINCT a.id AS administrator_id, tag.name,
      CASE TG_TABLE_NAME
        WHEN 'operation_account' THEN CASE WHEN tag.position = 1 THEN 'account' ELSE 'account-tag' END
        WHEN 'operation_proxy' THEN 'proxy'
        WHEN 'operation_resource' THEN 'resource'
        WHEN 'registration_resource' THEN 'registration'
      END AS scope
    FROM app_user a JOIN user_group ug ON ug.user_id = a.id
    CROSS JOIN unnest(NEW.tags) WITH ORDINALITY AS tag(name, position)
    WHERE ug.group_id = NEW.group_id AND a.role = 'administrator'
      AND a.provisioned_by = 'init-tool' AND a.enabled AND length(trim(tag.name)) > 0
    ORDER BY a.id, scope, tag.name
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      label.administrator_id::text || ':' || label.scope || ':group:' || label.name, 0));
    INSERT INTO business_label (administrator_id, scope, kind, name)
    VALUES (label.administrator_id, label.scope, 'group', label.name)
    ON CONFLICT (administrator_id, scope, kind, name) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Backfill current records without rewriting tags, notes, permissions, or device assignments.
INSERT INTO business_label (administrator_id, scope, kind, name)
SELECT DISTINCT a.id, r.scope, 'group', r.name
FROM (
  SELECT group_id, tag.name,
    CASE WHEN tag.position = 1 THEN 'account' ELSE 'account-tag' END AS scope
  FROM operation_account CROSS JOIN unnest(tags) WITH ORDINALITY AS tag(name, position)
  UNION ALL
  SELECT group_id, unnest(tags), 'proxy' FROM operation_proxy
  UNION ALL
  SELECT group_id, unnest(tags), 'resource' FROM operation_resource
  UNION ALL
  SELECT group_id, unnest(tags), 'registration' FROM registration_resource
) r
JOIN user_group ug ON ug.group_id = r.group_id
JOIN app_user a ON a.id = ug.user_id
WHERE a.role = 'administrator' AND a.provisioned_by = 'init-tool' AND length(trim(r.name)) > 0
ON CONFLICT (administrator_id, scope, kind, name) DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION validate_device_business_labels() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.remark_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM business_label l WHERE l.id = NEW.remark_id AND l.scope = 'device'
      AND l.kind = 'remark' AND (
        l.administrator_id = NEW.assignee_user_id OR (
          NEW.assignee_user_id IS NULL AND NEW.assignment_pending AND EXISTS (
            SELECT 1 FROM user_group ug
            WHERE ug.group_id = NEW.group_id AND ug.user_id = l.administrator_id
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Invalid device remark classification' USING ERRCODE = '23514';
  END IF;
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
CREATE TRIGGER device_validate_business_labels
  BEFORE INSERT OR UPDATE OF remark_id, box_group_id, assignee_user_id ON device
  FOR EACH ROW EXECUTE FUNCTION validate_device_business_labels();
