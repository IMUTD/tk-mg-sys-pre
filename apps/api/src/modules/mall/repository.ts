import { randomBytes } from "node:crypto"
import type { Sql, TransactionSql } from "postgres"

import {
  type AdjustInput,
  type AdjustResult,
  type GroupWallet,
  type LedgerEntry,
  type LedgerFilter,
  MallError,
  type MallOrder,
  type OrderFilter,
  type Page,
  POINTS_PER_YUAN,
  type PointType,
  type RechargeInput,
  type RechargeResult,
  type WalletFilter,
  yuanToCents,
} from "./model"

export type MallRepository = {
  adjust(actorId: string, input: AdjustInput): Promise<AdjustResult>
  listAllWallets(filter: WalletFilter): Promise<Page<GroupWallet>>
  listLedger(filter: LedgerFilter): Promise<Page<LedgerEntry>>
  listOrders(filter: OrderFilter): Promise<Page<MallOrder>>
  listWallets(groupIds: readonly string[]): Promise<readonly GroupWallet[]>
  recharge(actorId: string, input: RechargeInput): Promise<RechargeResult>
}

type WalletRow = {
  readonly balance: string
  readonly groupId: string
  readonly name: string
}

type LedgerRow = {
  readonly actorName: string
  readonly balance: string
  readonly createdAt: Date
  readonly delta: string
  readonly groupId: string
  readonly groupName: string
  readonly id: string
  readonly orderNo: string | null
  readonly remark: string
  readonly type: PointType
}

type OrderRow = {
  readonly amountCents: string
  readonly createdAt: Date
  readonly description: string
  readonly id: string
  readonly orderNo: string
  readonly paidAt: Date | null
  readonly points: string
  readonly product: string
  readonly status: "paid"
  readonly title: string
  readonly type: "points"
}

type ReplayRow = {
  readonly amountCents: string | null
  readonly balance: string
  readonly delta: string
  readonly orderNo: string | null
  readonly type: PointType
}

/** 系统预置的“未分配”分组不属于任何租户，不能持有积分。 */
const UNASSIGNED_GROUP_ID = "00000000-0000-4000-8000-000000000001"

const likePattern = (value: string): string => `%${value.replace(/[\\%_]/g, "\\$&")}%`

const toWallet = (row: WalletRow): GroupWallet => ({
  balance: Number(row.balance),
  groupId: row.groupId,
  name: row.name,
})

const toLedgerEntry = (row: LedgerRow): LedgerEntry => ({
  actorName: row.actorName,
  balance: Number(row.balance),
  createdAt: row.createdAt.toISOString(),
  delta: Number(row.delta),
  groupId: row.groupId,
  groupName: row.groupName,
  id: row.id,
  orderNo: row.orderNo ?? "",
  remark: row.remark,
  type: row.type,
})

const toOrder = (row: OrderRow): MallOrder => ({
  amountCents: Number(row.amountCents),
  createdAt: row.createdAt.toISOString(),
  description: row.description,
  id: row.id,
  orderNo: row.orderNo,
  paidAt: row.paidAt?.toISOString() ?? null,
  points: Number(row.points),
  product: row.product,
  status: row.status,
  title: row.title,
  type: row.type,
})

const createOrderNo = (): string => {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "")
  return `P${day}${randomBytes(5).toString("hex").toUpperCase()}`
}

