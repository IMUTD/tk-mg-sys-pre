ALTER TABLE behavior_chain DROP CONSTRAINT behavior_chain_anchor_pair_check;--> statement-breakpoint
ALTER TABLE behavior_chain
  ADD CONSTRAINT behavior_chain_anchor_pair_check
  CHECK (
    (anchor_table = '' AND anchor_key = '')
    OR (anchor_table = 'operation_account' AND anchor_key IN ('id', 'identifier'))
  );--> statement-breakpoint
COMMENT ON COLUMN behavior_chain.anchor_key IS '参数约束的定位列，编号或账号，必须和数据表成对';
