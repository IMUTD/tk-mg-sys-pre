ALTER TABLE mall_product
  ADD COLUMN inventory_group_id uuid REFERENCES access_group(id) ON DELETE SET NULL;--> statement-breakpoint

ALTER TABLE mall_resource_transfer
  ADD COLUMN reason text NOT NULL DEFAULT '';--> statement-breakpoint

ALTER TABLE mall_order
  ADD COLUMN refunded_at timestamp with time zone,
  ADD COLUMN refunded_by uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  ADD COLUMN alipay_trade_no text;--> statement-breakpoint

ALTER TABLE mall_order DROP CONSTRAINT mall_order_status_check;--> statement-breakpoint
ALTER TABLE mall_order DROP CONSTRAINT mall_order_payment_method_check;--> statement-breakpoint
ALTER TABLE mall_order DROP CONSTRAINT mall_order_shape_check;--> statement-breakpoint
ALTER TABLE mall_order DROP CONSTRAINT mall_order_shipped_check;--> statement-breakpoint

ALTER TABLE mall_order
  ADD CONSTRAINT mall_order_status_check CHECK (
    status IN ('unpaid', 'paid', 'closed', 'pending_ship', 'shipped', 'refunded', 'cancelled')
  ),
  ADD CONSTRAINT mall_order_payment_method_check CHECK (payment_method IN ('manual', 'points', 'alipay')),
  ADD CONSTRAINT mall_order_shape_check CHECK (
    (
      type = 'points'
      AND status IN ('unpaid', 'paid', 'closed')
      AND amount_cents > 0
      AND product_id IS NULL
      AND (status <> 'paid' OR paid_at IS NOT NULL)
    )
    OR (
      type = 'resource'
      AND status IN ('pending_ship', 'shipped', 'refunded', 'cancelled')
      AND amount_cents = 0
      AND product_id IS NOT NULL
      AND product_kind IN ('account', 'proxy')
      AND quantity > 0
      AND unit_points > 0
      AND points = quantity * unit_points
    )
  ),
  ADD CONSTRAINT mall_order_shipped_check CHECK (
    (status IN ('shipped', 'refunded')) = (shipped_at IS NOT NULL)
  ),
  ADD CONSTRAINT mall_order_refunded_check CHECK ((status = 'refunded') = (refunded_at IS NOT NULL));--> statement-breakpoint

CREATE UNIQUE INDEX mall_order_alipay_trade_no_unique
  ON mall_order (alipay_trade_no) WHERE alipay_trade_no IS NOT NULL;--> statement-breakpoint

CREATE TABLE mall_invoice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES access_group(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL,
  invoice_type text NOT NULL,
  title_type text NOT NULL,
  title text NOT NULL,
  tax_number text NOT NULL DEFAULT '',
  remark text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  invoice_number text NOT NULL DEFAULT '',
  reject_reason text NOT NULL DEFAULT '',
  reviewed_by uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  reviewed_at timestamp with time zone,
  idempotency_key text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT mall_invoice_amount_check CHECK (amount_cents > 0),
  CONSTRAINT mall_invoice_type_check CHECK (invoice_type IN ('normal', 'special')),
  CONSTRAINT mall_invoice_title_type_check CHECK (title_type IN ('company', 'personal')),
  CONSTRAINT mall_invoice_status_check CHECK (status IN ('pending', 'issued', 'rejected')),
  CONSTRAINT mall_invoice_tax_check CHECK (
    (title_type = 'company' AND tax_number <> '')
    OR (title_type = 'personal' AND tax_number = '' AND invoice_type = 'normal')
  ),
  CONSTRAINT mall_invoice_review_check CHECK (
    (status = 'pending' AND reviewed_at IS NULL)
    OR (status = 'issued' AND reviewed_at IS NOT NULL AND invoice_number <> '')
    OR (status = 'rejected' AND reviewed_at IS NOT NULL AND reject_reason <> '')
  ),
  CONSTRAINT mall_invoice_idempotency_unique UNIQUE (group_id, idempotency_key)
);--> statement-breakpoint

CREATE INDEX mall_invoice_group_created_index ON mall_invoice (group_id, created_at DESC, id DESC);--> statement-breakpoint
CREATE INDEX mall_invoice_status_created_index ON mall_invoice (status, created_at DESC, id DESC);--> statement-breakpoint

-- 发票文件不大，和审核结果放在同一个事务里，不引入额外的文件存储。
CREATE TABLE mall_invoice_file (
  invoice_id uuid PRIMARY KEY REFERENCES mall_invoice(id) ON DELETE RESTRICT,
  file_name text NOT NULL,
  content bytea NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT mall_invoice_file_size_check CHECK (octet_length(content) BETWEEN 1 AND 5242880)
);