/** 锁住钱包行，让同一分组的入账串行执行；幂等检查也必须在这把锁之后做。 */
const lockWallet = async (transaction: TransactionSql, groupId: string): Promise<number> => {
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

const findReplay = async (
  transaction: TransactionSql,
  groupId: string,
  idempotencyKey: string,
): Promise<ReplayRow | undefined> => {
  const rows = await transaction<ReplayRow[]>`
    select l.type, l.delta, l.balance_after as balance, o.order_no as "orderNo",
      o.amount_cents as "amountCents"
    from mall_point_ledger l
    left join mall_order o on o.id = l.order_id
    where l.group_id = ${groupId} and l.idempotency_key = ${idempotencyKey}
  `
  return rows[0]
}

const applyDelta = async (
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

export const createPostgresMallRepository = (client: Sql): MallRepository => ({
  adjust: (actorId, input) =>
    client.begin(async (transaction) => {
      const balance = await lockWallet(transaction, input.groupId)
      const replay = await findReplay(transaction, input.groupId, input.idempotencyKey)
      if (replay !== undefined) {
        if (replay.type !== "adjust" || Number(replay.delta) !== input.delta) {
          throw new MallError("idempotency_conflict")
        }
        return { balance: Number(replay.balance), delta: input.delta, replayed: true }
      }
      const next = await applyDelta(transaction, input.groupId, balance, input.delta)
      await transaction`
        insert into mall_point_ledger
          (group_id, type, delta, balance_after, remark, actor_user_id, idempotency_key)
        values
          (${input.groupId}, 'adjust', ${input.delta}, ${next}, ${input.remark}, ${actorId},
           ${input.idempotencyKey})
      `
      return { balance: next, delta: input.delta, replayed: false }
    }),
  listAllWallets: async (filter) => {
    const conditions = client`
      where g.id <> ${UNASSIGNED_GROUP_ID}
      ${
        filter.keyword === undefined || filter.keyword.length === 0
          ? client``
          : client`and g.name ilike ${likePattern(filter.keyword)}`
      }
    `
    const [rows, totals] = await Promise.all([
      client<WalletRow[]>`
        select g.id as "groupId", g.name, coalesce(w.balance, 0) as balance
        from access_group g
        left join mall_wallet w on w.group_id = g.id
        ${conditions}
        order by g.name, g.id
        limit ${filter.pageSize} offset ${(filter.page - 1) * filter.pageSize}
      `,
      client<{ readonly total: string }[]>`
        select count(*) as total from access_group g ${conditions}
      `,
    ])
    return { items: rows.map(toWallet), total: Number(totals[0]?.total ?? 0) }
  },
  listLedger: async (filter) => {
    const conditions = client`
      where true
      ${filter.groupId === undefined ? client`` : client`and l.group_id = ${filter.groupId}`}
      ${filter.type === undefined ? client`` : client`and l.type = ${filter.type}`}
      ${
        filter.keyword === undefined || filter.keyword.length === 0
          ? client``
          : client`and l.remark ilike ${likePattern(filter.keyword)}`
      }
    `
    const [rows, totals] = await Promise.all([
      client<LedgerRow[]>`
        select l.id, l.group_id as "groupId", g.name as "groupName", l.type, l.delta,
          l.balance_after as balance, l.remark, l.created_at as "createdAt",
          o.order_no as "orderNo",
          coalesce(nullif(u.display_name, ''), u.email) as "actorName"
        from mall_point_ledger l
        join access_group g on g.id = l.group_id
        join app_user u on u.id = l.actor_user_id
        left join mall_order o on o.id = l.order_id
        ${conditions}
        order by l.created_at desc, l.id desc
        limit ${filter.pageSize} offset ${(filter.page - 1) * filter.pageSize}
      `,
      client<{ readonly total: string }[]>`
        select count(*) as total from mall_point_ledger l ${conditions}
      `,
    ])
    return { items: rows.map(toLedgerEntry), total: Number(totals[0]?.total ?? 0) }
  },
  listOrders: async (filter) => {
    const conditions = client`
      where o.group_id = ${filter.groupId}
      ${filter.type === undefined ? client`` : client`and o.type = ${filter.type}`}
      ${filter.status === undefined ? client`` : client`and o.status = ${filter.status}`}
      ${
        filter.keyword === undefined || filter.keyword.length === 0
          ? client``
          : client`and (
              o.order_no ilike ${likePattern(filter.keyword)}
              or o.product ilike ${likePattern(filter.keyword)}
              or o.title ilike ${likePattern(filter.keyword)}
              or o.description ilike ${likePattern(filter.keyword)}
            )`
      }
    `
    const [rows, totals] = await Promise.all([
      client<OrderRow[]>`
        select o.id, o.order_no as "orderNo", o.type, o.status, o.title, o.description, o.product,
          o.amount_cents as "amountCents", o.points, o.paid_at as "paidAt",
          o.created_at as "createdAt"
        from mall_order o
        ${conditions}
        order by o.created_at desc, o.id desc
        limit ${filter.pageSize} offset ${(filter.page - 1) * filter.pageSize}
      `,
      client<{ readonly total: string }[]>`
        select count(*) as total from mall_order o ${conditions}
      `,
    ])
    return { items: rows.map(toOrder), total: Number(totals[0]?.total ?? 0) }
  },
  listWallets: async (groupIds) => {
    if (groupIds.length === 0) return []
    const rows = await client<WalletRow[]>`
      select g.id as "groupId", g.name, coalesce(w.balance, 0) as balance
      from access_group g
      left join mall_wallet w on w.group_id = g.id
      where g.id = any(${[...groupIds]}::uuid[]) and g.id <> ${UNASSIGNED_GROUP_ID}
      order by g.name, g.id
    `
    return rows.map(toWallet)
  },
  recharge: (actorId, input) =>
    client.begin(async (transaction) => {
      const amountCents = yuanToCents(input.amountYuan)
      const points = (amountCents * POINTS_PER_YUAN) / 100
      const balance = await lockWallet(transaction, input.groupId)
      const replay = await findReplay(transaction, input.groupId, input.idempotencyKey)
      if (replay !== undefined) {
        if (replay.type !== "recharge" || Number(replay.amountCents) !== amountCents) {
          throw new MallError("idempotency_conflict")
        }
        return {
          balance: Number(replay.balance),
          orderNo: replay.orderNo ?? "",
          points,
          replayed: true,
        }
      }
      const orderNo = createOrderNo()
      const product = `积分充值 ${points.toLocaleString("zh-CN")}`
      const orders = await transaction<{ readonly id: string }[]>`
        insert into mall_order
          (order_no, group_id, type, status, title, description, product, amount_cents, points,
           payment_method, remark, created_by, idempotency_key, paid_at)
        values
          (${orderNo}, ${input.groupId}, 'points', 'paid', '积分充值', '平台人工充值', ${product},
           ${amountCents}, ${points}, 'manual', ${input.remark}, ${actorId},
           ${input.idempotencyKey}, now())
        returning id
      `
      const next = await applyDelta(transaction, input.groupId, balance, points)
      await transaction`
        insert into mall_point_ledger
          (group_id, type, delta, balance_after, order_id, remark, actor_user_id, idempotency_key)
        values
          (${input.groupId}, 'recharge', ${points}, ${next}, ${orders[0]?.id ?? null},
           ${input.remark}, ${actorId}, ${input.idempotencyKey})
      `
      return { balance: next, orderNo, points, replayed: false }
    }),
})
