import type { Sql, TransactionSql } from "postgres"

import { detachAccounts } from "../accounts/desk"
import { lockGroup as lockProxyGroup } from "../proxies/repository"
import {
  type CancelOrderResult,
  MallError,
  type MallOrder,
  type Page,
  type ProductKind,
  type RefundOrderInput,
  type ShipmentItem,
  type ShipOrderInput,
  type ShipOrderResult,
  type TransferableFilter,
  type TransferableResource,
  type TransferBlock,
  type TransferInput,
  type TransferRecord,
  type TransferRecordFilter,
  type TransferResult,
} from "./model"
import { applyDelta, lockWallet } from "./wallet-lock"

export type TransferRepository = {
  refundOrder(
    actorId: string,
    orderId: string,
    input: RefundOrderInput,
  ): Promise<CancelOrderResult & { readonly reclaimed: number }>
  listShipment(groupId: string, orderId: string): Promise<readonly ShipmentItem[]>
  listTransferable(
    kind: ProductKind,
    filter: TransferableFilter,
  ): Promise<Page<TransferableResource>>
  listTransfers(filter: TransferRecordFilter): Promise<Page<TransferRecord>>
  shipOrder(actorId: string, orderId: string, input: ShipOrderInput): Promise<ShipOrderResult>
  transfer(actorId: string, input: TransferInput): Promise<TransferResult>
}

type Client = Sql | TransactionSql

type TransferableRow = {
  readonly blockedBy: TransferBlock | null
  readonly detail: string
  readonly id: string
  readonly name: string
  readonly shippable: boolean
  readonly status: string
  readonly tags: readonly string[]
}

type MoveRequest = {
  readonly actorId: string
  readonly ids: readonly string[]
  readonly orderId: string | null
  readonly reason: string
  readonly requireReady: boolean
  readonly sourceGroupId: string
  readonly targetGroupId: string
}

type MovedResource = { readonly displayName: string; readonly id: string }

const UNASSIGNED_GROUP_ID = "00000000-0000-4000-8000-000000000001"

const likePattern = (value: string): string => `%${value.replace(/[\\%_]/g, "\\$&")}%`

/** 除此之外的状态都可能还在操作设备，比如等盒子确认的 cancel_requested。 */
const FINISHED_TASK_STATUSES = ["cancelled", "succeeded", "failed", "timed_out"]

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "23505"

/**
 * 账号是否被占用。写成一条查询，保证草稿变任务时不会同时错过两边。
 * 未开始的派发也算占用：它开始后会在来源分组用这个账号建任务。
 */
const accountBusy = (client: Client) => client`(
  exists (
    select 1 from operation_account_lease lease
    where lease.account_id = a.id and lease.released_at is null
      and (lease.expires_at is null or lease.expires_at > now())
  )
  or exists (
    select 1 from operation_resource_allocation allocation
    where allocation.account_id = a.id and allocation.released_at is null
  )
  or exists (
    select 1 from execution_task task
    where task.account_id = a.id and task.status::text <> all(${FINISHED_TASK_STATUSES}::text[])
  )
  or exists (
    select 1 from operation_task_claim claim
    where claim.claim_kind = 'account' and claim.entity_id = a.id and claim.released_at is null
  )
  or exists (
    select 1 from operation_dispatch_item item
    where item.account_id = a.id and item.status in ('incomplete', 'ready')
  )
)`

const accountReady = (client: Client) => client`(a.status = 'ready' and not a.transferred)`

const proxyBusy = (client: Client) => client`(
  (p.probe_token is not null and p.probe_started_at > now() - interval '60 seconds')
  or exists (
    select 1 from operation_task_claim claim
    where claim.claim_kind = 'proxy' and claim.entity_id = p.id and claim.released_at is null
  )
  or exists (
    select 1 from operation_dispatch_item item
    where item.proxy_id = p.id and item.status in ('incomplete', 'ready')
  )
  or exists (
    select 1 from operation_dispatch_item item
    join execution_task task on task.dispatch_item_id = item.id
    where item.proxy_id = p.id and task.status::text <> all(${FINISHED_TASK_STATUSES}::text[])
  )
)`

