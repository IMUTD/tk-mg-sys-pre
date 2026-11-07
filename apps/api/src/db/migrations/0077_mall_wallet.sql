CREATE TABLE mall_wallet (
  group_id uuid PRIMARY KEY REFERENCES access_group(id) ON DELETE RESTRICT,
  balance bigint NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT mall_wallet_balance_check CHECK (balance >= 0)
);

CREATE TABLE mall_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no text NOT NULL UNIQUE,
  group_id uuid NOT NULL REFERENCES access_group(id) ON DELETE RESTRICT,
  type text NOT NULL,
  status text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  product text NOT NULL,
  amount_cents bigint NOT NULL,
  points bigint NOT NULL,
  payment_method text NOT NULL,
  remark text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  paid_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT mall_order_type_check CHECK (type IN ('points')),
  CONSTRAINT mall_order_status_check CHECK (status IN ('paid')),
  CONSTRAINT mall_order_payment_method_check CHECK (payment_method IN ('manual')),
  CONSTRAINT mall_order_amount_check CHECK (amount_cents > 0),
  CONSTRAINT mall_order_points_check CHECK (points > 0),
  CONSTRAINT mall_order_idempotency_unique UNIQUE (group_id, idempotency_key)
);

CREATE INDEX mall_order_group_created_index ON mall_order (group_id, created_at DESC, id DESC);

CREATE TABLE mall_point_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES access_group(id) ON DELETE RESTRICT,
  type text NOT NULL,
  delta bigint NOT NULL,
  balance_after bigint NOT NULL,
  order_id uuid REFERENCES mall_order(id) ON DELETE RESTRICT,
  remark text NOT NULL DEFAULT '',
  actor_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT mall_point_ledger_type_check CHECK (type IN ('recharge', 'spend', 'refund', 'adjust')),
  CONSTRAINT mall_point_ledger_delta_check CHECK (delta <> 0),
  CONSTRAINT mall_point_ledger_balance_check CHECK (balance_after >= 0),
  CONSTRAINT mall_point_ledger_idempotency_unique UNIQUE (group_id, idempotency_key)
);

CREATE INDEX mall_point_ledger_group_created_index ON mall_point_ledger (group_id, created_at DESC, id DESC);
CREATE INDEX mall_point_ledger_created_index ON mall_point_ledger (created_at DESC, id DESC);
