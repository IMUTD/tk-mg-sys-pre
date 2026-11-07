import { randomBytes } from "node:crypto"
import type { Sql, TransactionSql } from "postgres"

import {
  type AdjustInput,
  type AdjustResult,
  type CancelOrderResult,
  type GroupWallet,
  type LedgerEntry,
  type LedgerFilter,
  MallError,
  type MallOrder,
  type MallProduct,
  type OrderFilter,
  type Page,
  POINTS_PER_YUAN,
  type PointType,
  type ProductCreateInput,
  type ProductFilter,
  type ProductKind,
  type ProductUpdateInput,
  type PurchaseInput,
  type PurchaseResult,
  type RechargeInput,
  type RechargeResult,
  type WalletFilter,
  yuanToCents,
} from "./model"

export type MallRepository = {
  adjust(actorId: string, input: AdjustInput): Promise<AdjustResult>
  cancelOrder(actorId: string, orderId: string, reason: string): Promise<CancelOrderResult>
  createProduct(actorId: string, input: ProductCreateInput): Promise<MallProduct>
  listAllWallets(filter: WalletFilter): Promise<Page<GroupWallet>>
  listLedger(filter: LedgerFilter): Promise<Page<LedgerEntry>>
  listOrders(filter: OrderFilter): Promise<Page<MallOrder>>
  listProducts(filter: ProductFilter): Promise<Page<MallProduct>>
  listWallets(groupIds: readonly string[]): Promise<readonly GroupWallet[]>
  purchase(actorId: string, groupId: string, input: PurchaseInput): Promise<PurchaseResult>
  recharge(actorId: string, input: RechargeInput): Promise<RechargeResult>
  updateProduct(productId: string, input: ProductUpdateInput): Promise<MallProduct>
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
  readonly buyerName: string
  readonly cancelReason: string
  readonly cancelledAt: Date | null
  readonly createdAt: Date
  readonly description: string
  readonly groupId: string
  readonly groupName: string
  readonly id: string
  readonly orderNo: string
  readonly paidAt: Date | null
  readonly points: string
  readonly product: string
  readonly productKind: ProductKind | null
  readonly quantity: number | null
  readonly status: MallOrder["status"]
  readonly title: string
  readonly type: MallOrder["type"]
  readonly unitPoints: string | null
}

type ProductRow = {
  readonly createdAt: Date
  readonly enabled: boolean
  readonly id: string
  readonly kind: ProductKind
  readonly minQuantity: number
  readonly name: string
  readonly pricePoints: string
  readonly spec: string
  readonly stock: string
  readonly updatedAt: Date
}

type ReplayRow = {
  readonly amountCents: string | null
  readonly balance: string
  readonly delta: string
  readonly orderId: string | null
  readonly orderNo: string | null
  readonly productId: string | null
  readonly quantity: number | null
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
  buyerName: row.buyerName,
  cancelReason: row.cancelReason,
  cancelledAt: row.cancelledAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  description: row.description,
  groupId: row.groupId,
  groupName: row.groupName,
  id: row.id,
  orderNo: row.orderNo,
  paidAt: row.paidAt?.toISOString() ?? null,
  points: Number(row.points),
  product: row.product,
  productKind: row.productKind,
  quantity: row.quantity,
  status: row.status,
  title: row.title,
  type: row.type,
  unitPoints: row.unitPoints === null ? null : Number(row.unitPoints),
})

const toProduct = (row: ProductRow): MallProduct => ({
  createdAt: row.createdAt.toISOString(),
  enabled: row.enabled,
  id: row.id,
  kind: row.kind,
  minQuantity: row.minQuantity,
  name: row.name,
  pricePoints: Number(row.pricePoints),
  spec: row.spec,
  stock: Number(row.stock),
  updatedAt: row.updatedAt.toISOString(),
})

const PRODUCT_COLUMNS = (client: Sql) => client`
  id, kind, name, spec, price_points as "pricePoints", stock, min_quantity as "minQuantity",
  enabled, created_at as "createdAt", updated_at as "updatedAt"
`

const createOrderNo = (prefix: "M" | "P"): string => {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "")
  return `${prefix}${day}${randomBytes(5).toString("hex").toUpperCase()}`
}

