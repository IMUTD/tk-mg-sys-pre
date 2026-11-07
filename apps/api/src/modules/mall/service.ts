import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import type {
  AdjustInput,
  AdjustResult,
  CancelOrderResult,
  GroupWallet,
  LedgerEntry,
  LedgerFilter,
  MallOrder,
  MallProduct,
  OrderFilter,
  Page,
  ProductCreateInput,
  ProductFilter,
  ProductUpdateInput,
  PurchaseInput,
  PurchaseResult,
  RechargeInput,
  RechargeResult,
  WalletFilter,
} from "./model"
import type { MallRepository } from "./repository"

export type MallService = {
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
  readonly repository: MallRepository
}): MallService => ({
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
})
