CREATE TABLE business_label (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  administrator_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('remark', 'group')),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_label_admin_kind_name_unique UNIQUE (administrator_id, kind, name)
);
--> statement-breakpoint
INSERT INTO business_label (id, administrator_id, kind, name, created_at)
SELECT id, administrator_id, 'remark', name, created_at FROM box_remark
UNION ALL
SELECT id, administrator_id, 'group', name, created_at FROM box_group;
--> statement-breakpoint
ALTER TABLE device DROP CONSTRAINT device_remark_id_box_remark_id_fk;
ALTER TABLE device DROP CONSTRAINT device_box_group_id_box_group_id_fk;
ALTER TABLE device ADD CONSTRAINT device_remark_id_business_label_id_fk
  FOREIGN KEY (remark_id) REFERENCES business_label(id) ON DELETE SET NULL;
ALTER TABLE device ADD CONSTRAINT device_box_group_id_business_label_id_fk
  FOREIGN KEY (box_group_id) REFERENCES business_label(id) ON DELETE SET NULL;
--> statement-breakpoint
DROP TABLE box_remark;
DROP TABLE box_group;
CREATE VIEW box_remark AS SELECT id, administrator_id, name, created_at
  FROM business_label WHERE kind = 'remark';
CREATE VIEW box_group AS SELECT id, administrator_id, name, created_at
  FROM business_label WHERE kind = 'group';
--> statement-breakpoint
CREATE FUNCTION collect_business_labels() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  label record;
BEGIN
  FOR label IN
    SELECT DISTINCT a.id AS administrator_id, tag.name
    FROM app_user a JOIN user_group ug ON ug.user_id = a.id
    CROSS JOIN unnest(NEW.tags) AS tag(name)
    WHERE ug.group_id = NEW.group_id AND a.role = 'administrator'
      AND a.provisioned_by = 'init-tool' AND a.enabled AND length(trim(tag.name)) > 0
    ORDER BY a.id, tag.name
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(label.administrator_id::text || ':group:' || label.name, 0));
    INSERT INTO business_label (administrator_id, kind, name)
    VALUES (label.administrator_id, 'group', label.name)
    ON CONFLICT (administrator_id, kind, name) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER operation_account_collect_labels AFTER INSERT OR UPDATE OF tags, group_id
  ON operation_account FOR EACH ROW EXECUTE FUNCTION collect_business_labels();
CREATE TRIGGER operation_proxy_collect_labels AFTER INSERT OR UPDATE OF tags, group_id
  ON operation_proxy FOR EACH ROW EXECUTE FUNCTION collect_business_labels();
CREATE TRIGGER operation_resource_collect_labels AFTER INSERT OR UPDATE OF tags, group_id
  ON operation_resource FOR EACH ROW EXECUTE FUNCTION collect_business_labels();
CREATE TRIGGER registration_resource_collect_labels AFTER INSERT OR UPDATE OF tags, group_id
  ON registration_resource FOR EACH ROW EXECUTE FUNCTION collect_business_labels();
--> statement-breakpoint
INSERT INTO business_label (administrator_id, kind, name)
SELECT DISTINCT a.id, 'group', tag.name
FROM (
  SELECT group_id, tags FROM operation_account UNION ALL
  SELECT group_id, tags FROM operation_proxy UNION ALL
  SELECT group_id, tags FROM operation_resource UNION ALL
  SELECT group_id, tags FROM registration_resource
) r
JOIN user_group ug ON ug.group_id = r.group_id
JOIN app_user a ON a.id = ug.user_id
CROSS JOIN unnest(r.tags) AS tag(name)
WHERE a.role = 'administrator' AND a.provisioned_by = 'init-tool'
  AND a.enabled AND length(trim(tag.name)) > 0
ON CONFLICT (administrator_id, kind, name) DO NOTHING;