const proxyHasBindings = (client: Client) => client`exists (
  select 1 from operation_account bound where bound.proxy_id = p.id and not bound.deleted
)`

const proxyLinked = (client: Client) => client`exists (
  select 1 from operation_proxy_accelerator edge
  where edge.proxy_id = p.id or edge.accelerator_id = p.id
)`

const proxyReady = (client: Client) => client`(
  p.status = 'ready'
  and (
    p.configuration ->> 'expiredAt' is null
    or (p.configuration ->> 'expiredAt')::timestamptz > now()
  )
)`

const assertTarget = async (transaction: TransactionSql, groupId: string): Promise<void> => {
  const rows = await transaction`
    select id from access_group where id = ${groupId} and id <> ${UNASSIGNED_GROUP_ID}
  `
  if (rows[0] === undefined) throw new MallError("group_not_found")
}

/**
 * 操作人是按来源分组选的。两笔订单抢同一个账号时，后一笔等到锁后这里会发现它已经不在来源分组，
 * 必须报错，不能把刚发给第一个买家的账号再转走。
 */
const assertStillInSource = (
  locked: readonly { readonly groupId: string }[],
  ids: readonly string[],
  sourceGroupId: string,
): void => {
  if (locked.length !== ids.length) throw new MallError("resource_not_found")
  if (locked.some((row) => row.groupId !== sourceGroupId)) throw new MallError("resource_changed")
}

const assertNoneNamed = <Row extends { readonly name: string }>(
  rows: readonly Row[],
  code: "resource_accelerator_linked" | "resource_has_bindings" | "resource_in_use",
): void => {
  if (rows.length > 0)
    throw new MallError(
      code,
      rows.map((row) => row.name),
    )
}

const moveAccounts = async (
  transaction: TransactionSql,
  request: MoveRequest,
): Promise<readonly MovedResource[]> => {
  const { ids, requireReady, sourceGroupId, targetGroupId } = request
  // 和兑换转移码一样先锁转移码再锁账号。否则兑换可能在等账号锁时拿到已经卖出的账号。
  await transaction`
    select transfer.id
    from operation_account_transfer transfer
    join operation_account_transfer_item item on item.transfer_id = transfer.id
    where item.account_id = any(${[...ids]}::uuid[]) and transfer.status = 'active'
    order by transfer.id
    for update of transfer
  `
  const locked = await transaction<
    {
      readonly groupId: string
      readonly id: string
      readonly identifier: string
      readonly name: string
      readonly ready: boolean
    }[]
  >`
    select a.id, a.group_id as "groupId", a.identifier,
      coalesce(nullif(a.name, ''), a.identifier) as name,
      ${accountReady(transaction)} as ready
    from operation_account a
    where a.id = any(${[...ids]}::uuid[]) and not a.deleted
    order by a.id
    for update
  `
  assertStillInSource(locked, ids, sourceGroupId)
  if (requireReady) {
    const notReady = locked.filter((row) => !row.ready).map((row) => row.name)
    if (notReady.length > 0) throw new MallError("resource_not_ready", notReady)
  }
  // 账号行已经锁住，这里读到的是锁之后的新快照，新的占用只能等本事务结束。
  const busy = await transaction<{ readonly name: string }[]>`
    select coalesce(nullif(a.name, ''), a.identifier) as name
    from operation_account a
    where a.id = any(${[...ids]}::uuid[]) and ${accountBusy(transaction)}
  `
  assertNoneNamed(busy, "resource_in_use")
  // 目标分组回收站里的账号也占着唯一索引。
  const conflicts = await transaction<{ readonly name: string }[]>`
    select identifier as name from operation_account
    where group_id = ${targetGroupId}
      and identifier = any(${locked.map((row) => row.identifier)}::text[])
  `
  if (conflicts.length > 0) {
    throw new MallError(
      "transfer_conflict",
      conflicts.map((row) => row.name),
    )
  }
  await detachAccounts(transaction, ids)
  try {
    // 设备、代理、备份都留在来源分组，标签和备注是来源分组的内部信息。只留账号本身的资料和凭据。
    await transaction`
      update operation_account
      set group_id = ${targetGroupId},
          device_id = null,
          device_instance_id = null,
          proxy_id = null,
          backup_device_id = null,
          backup_key = '',
          backup_name = '',
          backup_slot = '',
          backup_sha256 = '',
          backup_type = null,
          online = false,
          encrypted_transfer_key = '',
          transfer_key_hash = null,
          tags = '{}'::text[],
          note = '',
          updated_at = now()
      where id = any(${[...ids]}::uuid[])
    `
  } catch (error) {
    if (isUniqueViolation(error)) throw new MallError("transfer_conflict")
    throw error
  }
  return locked.map((row) => ({ displayName: row.name, id: row.id }))
}

