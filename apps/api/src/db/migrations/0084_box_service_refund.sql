ALTER TABLE box_service_order DROP CONSTRAINT IF EXISTS box_service_order_status_check;
ALTER TABLE box_service_order ADD CONSTRAINT box_service_order_status_check CHECK (status IN ('pending', 'paid', 'closed', 'refunded'));
ALTER TABLE box_service_order ADD COLUMN IF NOT EXISTS refunded_at timestamp with time zone;
ALTER TABLE box_service_order ADD COLUMN IF NOT EXISTS refunded_by uuid REFERENCES app_user(id);
ALTER TABLE box_service_order ADD COLUMN IF NOT EXISTS refund_reason text NOT NULL DEFAULT '';
