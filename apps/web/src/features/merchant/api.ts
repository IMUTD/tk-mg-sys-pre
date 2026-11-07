import { z } from "zod"

import {
  createApiClient,
  type GroupWallet,
  type LedgerEntry,
  LedgerPageSchema,
  type MallOrderRecord,
  type MallProduct,
  OrderPageSchema,
  type Paged,
  ProductPageSchema,
  ProductSchema,
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

export type ProductCreateInput = {
  readonly enabled: boolean
  readonly kind: MallProduct["kind"]
  readonly minQuantity: number
  readonly name: string
  readonly pricePoints: number
  readonly spec: string
  readonly stock: number
}

export type ProductUpdateInput = Partial<Omit<ProductCreateInput, "kind" | "stock">> & {
  readonly stockDelta?: number
}

export type MerchantOrderQuery = {
  readonly keyword?: string
  readonly page: number
  readonly pageSize: number
  readonly status?: string
  readonly type: "resource"
}

export type ProductListQuery = {
  readonly keyword?: string
  readonly page: number
  readonly pageSize: number
}

export interface MerchantApi {
  adjust(input: AdjustInput): Promise<AdjustResult>
  cancelOrder(orderId: string, reason: string): Promise<void>
  createProduct(input: ProductCreateInput): Promise<MallProduct>
  ledger(query: MerchantLedgerQuery): Promise<Paged<LedgerEntry>>
  orders(query: MerchantOrderQuery): Promise<Paged<MallOrderRecord>>
  products(query: ProductListQuery): Promise<Paged<MallProduct>>
  recharge(input: RechargeInput): Promise<RechargeResult>
  updateProduct(productId: string, input: ProductUpdateInput): Promise<MallProduct>
  wallets(query: WalletListQuery): Promise<Paged<GroupWallet>>
}

export const createMerchantApi = (apiBaseUrl = "/api"): MerchantApi => {
  const client = createApiClient(apiBaseUrl)
  return {
    adjust: async (input) =>
      z
        .object({ balance: z.number().int() })
        .parse(await client.post("merchant/wallet-adjustments", { json: input }).json()),
    cancelOrder: async (orderId, reason) => {
      await client.post(`merchant/orders/${encodeURIComponent(orderId)}/cancel`, {
        json: { reason },
      })
    },
    createProduct: async (input) =>
      ProductSchema.parse(await client.post("merchant/products", { json: input }).json()),
    ledger: async (query) =>
      LedgerPageSchema.parse(await client.get("merchant/ledger", { searchParams: query }).json()),
    orders: async (query) =>
      OrderPageSchema.parse(await client.get("merchant/orders", { searchParams: query }).json()),
    products: async (query) =>
      ProductPageSchema.parse(
        await client.get("merchant/products", { searchParams: query }).json(),
      ),
    recharge: async (input) =>
      z
        .object({ balance: z.number().int(), points: z.number().int() })
        .parse(await client.post("merchant/recharges", { json: input }).json()),
    updateProduct: async (productId, input) =>
      ProductSchema.parse(
        await client
          .patch(`merchant/products/${encodeURIComponent(productId)}`, { json: input })
          .json(),
      ),
    wallets: async (query) =>
      WalletPageSchema.parse(await client.get("merchant/wallets", { searchParams: query }).json()),
  }
}
