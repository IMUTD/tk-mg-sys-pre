CREATE OR REPLACE FUNCTION collect_account_remark_label() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  admin record;
  trimmed text;
BEGIN
  trimmed := btrim(coalesce(NEW.note, ''));
  IF trimmed = '' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND btrim(coalesce(OLD.note, '')) = trimmed AND OLD.group_id = NEW.group_id THEN
    RETURN NEW;
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
      admin.id::text || ':account:remark:' || trimmed, 0));
    INSERT INTO business_label (administrator_id, scope, kind, name)
    VALUES (admin.id, 'account', 'remark', trimmed)
    ON CONFLICT (administrator_id, scope, kind, name) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS operation_account_collect_remark ON operation_account;
--> statement-breakpoint
CREATE TRIGGER operation_account_collect_remark
  AFTER INSERT OR UPDATE OF note, group_id ON operation_account
  FOR EACH ROW EXECUTE FUNCTION collect_account_remark_label();
--> statement-breakpoint
INSERT INTO business_label (administrator_id, scope, kind, name)
SELECT DISTINCT a.id, 'account', 'remark', btrim(acc.note)
FROM operation_account acc
JOIN user_group ug ON ug.group_id = acc.group_id
JOIN app_user a ON a.id = ug.user_id
WHERE a.role = 'administrator'
  AND a.provisioned_by = 'init-tool'
  AND a.enabled
  AND btrim(acc.note) <> ''
ON CONFLICT (administrator_id, scope, kind, name) DO NOTHING;
