ALTER TABLE device ADD COLUMN IF NOT EXISTS service_until timestamp with time zone;

CREATE TABLE IF NOT EXISTS box_service_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  out_trade_no text NOT NULL UNIQUE,
  external_id text NOT NULL,
  buyer_user_id uuid NOT NULL REFERENCES app_user(id),
  months integer NOT NULL,
  amount text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  alipay_trade_no text NOT NULL DEFAULT '',
  paid_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT box_service_order_months_check CHECK (months IN (1, 3, 6, 12)),
  CONSTRAINT box_service_order_status_check CHECK (status IN ('pending', 'paid', 'closed'))
);

CREATE INDEX IF NOT EXISTS box_service_order_buyer_index ON box_service_order (buyer_user_id, created_at);
