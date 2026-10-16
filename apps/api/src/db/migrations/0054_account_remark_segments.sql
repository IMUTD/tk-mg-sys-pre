CREATE OR REPLACE FUNCTION collect_account_remark_label() RETURNS trigger LANGUAGE plpgsql AS $$
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
        admin.id::text || ':account:remark:' || part, 0));
      INSERT INTO business_label (administrator_id, scope, kind, name)
      VALUES (admin.id, 'account', 'remark', part)
      ON CONFLICT (administrator_id, scope, kind, name) DO NOTHING;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
UPDATE operation_account AS acc
SET note = deduped.note
FROM (
  SELECT id, (
    SELECT coalesce(string_agg(name, chr(30) ORDER BY ord), '')
    FROM (
      SELECT btrim(part) AS name, min(ordinality) AS ord
      FROM unnest(string_to_array(btrim(coalesce(note, '')), chr(30))) WITH ORDINALITY AS item(part, ordinality)
      WHERE btrim(part) <> ''
      GROUP BY btrim(part)
    ) names
  ) AS note
  FROM operation_account
) AS deduped
WHERE acc.id = deduped.id
  AND acc.note IS DISTINCT FROM deduped.note;
--> statement-breakpoint
INSERT INTO business_label (administrator_id, scope, kind, name)
SELECT DISTINCT a.id, 'account', 'remark', btrim(part)
FROM operation_account acc
JOIN user_group ug ON ug.group_id = acc.group_id
JOIN app_user a ON a.id = ug.user_id
CROSS JOIN LATERAL unnest(string_to_array(btrim(coalesce(acc.note, '')), chr(30))) AS part
WHERE a.role = 'administrator'
  AND a.provisioned_by = 'init-tool'
  AND a.enabled
  AND btrim(part) <> ''
ON CONFLICT (administrator_id, scope, kind, name) DO NOTHING;
--> statement-breakpoint
DELETE FROM business_label
WHERE scope = 'account' AND kind = 'remark' AND position(chr(30) in name) > 0;
