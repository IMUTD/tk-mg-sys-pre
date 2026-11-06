ALTER TABLE operation_dispatch_item
  ALTER COLUMN account_id DROP NOT NULL;--> statement-breakpoint
ALTER TABLE operation_dispatch_item
  ADD CONSTRAINT operation_dispatch_item_target_check
  CHECK (
    account_id IS NOT NULL
    OR (device_id IS NOT NULL AND instance_index IS NOT NULL)
  );