/**
 * 锁住钱包行，让同一分组的入账串行执行；幂等检查也必须在这把锁之后做。
 * 所有写操作都按“钱包 → 订单 → 商品”的顺序加锁，避免购买和取消互相死锁。
 */
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
    select l.type, l.delta, l.balance_after as balance, l.order_id as "orderId",
      o.order_no as "orderNo", o.amount_cents as "amountCents", o.product_id as "productId",
      o.quantity
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
  cancelOrder: (actorId, orderId, reason) =>
    client.begin(async (transaction) => {
      const owners = await transaction<{ readonly groupId: string }[]>`
        select group_id as "groupId" from mall_order where id = ${orderId}
      `
      const groupId = owners[0]?.groupId
      if (groupId === undefined) throw new MallError("order_not_found")
      const balance = await lockWallet(transaction, groupId)
      const orders = await transaction<
        {
          readonly orderNo: string
          readonly points: string
          readonly productId: string | null
          readonly quantity: number | null
          readonly status: MallOrder["status"]
          readonly type: MallOrder["type"]
        }[]
      >`
        select order_no as "orderNo", points, product_id as "productId", quantity, status, type
        from mall_order where id = ${orderId} for update
      `
      const order = orders[0]
      if (order === undefined) throw new MallError("order_not_found")
      const points = Number(order.points)
      if (order.status === "cancelled") {
        return { balance, groupId, orderNo: order.orderNo, points, replayed: true }
      }
      if (order.type !== "resource" || order.status !== "pending_ship") {
        throw new MallError("order_not_cancellable")
      }
      await transaction`
        update mall_order
        set status = 'cancelled', cancelled_at = now(), cancelled_by = ${actorId},
            cancel_reason = ${reason}
        where id = ${orderId}
      `
      await transaction`
        update mall_product
        set stock = stock + ${order.quantity ?? 0}, updated_at = now()
        where id = ${order.productId}
      `
      const next = await applyDelta(transaction, groupId, balance, points)
      await transaction`
        insert into mall_point_ledger
          (group_id, type, delta, balance_after, order_id, remark, actor_user_id, idempotency_key)
        values
          (${groupId}, 'refund', ${points}, ${next}, ${orderId}, ${`订单取消退回：${reason}`},
           ${actorId}, ${`refund:${orderId}`})
      `
      return { balance: next, groupId, orderNo: order.orderNo, points, replayed: false }
    }),
  createProduct: async (actorId, input) => {
    const rows = await client<ProductRow[]>`
      insert into mall_product
        (kind, name, spec, price_points, stock, min_quantity, enabled, created_by)
      values
        (${input.kind}, ${input.name}, ${input.spec}, ${input.pricePoints}, ${input.stock},
         ${input.minQuantity}, ${input.enabled}, ${actorId})
      returning ${PRODUCT_COLUMNS(client)}
    `
    const row = rows[0]
    if (row === undefined) throw new MallError("product_not_found")
    return toProduct(row)
  },
  purchase: (actorId, groupId, input) =>
    client.begin(async (transaction) => {
      const balance = await lockWallet(transaction, groupId)
      const replay = await findReplay(transaction, groupId, input.idempotencyKey)
      if (replay !== undefined) {
        if (
          replay.type !== "spend" ||
          replay.productId !== input.productId ||
          replay.quantity !== input.quantity
        ) {
          throw new MallError("idempotency_conflict")
        }
        return {
          balance: Number(replay.balance),
          orderId: replay.orderId ?? "",
          orderNo: replay.orderNo ?? "",
          points: -Number(replay.delta),
          replayed: true,
        }
      }
      const products = await transaction<ProductRow[]>`
        select ${PRODUCT_COLUMNS(client)} from mall_product
        where id = ${input.productId} for update
      `
      const product = products[0]
      if (product === undefined) throw new MallError("product_not_found")
      if (!product.enabled) throw new MallError("product_unavailable")
      const unitPoints = Number(product.pricePoints)
      if (unitPoints !== input.expectedUnitPoints) throw new MallError("price_changed")
      if (input.quantity < product.minQuantity) throw new MallError("invalid_quantity")
      if (Number(product.stock) < input.quantity) throw new MallError("insufficient_stock")
      const points = unitPoints * input.quantity
      const next = await applyDelta(transaction, groupId, balance, -points)
      await transaction`
        update mall_product
        set stock = stock - ${input.quantity}, updated_at = now()
        where id = ${input.productId}
      `
      const orderNo = createOrderNo("M")
      const orders = await transaction<{ readonly id: string }[]>`
        insert into mall_order
          (order_no, group_id, type, status, title, description, product, product_id, product_kind,
           quantity, unit_points, amount_cents, points, payment_method, created_by,
           idempotency_key, paid_at)
        values
          (${orderNo}, ${groupId}, 'resource', 'pending_ship', '资源购买', ${product.spec},
           ${product.name}, ${input.productId}, ${product.kind}, ${input.quantity}, ${unitPoints},
           0, ${points}, 'points', ${actorId}, ${input.idempotencyKey}, now())
        returning id
      `
      const orderId = orders[0]?.id ?? ""
      await transaction`
        insert into mall_point_ledger
          (group_id, type, delta, balance_after, order_id, remark, actor_user_id, idempotency_key)
        values
          (${groupId}, 'spend', ${-points}, ${next}, ${orderId},
           ${`购买 ${product.name} × ${input.quantity}`}, ${actorId}, ${input.idempotencyKey})
      `
      return { balance: next, orderId, orderNo, points, replayed: false }
    }),
  updateProduct: (productId, input) =>
    client.begin(async (transaction) => {
      const rows = await transaction<ProductRow[]>`
        select ${PRODUCT_COLUMNS(client)} from mall_product
        where id = ${productId} for update
      `
      const current = rows[0]
      if (current === undefined) throw new MallError("product_not_found")
      const stock = Number(current.stock) + (input.stockDelta ?? 0)
      if (stock < 0) throw new MallError("insufficient_stock")
      const updated = await transaction<ProductRow[]>`
        update mall_product set
          name = ${input.name ?? current.name},
          spec = ${input.spec ?? current.spec},
          price_points = ${input.pricePoints ?? Number(current.pricePoints)},
          min_quantity = ${input.minQuantity ?? current.minQuantity},
          enabled = ${input.enabled ?? current.enabled},
          stock = ${stock},
          updated_at = now()
        where id = ${productId}
        returning ${PRODUCT_COLUMNS(client)}
      `
      const row = updated[0]
      if (row === undefined) throw new MallError("product_not_found")
      return toProduct(row)
    }),
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
      where true
      ${filter.groupId === undefined ? client`` : client`and o.group_id = ${filter.groupId}`}
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
        select o.id, o.order_no as "orderNo", o.group_id as "groupId", g.name as "groupName",
          o.type, o.status, o.title, o.description, o.product, o.product_kind as "productKind",
          o.quantity, o.unit_points as "unitPoints", o.amount_cents as "amountCents", o.points,
          o.paid_at as "paidAt", o.created_at as "createdAt", o.cancelled_at as "cancelledAt",
          o.cancel_reason as "cancelReason",
          coalesce(nullif(u.display_name, ''), u.email) as "buyerName"
        from mall_order o
        join access_group g on g.id = o.group_id
        join app_user u on u.id = o.created_by
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
  listProducts: async (filter) => {
    const conditions = client`
      where true
      ${filter.enabledOnly ? client`and enabled` : client``}
      ${filter.kind === undefined ? client`` : client`and kind = ${filter.kind}`}
      ${
        filter.keyword === undefined || filter.keyword.length === 0
          ? client``
          : client`and name ilike ${likePattern(filter.keyword)}`
      }
    `
    const [rows, totals] = await Promise.all([
      client<ProductRow[]>`
        select ${PRODUCT_COLUMNS(client)} from mall_product
        ${conditions}
        order by created_at, id
        limit ${filter.pageSize} offset ${(filter.page - 1) * filter.pageSize}
      `,
      client<{ readonly total: string }[]>`
        select count(*) as total from mall_product ${conditions}
      `,
    ])
    return { items: rows.map(toProduct), total: Number(totals[0]?.total ?? 0) }
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
      const orderNo = createOrderNo("P")
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