const moveProxies = async (
  transaction: TransactionSql,
  request: MoveRequest,
): Promise<readonly MovedResource[]> => {
  const { ids, requireReady, sourceGroupId, targetGroupId } = request
  // 和代理模块用同一把分组锁，避免转移时有人正在改加速链路。
  await lockProxyGroup(transaction, sourceGroupId)
  const locked = await transaction<
    {
      readonly groupId: string
      readonly id: string
      readonly name: string
      readonly ready: boolean
    }[]
  >`
    select p.id, p.group_id as "groupId", p.name, ${proxyReady(transaction)} as ready
    from operation_proxy p
    where p.id = any(${[...ids]}::uuid[])
    order by p.id
    for update
  `
  assertStillInSource(locked, ids, sourceGroupId)
  if (requireReady) {
    const notReady = locked.filter((row) => !row.ready).map((row) => row.name)
    if (notReady.length > 0) throw new MallError("resource_not_ready", notReady)
  }
  const busy = await transaction<{ readonly name: string }[]>`
    select p.name from operation_proxy p
    where p.id = any(${[...ids]}::uuid[]) and ${proxyBusy(transaction)}
  `
  assertNoneNamed(busy, "resource_in_use")
  // 把指向这些代理的账号也锁住，回收站里的账号就不能在解绑前被恢复。
  const bound = await transaction<{ readonly deleted: boolean; readonly name: string }[]>`
    select a.deleted, p.name
    from operation_account a
    join operation_proxy p on p.id = a.proxy_id
    where a.proxy_id = any(${[...ids]}::uuid[])
    order by a.id
    for update of a
  `
  assertNoneNamed(
    bound.filter((row) => !row.deleted),
    "resource_has_bindings",
  )
  const linked = await transaction<{ readonly name: string }[]>`
    select p.name from operation_proxy p
    where p.id = any(${[...ids]}::uuid[]) and ${proxyLinked(transaction)}
  `
  assertNoneNamed(linked, "resource_accelerator_linked")
  await transaction`
    update operation_account set proxy_id = null, updated_at = now()
    where proxy_id = any(${[...ids]}::uuid[]) and deleted
  `
  // 清掉探测令牌，迟到的探测结果就写不回来了。
  await transaction`
    update operation_proxy
    set group_id = ${targetGroupId},
        tags = '{}'::text[],
        note = '',
        probe_token = null,
        probe_started_at = null,
        revision = revision + 1,
        updated_at = now()
    where id = any(${[...ids]}::uuid[])
  `
  return locked.map((row) => ({ displayName: row.name, id: row.id }))
}

const moveResources = async (
  transaction: TransactionSql,
  kind: ProductKind,
  request: MoveRequest,
): Promise<TransferResult> => {
  const moved =
    kind === "account"
      ? await moveAccounts(transaction, request)
      : await moveProxies(transaction, request)
  for (const item of moved) {
    await transaction`
      insert into mall_resource_transfer
        (kind, entity_id, display_name, source_group_id, target_group_id, order_id, moved_by, reason)
      values (${kind}, ${item.id}, ${item.displayName}, ${request.sourceGroupId},
        ${request.targetGroupId}, ${request.orderId}, ${request.actorId}, ${request.reason})
    `
  }
  return { moved: moved.length, replayed: false }
}

