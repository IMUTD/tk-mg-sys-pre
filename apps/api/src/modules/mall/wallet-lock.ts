import { randomBytes } from "node:crypto"
import type { TransactionSql } from "postgres"

import { MallError } from "./model"

/** 系统预置的“未分配”分组不属于任何租户，不能持有积分。 */
export const UNASSIGNED_GROUP_ID = "00000000-0000-4000-8000-000000000001"

export const createOrderNo = (prefix: "A" | "M" | "P"): string => {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "")
  return `${prefix}${day}${randomBytes(5).toString("hex").toUpperCase()}`
}

/**
 * 锁住钱包行，让同一分组的入账串行执行；幂等检查也必须在这把锁之后做。
 * 所有写操作都按“钱包 → 订单 → 商品”的顺序加锁，避免购买和取消互相死锁。
 */
export const lockWallet = async (transaction: TransactionSql, groupId: string): Promise<number> => {
  const groups = await transaction`
    select id from access_group where id = ${groupId} and id <> ${UNASSIGNED_GROUP_ID}
  `
  if (groups[0] === undefined) throw new MallError("group_not_found")
  await transaction`insert into mall_wallet (group_id) values (${groupId}) on conflict do nothing`
  const rows = await transaction<{ readonly balance: string }[]>`
    select balance from mall_wallet where group_id = ${groupId} for update
  `
  return Number(rows[0]?.balance ?? 0)
}

export const applyDelta = async (
  transaction: TransactionSql,
  groupId: string,
  balance: number,
  delta: number,
): Promise<number> => {
  const next = balance + delta
  if (next < 0) throw new MallError("insufficient_balance")
  await transaction`
    update mall_wallet set balance = ${next}, updated_at = now() where group_id = ${groupId}
  `
  return next
}
