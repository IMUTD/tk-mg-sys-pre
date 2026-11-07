import { z } from "zod"

import {
  createApiClient,
  type GroupWallet,
  type LedgerEntry,
  LedgerPageSchema,
  type Paged,
  WalletPageSchema,
} from "../mall/api"

export type RechargeInput = {
  readonly amountYuan: string
  readonly groupId: string
  readonly idempotencyKey: string
  readonly remark: string
}

export type AdjustInput = {
  readonly delta: number
  readonly groupId: string
  readonly idempotencyKey: string
  readonly remark: string
}

export type RechargeResult = { readonly balance: number; readonly points: number }
export type AdjustResult = { readonly balance: number }

export type WalletListQuery = {
  readonly keyword?: string
  readonly page: number
  readonly pageSize: number
}

export type MerchantLedgerQuery = {
  readonly groupId?: string
  readonly page: number
  readonly pageSize: number
}

export interface MerchantApi {
  adjust(input: AdjustInput): Promise<AdjustResult>
  ledger(query: MerchantLedgerQuery): Promise<Paged<LedgerEntry>>
  recharge(input: RechargeInput): Promise<RechargeResult>
  wallets(query: WalletListQuery): Promise<Paged<GroupWallet>>
}

export const createMerchantApi = (apiBaseUrl = "/api"): MerchantApi => {
  const client = createApiClient(apiBaseUrl)
  return {
    adjust: async (input) =>
      z
        .object({ balance: z.number().int() })
        .parse(await client.post("merchant/wallet-adjustments", { json: input }).json()),
    ledger: async (query) =>
      LedgerPageSchema.parse(await client.get("merchant/ledger", { searchParams: query }).json()),
    recharge: async (input) =>
      z
        .object({ balance: z.number().int(), points: z.number().int() })
        .parse(await client.post("merchant/recharges", { json: input }).json()),
    wallets: async (query) =>
      WalletPageSchema.parse(await client.get("merchant/wallets", { searchParams: query }).json()),
  }
}