/** 响应丢失后重试：东西已经全部在目标分组，算成功，但不再写记录和审计。 */
const alreadyMoved = async (
  transaction: TransactionSql,
  input: TransferInput,
): Promise<boolean> => {
  const rows =
    input.kind === "account"
      ? await transaction`
          select id from operation_account
          where id = any(${[...input.ids]}::uuid[]) and group_id = ${input.targetGroupId}
            and not deleted
        `
      : await transaction`
          select id from operation_proxy
          where id = any(${[...input.ids]}::uuid[]) and group_id = ${input.targetGroupId}
        `
  return rows.length === input.ids.length
}

const shippableAccounts = (client: Client, groupId: string) => client`
  select count(*) from operation_account a
  where a.group_id = ${groupId} and not a.deleted
    and ${accountReady(client)} and not ${accountBusy(client)}
`

const shippableProxies = (client: Client, groupId: string) => client`
  select count(*) from operation_proxy p
  where p.group_id = ${groupId} and ${proxyReady(client)} and not ${proxyBusy(client)}
    and not ${proxyHasBindings(client)} and not ${proxyLinked(client)}
`

/**
 * 库存分组里能发货的数量，减去已下单还没发货占用的数量。
 * 必须在同一条语句里算：发货会同时减少两边，分开读会多算出库存。
 */
export const availableInventory = async (
  client: Client,
  kind: ProductKind,
  groupId: string,
): Promise<number> => {
  const shippable =
    kind === "account" ? shippableAccounts(client, groupId) : shippableProxies(client, groupId)
  const rows = await client<{ readonly total: string }[]>`
    select (${shippable}) - coalesce((
      select sum(o.quantity)
      from mall_order o
      join mall_product p on p.id = o.product_id
      where o.status = 'pending_ship' and p.inventory_group_id = ${groupId} and p.kind = ${kind}
    ), 0) as total
  `
  return Number(rows[0]?.total ?? 0)
}

