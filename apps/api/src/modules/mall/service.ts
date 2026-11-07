import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import type { AlipayGateway } from "./alipay"
import { isTradePaid } from "./alipay"
import type {
  AdjustInput,
  AdjustResult,
  CancelOrderResult,
  GroupWallet,
  InvoiceCreateInput,
  InvoiceFile,
  InvoiceFilter,
  InvoiceIssueInput,
  InvoiceQuota,
  LedgerEntry,
  LedgerFilter,
  MallInvoice,
  MallOrder,
  MallProduct,
  OrderFilter,
  Page,
  ProductCreateInput,
  ProductFilter,
  ProductKind,
  ProductUpdateInput,
  PurchaseInput,
  PurchaseResult,
  RechargeInput,
  RechargeOrder,
  RechargeResult,
  RefundOrderInput,
  ShipmentItem,
  ShipOrderInput,
  ShipOrderResult,
  TransferableFilter,
  TransferableResource,
  TransferInput,
  TransferRecord,
  TransferRecordFilter,
  TransferResult,
  WalletFilter,
} from "./model"
import { MallError } from "./model"
import type { MallRepository } from "./repository"

/** 支付宝 30 分钟后不再收款，多等 5 分钟再查，让迟到的回调先落账。 */
const STALE_RECHARGE_MINUTES = 35
/**
 * 支付宝的 30 分钟从买家进入付款那一步算起，所以“查不到交易”不代表不会再付款，
 * 要等得更久才关。查询一直没有结果的订单，最多留一天。
 */
const ABSENT_CLOSE_MINUTES = 120
const UNKNOWN_CLOSE_MINUTES = 24 * 60

const centsToYuan = (cents: number): string => (cents / 100).toFixed(2)

export type AlipayRecharge = RechargeOrder & { readonly payUrl: string | null }

export type MallService = {
  alipayEnabled(): boolean
  createInvoice(actorId: string, groupId: string, input: InvoiceCreateInput): Promise<MallInvoice>
  createRecharge(
    actorId: string,
    groupId: string,
    input: { readonly amountYuan: string; readonly idempotencyKey: string },
  ): Promise<AlipayRecharge>
  handleAlipayNotify(params: Readonly<Record<string, string>>): Promise<"failure" | "success">
  invoiceFile(invoiceId: string, groupId?: string): Promise<InvoiceFile>
  invoiceQuota(groupId: string): Promise<InvoiceQuota>
  issueInvoice(actorId: string, invoiceId: string, input: InvoiceIssueInput): Promise<MallInvoice>
  listInvoices(filter: InvoiceFilter): Promise<Page<MallInvoice>>
  rechargeStatus(groupId: string, orderNo: string): Promise<RechargeOrder>
  refundOrder(
    actorId: string,
    orderId: string,
    input: RefundOrderInput,
  ): Promise<CancelOrderResult & { readonly reclaimed: number }>
  rejectInvoice(actorId: string, invoiceId: string, reason: string): Promise<MallInvoice>
  sweepRecharges(): Promise<void>
  listShipment(groupId: string, orderId: string): Promise<readonly ShipmentItem[]>
  listTransferable(
    kind: ProductKind,
    filter: TransferableFilter,
  ): Promise<Page<TransferableResource>>
  listTransfers(filter: TransferRecordFilter): Promise<Page<TransferRecord>>
  shipOrder(actorId: string, orderId: string, input: ShipOrderInput): Promise<ShipOrderResult>
  transfer(actorId: string, input: TransferInput): Promise<TransferResult>
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
  updateProduct(actorId: string, productId: string, input: ProductUpdateInput): Promise<MallProduct>
}

