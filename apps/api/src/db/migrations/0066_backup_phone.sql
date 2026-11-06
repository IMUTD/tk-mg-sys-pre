ALTER TABLE box_share_entry
  ADD COLUMN phone_name text NOT NULL DEFAULT '';

ALTER TABLE box_share_entry
  ADD COLUMN saved_at timestamptz;

UPDATE box_share_entry
SET
  phone_name = substring(name from '^(.+)-[0-9]{10}-[A-Za-z0-9]+\.tar\.gz$'),
  saved_at = coalesce(
    mtime,
    make_timestamptz(
      substring(name from '-([0-9]{4})[0-9]{6}-')::int,
      substring(name from '-[0-9]{4}([0-9]{2})[0-9]{4}-')::int,
      substring(name from '-[0-9]{6}([0-9]{2})[0-9]{2}-')::int,
      substring(name from '-[0-9]{8}([0-9]{2})-')::int,
      0,
      0,
      'Asia/Shanghai'
    )
  )
WHERE bucket = 'backup'
  AND kind = 'file'
  AND name ~ '^(.+)-[0-9]{10}-[A-Za-z0-9]+\.tar\.gz$';

UPDATE box_share_entry
SET
  phone_name = substring(name from '^(.+)-[0-9]{10}-[A-Za-z0-9]+\.zip$'),
  saved_at = coalesce(
    mtime,
    make_timestamptz(
      substring(name from '-([0-9]{4})[0-9]{6}-')::int,
      substring(name from '-[0-9]{4}([0-9]{2})[0-9]{4}-')::int,
      substring(name from '-[0-9]{6}([0-9]{2})[0-9]{2}-')::int,
      substring(name from '-[0-9]{8}([0-9]{2})-')::int,
      0,
      0,
      'Asia/Shanghai'
    )
  )
WHERE bucket = 'backup'
  AND kind = 'file'
  AND phone_name = ''
  AND name ~ '^(.+)-[0-9]{10}-[A-Za-z0-9]+\.zip$';

CREATE INDEX box_share_entry_phone_saved
  ON box_share_entry (phone_name, saved_at DESC)
  WHERE bucket = 'backup' AND kind = 'file' AND phone_name <> '';
