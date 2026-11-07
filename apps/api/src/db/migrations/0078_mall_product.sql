CREATE TABLE mall_product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  name text NOT NULL,
  spec text NOT NULL DEFAULT '',
  price_points bigint NOT NULL,
  stock bigint NOT NULL DEFAULT 0,
  min_quantity integer NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT mall_product_kind_check CHECK (kind IN ('account', 'proxy')),
  CONSTRAINT mall_product_price_check CHECK (price_points > 0),
  CONSTRAINT mall_product_stock_check CHECK (stock >= 0),
  CONSTRAINT mall_product_min_quantity_check CHECK (min_quantity >= 1)
);

CREATE INDEX mall_product_enabled_kind_index ON mall_product (enabled, kind, created_at, id);

ALTER TABLE mall_order
  ADD COLUMN product_id uuid REFERENCES mall_product(id) ON DELETE RESTRICT,
  ADD COLUMN product_kind text,
  ADD COLUMN quantity integer,
  ADD COLUMN unit_points bigint,
  ADD COLUMN cancelled_at timestamp with time zone,
  ADD COLUMN cancelled_by uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  ADD COLUMN cancel_reason text NOT NULL DEFAULT '';

ALTER TABLE mall_order DROP CONSTRAINT mall_order_type_check;
ALTER TABLE mall_order DROP CONSTRAINT mall_order_status_check;
ALTER TABLE mall_order DROP CONSTRAINT mall_order_payment_method_check;
ALTER TABLE mall_order DROP CONSTRAINT mall_order_amount_check;

ALTER TABLE mall_order
  ADD CONSTRAINT mall_order_type_check CHECK (type IN ('points', 'resource')),
  ADD CONSTRAINT mall_order_status_check CHECK (status IN ('paid', 'pending_ship', 'shipped', 'cancelled')),
  ADD CONSTRAINT mall_order_payment_method_check CHECK (payment_method IN ('manual', 'points')),
  ADD CONSTRAINT mall_order_amount_check CHECK (amount_cents >= 0),
  ADD CONSTRAINT mall_order_shape_check CHECK (
    (type = 'points' AND status = 'paid' AND amount_cents > 0 AND product_id IS NULL)
    OR (
      type = 'resource'
      AND status IN ('pending_ship', 'shipped', 'cancelled')
      AND amount_cents = 0
      AND product_id IS NOT NULL
      AND product_kind IN ('account', 'proxy')
      AND quantity > 0
      AND unit_points > 0
      AND points = quantity * unit_points
    )
  );

CREATE INDEX mall_order_created_index ON mall_order (created_at DESC, id DESC);
CREATE INDEX mall_order_status_created_index ON mall_order (status, created_at DESC, id DESC);
