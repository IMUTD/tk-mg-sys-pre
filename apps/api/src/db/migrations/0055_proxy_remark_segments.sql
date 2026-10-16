CREATE OR REPLACE FUNCTION collect_proxy_remark_label() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  admin record;
  trimmed text;
  part text;
BEGIN
  trimmed := btrim(coalesce(NEW.note, ''));
  IF trimmed = '' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND btrim(coalesce(OLD.note, '')) = trimmed AND OLD.group_id = NEW.group_id THEN
    RETURN NEW;
  END IF;
  FOREACH part IN ARRAY string_to_array(trimmed, chr(30))
  LOOP
    part := btrim(part);
    IF part = '' THEN
      CONTINUE;
    END IF;
    FOR admin IN
      SELECT a.id
      FROM app_user a
      JOIN user_group ug ON ug.user_id = a.id
      WHERE ug.group_id = NEW.group_id
        AND a.role = 'administrator'
        AND a.provisioned_by = 'init-tool'
        AND a.enabled
      ORDER BY a.id
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(
        admin.id::text || ':proxy:remark:' || part, 0));
      INSERT INTO business_label (administrator_id, scope, kind, name)
      VALUES (admin.id, 'proxy', 'remark', part)
      ON CONFLICT (administrator_id, scope, kind, name) DO NOTHING;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS operation_proxy_collect_remark_label ON operation_proxy;
CREATE TRIGGER operation_proxy_collect_remark_label
  AFTER INSERT OR UPDATE OF note, group_id ON operation_proxy
  FOR EACH ROW EXECUTE FUNCTION collect_proxy_remark_label();
--> statement-breakpoint
INSERT INTO business_label (administrator_id, scope, kind, name)
SELECT DISTINCT a.id, 'proxy', 'remark', btrim(part)
FROM operation_proxy proxy
JOIN user_group ug ON ug.group_id = proxy.group_id
JOIN app_user a ON a.id = ug.user_id
CROSS JOIN LATERAL unnest(string_to_array(btrim(coalesce(proxy.note, '')), chr(30))) AS part
WHERE a.role = 'administrator'
  AND a.provisioned_by = 'init-tool'
  AND a.enabled
  AND btrim(part) <> ''
ON CONFLICT (administrator_id, scope, kind, name) DO NOTHING;
