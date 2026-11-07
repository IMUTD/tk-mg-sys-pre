import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import type {
  AdjustInput,
  AdjustResult,
  GroupWallet,
  LedgerEntry,
  LedgerFilter,
  MallOrder,
  OrderFilter,
  Page,
  RechargeInput,
  RechargeResult,
  WalletFilter,
} from "./model"
import type { MallRepository } from "./repository"

export type MallService = {
  adjust(actorId: string, input: AdjustInput): Promise<AdjustResult>
  listAllWallets(filter: WalletFilter): Promise<Page<GroupWallet>>
  listLedger(filter: LedgerFilter): Promise<Page<LedgerEntry>>
  listOrders(filter: OrderFilter): Promise<Page<MallOrder>>
  listWallets(groupIds: readonly string[]): Promise<readonly GroupWallet[]>
  recharge(actorId: string, input: RechargeInput): Promise<RechargeResult>
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
  listAllWallets: (filter) => dependencies.repository.listAllWallets(filter),
  listLedger: (filter) => dependencies.repository.listLedger(filter),
  listOrders: (filter) => dependencies.repository.listOrders(filter),
  listWallets: (groupIds) => dependencies.repository.listWallets(groupIds),
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
})