export const createPostgresTransferRepository = (client: Sql): TransferRepository => ({
  refundOrder: (actorId, orderId, { reason, reclaim }) =>
    client.begin(async (transaction) => {
      const owners = await transaction<{ readonly groupId: string }[]>`
        select group_id as "groupId" from mall_order where id = ${orderId}
      `
      const groupId = owners[0]?.groupId
      if (groupId === undefined) throw new MallError("order_not_found")
      const balance = await lockWallet(transaction, groupId)
      const orders = await transaction<
        {
          readonly kind: ProductKind | null
          readonly orderNo: string
          readonly points: string
          readonly status: MallOrder["status"]
          readonly type: MallOrder["type"]
        }[]
      >`
        select product_kind as kind, order_no as "orderNo", points, status, type
        from mall_order where id = ${orderId} for update
      `
      const order = orders[0]
      if (order === undefined) throw new MallError("order_not_found")
      const points = Number(order.points)
      if (order.status === "refunded") {
        return { balance, groupId, orderNo: order.orderNo, points, reclaimed: 0, replayed: true }
      }
      if (order.type !== "resource" || order.status !== "shipped" || order.kind === null) {
        throw new MallError("order_not_refundable")
      }
      let reclaimed = 0
      if (reclaim) {
        const shipped = await transaction<
          { readonly id: string; readonly source: string | null }[]
        >`
          select entity_id as id, source_group_id as source
          from mall_resource_transfer where order_id = ${orderId}
        `
        // 只收回这笔订单发出去的：发货后又转走、再被另一笔订单发回来的，不属于这笔退款。
        const latest = await transaction<
          { readonly name: string; readonly orderId: string | null }[]
        >`
          select distinct on (entity_id) display_name as name, order_id as "orderId"
          from mall_resource_transfer
          where entity_id = any(${shipped.map((item) => item.id)}::uuid[])
          order by entity_id, created_at desc, id desc
        `
        const movedSince = latest.filter((row) => row.orderId !== orderId)
        if (movedSince.length > 0) {
          throw new MallError(
            "refund_items_moved",
            movedSince.map((row) => row.name),
          )
        }
        const bySource = new Map<string, string[]>()
        for (const item of shipped) {
          if (item.source === null) throw new MallError("refund_source_missing")
          bySource.set(item.source, [...(bySource.get(item.source) ?? []), item.id])
        }
        for (const [source, ids] of [...bySource].sort(([a], [b]) => a.localeCompare(b))) {
          const moved = await moveResources(transaction, order.kind, {
            actorId,
            ids,
            orderId: null,
            reason: `订单 ${order.orderNo} 退款收回`,
            requireReady: false,
            sourceGroupId: groupId,
            targetGroupId: source,
          })
          reclaimed += moved.moved
        }
      }
      await transaction`
        update mall_order
        set status = 'refunded', refunded_at = now(), refunded_by = ${actorId},
            cancel_reason = ${reason}
        where id = ${orderId}
      `
      const next = await applyDelta(transaction, groupId, balance, points)
      await transaction`
        insert into mall_point_ledger
          (group_id, type, delta, balance_after, order_id, remark, actor_user_id, idempotency_key)
        values
          (${groupId}, 'refund', ${points}, ${next}, ${orderId}, ${`订单退款：${reason}`},
           ${actorId}, ${`refund:${orderId}`})
      `
      return { balance: next, groupId, orderNo: order.orderNo, points, reclaimed, replayed: false }
    }),
  listShipment: async (groupId, orderId) => {
    const orders = await client`
      select id from mall_order where id = ${orderId} and group_id = ${groupId}
    `
    if (orders[0] === undefined) throw new MallError("order_not_found")
    return client<ShipmentItem[]>`
      select id, kind, display_name as name
      from mall_resource_transfer
      where order_id = ${orderId}
      order by display_name, id
    `
  },
  listTransferable: async (kind, filter) => {
    const { groupId, keyword, page, pageSize, shippableOnly } = filter
    const pattern = keyword === undefined || keyword.length === 0 ? null : likePattern(keyword)
    const source =
      kind === "account"
        ? client`
            select a.id, a.created_at, a.status::text as status, a.tags,
              coalesce(nullif(a.name, ''), a.identifier) as name, a.identifier as detail,
              case when ${accountBusy(client)} then 'in_use' end as blocked_by,
              ${accountReady(client)} as ready
            from operation_account a
            where a.group_id = ${groupId} and not a.deleted
              ${
                pattern === null
                  ? client``
                  : client`and (a.name ilike ${pattern} or a.identifier ilike ${pattern})`
              }
          `
        : client`
            select p.id, p.created_at, p.status::text as status, p.tags, p.name,
              p.endpoint as detail,
              case
                when ${proxyBusy(client)} then 'in_use'
                when ${proxyHasBindings(client)} then 'has_bindings'
                when ${proxyLinked(client)} then 'accelerator_linked'
              end as blocked_by,
              ${proxyReady(client)} as ready
            from operation_proxy p
            where p.group_id = ${groupId}
              ${
                pattern === null
                  ? client``
                  : client`and (p.name ilike ${pattern} or p.endpoint ilike ${pattern})`
              }
          `
    const visible = shippableOnly === true ? client`where blocked_by is null and ready` : client``
    const [rows, totals] = await Promise.all([
      client<TransferableRow[]>`
        select id, status, tags, name, detail,
          blocked_by as "blockedBy", (blocked_by is null and ready) as shippable
        from (${source}) resource
        ${visible}
        order by created_at desc, id desc
        limit ${pageSize} offset ${(page - 1) * pageSize}
      `,
      client<{ readonly total: string }[]>`
        select count(*) as total from (${source}) resource ${visible}
      `,
    ])
    return {
      items: rows.map((row) => ({ ...row, kind })),
      total: Number(totals[0]?.total ?? 0),
    }
  },
  listTransfers: async (filter) => {
    const conditions = client`
      where true
      ${filter.kind === undefined ? client`` : client`and t.kind = ${filter.kind}`}
      ${filter.orderId === undefined ? client`` : client`and t.order_id = ${filter.orderId}`}
    `
    const [rows, totals] = await Promise.all([
      client<(Omit<TransferRecord, "createdAt"> & { readonly createdAt: Date })[]>`
        select t.id, t.kind, t.entity_id as "entityId", t.display_name as "displayName",
          t.created_at as "createdAt", o.order_no as "orderNo", t.reason,
          coalesce(source.name, '已删除的分组') as "sourceGroupName",
          coalesce(target.name, '已删除的分组') as "targetGroupName",
          coalesce(nullif(u.display_name, ''), u.email) as "movedByName"
        from mall_resource_transfer t
        join app_user u on u.id = t.moved_by
        left join access_group source on source.id = t.source_group_id
        left join access_group target on target.id = t.target_group_id
        left join mall_order o on o.id = t.order_id
        ${conditions}
        order by t.created_at desc, t.id desc
        limit ${filter.pageSize} offset ${(filter.page - 1) * filter.pageSize}
      `,
      client<{ readonly total: string }[]>`
        select count(*) as total from mall_resource_transfer t ${conditions}
      `,
    ])
    return {
      items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      total: Number(totals[0]?.total ?? 0),
    }
  },
  shipOrder: (actorId, orderId, { ids, sourceGroupId }) =>
    client.begin(async (transaction) => {
      const orders = await transaction<
        {
          readonly groupId: string
          readonly kind: ProductKind | null
          readonly orderNo: string
          readonly productId: string | null
          readonly quantity: number | null
          readonly status: MallOrder["status"]
          readonly type: MallOrder["type"]
        }[]
      >`
        select group_id as "groupId", product_kind as kind, order_no as "orderNo", quantity,
          status, type, product_id as "productId"
        from mall_order where id = ${orderId}
        for update
      `
      const order = orders[0]
      if (order === undefined) throw new MallError("order_not_found")
      if (order.status === "shipped") {
        // 同一批东西重试算成功；换了另一批说明是误操作，不能再发一次。
        const shipped = await transaction<{ readonly id: string }[]>`
          select entity_id as id from mall_resource_transfer where order_id = ${orderId}
        `
        const same = shipped.length === ids.length && shipped.every((item) => ids.includes(item.id))
        if (!same) throw new MallError("order_not_shippable")
        return { groupId: order.groupId, moved: 0, orderNo: order.orderNo, replayed: true }
      }
      if (order.type !== "resource" || order.status !== "pending_ship" || order.kind === null) {
        throw new MallError("order_not_shippable")
      }
      if (ids.length !== order.quantity) throw new MallError("ship_quantity_mismatch")
      if (sourceGroupId === order.groupId) throw new MallError("transfer_same_group")
      // 商品绑定了库存分组，就只能从那里发，避免选错分组把别的客户的货发出去。
      const inventory = await transaction<{ readonly groupId: string | null }[]>`
        select inventory_group_id as "groupId" from mall_product where id = ${order.productId}
      `
      const bound = inventory[0]?.groupId ?? null
      if (bound !== null && bound !== sourceGroupId) throw new MallError("ship_source_mismatch")
      const result = await moveResources(transaction, order.kind, {
        actorId,
        ids,
        orderId,
        reason: "",
        requireReady: true,
        sourceGroupId,
        targetGroupId: order.groupId,
      })
      await transaction`
        update mall_order
        set status = 'shipped', shipped_at = now(), shipped_by = ${actorId}
        where id = ${orderId}
      `
      return { ...result, groupId: order.groupId, orderNo: order.orderNo }
    }),
  transfer: (actorId, input) =>
    client.begin(async (transaction) => {
      if (input.sourceGroupId === input.targetGroupId) throw new MallError("transfer_same_group")
      await assertTarget(transaction, input.targetGroupId)
      if (await alreadyMoved(transaction, input)) return { moved: 0, replayed: true }
      return moveResources(transaction, input.kind, {
        actorId,
        ids: input.ids,
        orderId: null,
        reason: "",
        requireReady: false,
        sourceGroupId: input.sourceGroupId,
        targetGroupId: input.targetGroupId,
      })
    }),
})
