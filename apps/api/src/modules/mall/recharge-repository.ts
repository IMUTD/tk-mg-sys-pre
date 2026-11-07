import type { Sql } from "postgres"

import { MallError, POINTS_PER_YUAN, type RechargeOrder, yuanToCents } from "./model"
import { applyDelta, createOrderNo, lockWallet } from "./wallet-lock"

export type SettleResult =
  | {
      readonly actorId: string
      readonly groupId: string
      readonly orderId: string
      readonly points: number
      readonly result: "granted"
    }
  | { readonly result: "already" | "mismatch" | "missing" }

export type StaleRecharge = {
  readonly ageMinutes: number
  readonly orderNo: string
  readonly status: "closed" | "unpaid"
}

/** 关单后买家还可能付款，继续查两天再放弃。 */
const CLOSED_RECHECK_HOURS = 48

export type RechargeRepository = {
  closeRecharge(orderNo: string): Promise<void>
  createRecharge(
    actorId: string,
    groupId: string,
    input: { readonly amountYuan: string; readonly idempotencyKey: string },
  ): Promise<RechargeOrder & { readonly replayed: boolean }>
  findRecharge(groupId: string, orderNo: string): Promise<RechargeOrder>
  settleRecharge(orderNo: string, tradeNo: string, amountYuan: string): Promise<SettleResult>
  staleRecharges(olderThanMinutes: number): Promise<readonly StaleRecharge[]>
}

type RechargeRow = {
  readonly amountCents: string
  readonly orderNo: string
  readonly points: string
  readonly status: RechargeOrder["status"]
}

const toRecharge = (row: RechargeRow): RechargeOrder => ({
  amountCents: Number(row.amountCents),
  orderNo: row.orderNo,
  points: Number(row.points),
  status: row.status,
})

/** 回调里的金额是 "100.00"，这里按分比较。格式不对就当金额不一致，不入账。 */
const parseAlipayAmount = (value: string): number | null =>
  /^\d{1,10}(\.\d{1,2})?$/.test(value) ? yuanToCents(value) : null

export const createPostgresRechargeRepository = (client: Sql): RechargeRepository => ({
  closeRecharge: async (orderNo) => {
    await client`
      update mall_order set status = 'closed'
      where order_no = ${orderNo} and payment_method = 'alipay' and status = 'unpaid'
    `
  },
  createRecharge: (actorId, groupId, input) =>
    client.begin(async (transaction) => {
      const amountCents = yuanToCents(input.amountYuan)
      const points = (amountCents * POINTS_PER_YUAN) / 100
      await lockWallet(transaction, groupId)
      const existing = await transaction<RechargeRow[]>`
        select order_no as "orderNo", amount_cents as "amountCents", points, status
        from mall_order
        where group_id = ${groupId} and idempotency_key = ${input.idempotencyKey}
      `
      const replay = existing[0]
      if (replay !== undefined) {
        if (Number(replay.amountCents) !== amountCents) throw new MallError("idempotency_conflict")
        return { ...toRecharge(replay), replayed: true }
      }
      const orderNo = createOrderNo("A")
      await transaction`
        insert into mall_order
          (order_no, group_id, type, status, title, description, product, amount_cents, points,
           payment_method, created_by, idempotency_key)
        values
          (${orderNo}, ${groupId}, 'points', 'unpaid', '积分充值', '支付宝充值',
           ${`积分充值 ${points.toLocaleString("zh-CN")}`}, ${amountCents}, ${points}, 'alipay',
           ${actorId}, ${input.idempotencyKey})
      `
      return { amountCents, orderNo, points, replayed: false, status: "unpaid" as const }
    }),
  findRecharge: async (groupId, orderNo) => {
    const rows = await client<RechargeRow[]>`
      select order_no as "orderNo", amount_cents as "amountCents", points, status
      from mall_order
      where group_id = ${groupId} and order_no = ${orderNo} and payment_method = 'alipay'
    `
    const row = rows[0]
    if (row === undefined) throw new MallError("order_not_found")
    return toRecharge(row)
  },
  settleRecharge: (orderNo, tradeNo, amountYuan) =>
    client.begin(async (transaction): Promise<SettleResult> => {
      const owners = await transaction<{ readonly groupId: string }[]>`
        select group_id as "groupId" from mall_order
        where order_no = ${orderNo} and payment_method = 'alipay'
      `
      const groupId = owners[0]?.groupId
      if (groupId === undefined) return { result: "missing" }
      const balance = await lockWallet(transaction, groupId)
      const rows = await transaction<
        {
          readonly actorId: string
          readonly amountCents: string
          readonly id: string
          readonly points: string
          readonly status: RechargeOrder["status"]
        }[]
      >`
        select id, amount_cents as "amountCents", points, status, created_by as "actorId"
        from mall_order where order_no = ${orderNo} for update
      `
      const order = rows[0]
      if (order === undefined) return { result: "missing" }
      if (order.status === "paid") return { result: "already" }
      if (parseAlipayAmount(amountYuan) !== Number(order.amountCents)) {
        return { result: "mismatch" }
      }
      const points = Number(order.points)
      // 本地已关单也要入账：支付宝确认收款，钱已经到了。
      await transaction`
        update mall_order
        set status = 'paid', paid_at = now(), alipay_trade_no = ${tradeNo}
        where id = ${order.id}
      `
      const next = await applyDelta(transaction, groupId, balance, points)
      await transaction`
        insert into mall_point_ledger
          (group_id, type, delta, balance_after, order_id, remark, actor_user_id, idempotency_key)
        values
          (${groupId}, 'recharge', ${points}, ${next}, ${order.id}, ${`支付宝充值 ${tradeNo}`},
           ${order.actorId}, ${`alipay:${orderNo}`})
      `
      return { actorId: order.actorId, groupId, orderId: order.id, points, result: "granted" }
    }),
  staleRecharges: async (olderThanMinutes) => {
    const rows = await client<
      {
        readonly ageMinutes: string
        readonly orderNo: string
        readonly status: "closed" | "unpaid"
      }[]
    >`
      select order_no as "orderNo", status,
        floor(extract(epoch from now() - created_at) / 60) as "ageMinutes"
      from mall_order
      where payment_method = 'alipay'
        and created_at < now() - make_interval(mins => ${olderThanMinutes})
        and (
          status = 'unpaid'
          or (status = 'closed' and created_at > now() - make_interval(hours => ${CLOSED_RECHECK_HOURS}))
        )
      order by created_at
      limit 100
    `
    return rows.map((row) => ({ ...row, ageMinutes: Number(row.ageMinutes) }))
  },
})
