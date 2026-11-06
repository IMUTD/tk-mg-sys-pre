DROP TABLE IF EXISTS registration_resource CASCADE;
DROP TYPE IF EXISTS registration_resource_status;
DROP TYPE IF EXISTS registration_resource_kind;
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
