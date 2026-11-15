-- Whether the box was gone when the payment landed, so the time could not be added.
-- Recorded at payment time; earlier orders fall back to whether the box is gone now.
ALTER TABLE box_service_order ADD COLUMN IF NOT EXISTS device_missing boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE box_service_order o
SET device_missing = true
WHERE o.status = 'paid'
  AND NOT EXISTS (SELECT 1 FROM device d WHERE d.external_id = o.external_id);