export const createMallService = (dependencies: {
  readonly auditRepository: AuditRepository
  readonly alipay?: AlipayGateway | null
  readonly repository: MallRepository
}): MallService => {
  const alipay = dependencies.alipay ?? null

  /** 钱已经入账，审计写失败不能把成功变成失败，否则支付宝会一直重发。 */
  const settle = async (
    orderNo: string,
    tradeNo: string,
    amountYuan: string,
    source: "notify" | "reconcile" | "sweep",
  ): Promise<"failure" | "success"> => {
    const result = await dependencies.repository.settleRecharge(orderNo, tradeNo, amountYuan)
    if (result.result === "mismatch" || result.result === "missing") {
      console.error("alipay settle refused", { orderNo, result: result.result, source })
      return "failure"
    }
    if (result.result === "granted") {
      await writeAuditEvent(dependencies.auditRepository, {
        action: "mall.alipay.paid",
        actorId: result.actorId,
        metadata: { groupId: result.groupId, orderNo, points: String(result.points), source },
        outcome: "allowed",
        target: `order:${result.orderId}`,
      }).catch(() => console.error("alipay audit failed", { orderNo }))
    }
    return "success"
  }

  const reconcile = async (orderNo: string, source: "reconcile" | "sweep", ageMinutes = 0) => {
    const trade = await alipay?.query(orderNo)
    if (trade === undefined) return
    if (trade?.kind === "found" && isTradePaid(trade.tradeStatus)) {
      await settle(orderNo, trade.tradeNo, trade.amount, source)
      return
    }
    if (source !== "sweep") return
    const closed = trade?.kind === "found" && trade.tradeStatus === "TRADE_CLOSED"
    const abandoned = trade?.kind === "absent" && ageMinutes >= ABSENT_CLOSE_MINUTES
    if (closed || abandoned || ageMinutes >= UNKNOWN_CLOSE_MINUTES) {
      await dependencies.repository.closeRecharge(orderNo)
    }
  }

  return {
    alipayEnabled: () => alipay !== null,
    createInvoice: async (actorId, groupId, input) => {
      const { invoice, replayed } = await dependencies.repository.createInvoice(
        actorId,
        groupId,
        input,
      )
      if (!replayed) {
        await writeAuditEvent(dependencies.auditRepository, {
          action: "mall.invoice.create",
          actorId,
          metadata: { amountCents: String(invoice.amountCents), groupId },
          outcome: "allowed",
          target: `invoice:${invoice.id}`,
        })
      }
      return invoice
    },
    createRecharge: async (actorId, groupId, input) => {
      if (alipay === null) throw new MallError("alipay_unavailable")
      const { replayed, ...order } = await dependencies.repository.createRecharge(
        actorId,
        groupId,
        input,
      )
      if (!replayed) {
        await writeAuditEvent(dependencies.auditRepository, {
          action: "mall.alipay.create",
          actorId,
          metadata: { amountCents: String(order.amountCents), groupId, orderNo: order.orderNo },
          outcome: "allowed",
          target: `group:${groupId}`,
        })
      }
      return {
        ...order,
        payUrl:
          order.status === "unpaid"
            ? alipay.payUrl({
                amountYuan: centsToYuan(order.amountCents),
                outTradeNo: order.orderNo,
                subject: `积分充值 ${order.points.toLocaleString("zh-CN")}`,
              })
            : null,
      }
    },
    handleAlipayNotify: async (params) => {
      if (alipay === null || !alipay.verifyNotify(params)) return "failure"
      const {
        out_trade_no: orderNo = "",
        total_amount: amount = "",
        trade_no: tradeNo = "",
        trade_status: status = "",
      } = params
      try {
        if (status === "TRADE_CLOSED") {
          await dependencies.repository.closeRecharge(orderNo)
          return "success"
        }
        if (!isTradePaid(status)) return "success"
        return await settle(orderNo, tradeNo, amount, "notify")
      } catch (error) {
        console.error("alipay notify failed", { error, orderNo })
        return "failure"
      }
    },
    invoiceFile: (invoiceId, groupId) => dependencies.repository.invoiceFile(invoiceId, groupId),
    invoiceQuota: (groupId) => dependencies.repository.invoiceQuota(groupId),
    issueInvoice: async (actorId, invoiceId, input) => {
      const { invoice, replayed } = await dependencies.repository.issueInvoice(
        actorId,
        invoiceId,
        input,
      )
      if (!replayed) {
        await writeAuditEvent(dependencies.auditRepository, {
          action: "mall.invoice.issue",
          actorId,
          metadata: { groupId: invoice.groupId, invoiceNumber: invoice.invoiceNumber },
          outcome: "allowed",
          target: `invoice:${invoiceId}`,
        })
      }
      return invoice
    },
    listInvoices: (filter) => dependencies.repository.listInvoices(filter),
    rechargeStatus: async (groupId, orderNo) => {
      const order = await dependencies.repository.findRecharge(groupId, orderNo)
      if (order.status === "paid") return order
      // 回调可能丢失，买家点“我已支付”时主动问一次支付宝。
      await reconcile(orderNo, "reconcile")
      return dependencies.repository.findRecharge(groupId, orderNo)
    },
    refundOrder: async (actorId, orderId, input) => {
      const result = await dependencies.repository.refundOrder(actorId, orderId, input)
      if (!result.replayed) {
        await writeAuditEvent(dependencies.auditRepository, {
          action: "mall.order.refund",
          actorId,
          metadata: {
            groupId: result.groupId,
            orderNo: result.orderNo,
            points: String(result.points),
            reclaimed: String(result.reclaimed),
          },
          outcome: "allowed",
          target: `order:${orderId}`,
        })
      }
      return result
    },
    rejectInvoice: async (actorId, invoiceId, reason) => {
      const { invoice, replayed } = await dependencies.repository.rejectInvoice(
        actorId,
        invoiceId,
        reason,
      )
      if (!replayed) {
        await writeAuditEvent(dependencies.auditRepository, {
          action: "mall.invoice.reject",
          actorId,
          metadata: { groupId: invoice.groupId },
          outcome: "allowed",
          target: `invoice:${invoiceId}`,
        })
      }
      return invoice
    },
    sweepRecharges: async () => {
      if (alipay === null) return
      const stale = await dependencies.repository.staleRecharges(STALE_RECHARGE_MINUTES)
      for (const { ageMinutes, orderNo, status } of stale) {
        // 一笔出错不能挡住后面的订单。
        await reconcile(orderNo, "sweep", status === "closed" ? 0 : ageMinutes).catch(
          (error: unknown) => console.error("alipay sweep failed", { error, orderNo }),
        )
      }
    },
    adjust: async (actorId, input) => {
      const result = await dependencies.repository.adjust(actorId, input)
      if (!result.replayed) {
        await writeAuditEvent(dependencies.auditRepository, {
          action: "mall.adjust",
          actorId,
          metadata: { delta: String(result.delta), groupId: input.groupId },
          outcome: "allowed",
          target: `group:${input.groupId}`,
        })
      }
      return result
    },
    cancelOrder: async (actorId, orderId, reason) => {
      const result = await dependencies.repository.cancelOrder(actorId, orderId, reason)
      if (!result.replayed) {
        await writeAuditEvent(dependencies.auditRepository, {
          action: "mall.order.cancel",
          actorId,
          metadata: {
            groupId: result.groupId,
            orderNo: result.orderNo,
            points: String(result.points),
          },
          outcome: "allowed",
          target: `order:${orderId}`,
        })
      }
      return result
    },
    createProduct: async (actorId, input) => {
      const product = await dependencies.repository.createProduct(actorId, input)
      await writeAuditEvent(dependencies.auditRepository, {
        action: "mall.product.create",
        actorId,
        metadata: { pricePoints: String(product.pricePoints), stock: String(product.stock) },
        outcome: "allowed",
        target: `product:${product.id}`,
      })
      return product
    },
    listAllWallets: (filter) => dependencies.repository.listAllWallets(filter),
    listShipment: (groupId, orderId) => dependencies.repository.listShipment(groupId, orderId),
    listTransferable: (kind, filter) => dependencies.repository.listTransferable(kind, filter),
    listTransfers: (filter) => dependencies.repository.listTransfers(filter),
    listLedger: (filter) => dependencies.repository.listLedger(filter),
    listOrders: (filter) => dependencies.repository.listOrders(filter),
    listProducts: (filter) => dependencies.repository.listProducts(filter),
    listWallets: (groupIds) => dependencies.repository.listWallets(groupIds),
    purchase: async (actorId, groupId, input) => {
      const result = await dependencies.repository.purchase(actorId, groupId, input)
      if (!result.replayed) {
        await writeAuditEvent(dependencies.auditRepository, {
          action: "mall.purchase",
          actorId,
          metadata: {
            groupId,
            orderNo: result.orderNo,
            points: String(result.points),
            quantity: String(input.quantity),
          },
          outcome: "allowed",
          target: `product:${input.productId}`,
        })
      }
      return result
    },
    shipOrder: async (actorId, orderId, input) => {
      const result = await dependencies.repository.shipOrder(actorId, orderId, input)
      if (!result.replayed) {
        await writeAuditEvent(dependencies.auditRepository, {
          action: "mall.order.ship",
          actorId,
          metadata: {
            count: String(result.moved),
            groupId: result.groupId,
            orderNo: result.orderNo,
            sourceGroupId: input.sourceGroupId,
          },
          outcome: "allowed",
          target: `order:${orderId}`,
        })
      }
      return result
    },
    transfer: async (actorId, input) => {
      const result = await dependencies.repository.transfer(actorId, input)
      if (!result.replayed) {
        await writeAuditEvent(dependencies.auditRepository, {
          action: "mall.resource.transfer",
          actorId,
          metadata: {
            count: String(result.moved),
            groupId: input.targetGroupId,
            kind: input.kind,
            sourceGroupId: input.sourceGroupId,
          },
          outcome: "allowed",
          target: `group:${input.targetGroupId}`,
        })
      }
      return result
    },
    recharge: async (actorId, input) => {
      const result = await dependencies.repository.recharge(actorId, input)
      if (!result.replayed) {
        await writeAuditEvent(dependencies.auditRepository, {
          action: "mall.recharge",
          actorId,
          metadata: {
            groupId: input.groupId,
            orderNo: result.orderNo,
            points: String(result.points),
          },
          outcome: "allowed",
          target: `group:${input.groupId}`,
        })
      }
      return result
    },
    updateProduct: async (actorId, productId, input) => {
      const product = await dependencies.repository.updateProduct(productId, input)
      await writeAuditEvent(dependencies.auditRepository, {
        action: "mall.product.update",
        actorId,
        metadata: {
          enabled: String(product.enabled),
          pricePoints: String(product.pricePoints),
          stock: String(product.stock),
        },
        outcome: "allowed",
        target: `product:${productId}`,
      })
      return product
    },
  }
}
