import { z } from "zod"

import {
  createApiClient,
  type GroupWallet,
  InvoicePageSchema,
  type InvoiceRecord,
  InvoiceSchema,
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

export const TransferableSchema = z.object({
  blockedBy: z.enum(["accelerator_linked", "has_bindings", "in_use"]).nullable(),
  detail: z.string(),
  id: z.string().uuid(),
  kind: z.enum(["account", "proxy"]),
  name: z.string(),
  shippable: z.boolean(),
  status: z.string(),
  tags: z.array(z.string()),
})
export type TransferableResource = z.infer<typeof TransferableSchema>

export const TransferRecordSchema = z.object({
  createdAt: z.string(),
  displayName: z.string(),
  entityId: z.string().uuid(),
  id: z.string().uuid(),
  kind: z.enum(["account", "proxy"]),
  movedByName: z.string(),
  orderNo: z.string().nullable(),
  reason: z.string(),
  sourceGroupName: z.string(),
  targetGroupName: z.string(),
})
export type TransferRecord = z.infer<typeof TransferRecordSchema>

const TransferablePageSchema = z.object({
  items: z.array(TransferableSchema),
  total: z.number().int(),
})
const TransferRecordPageSchema = z.object({
  items: z.array(TransferRecordSchema),
  total: z.number().int(),
})
const TransferResultSchema = z.object({ moved: z.number().int(), replayed: z.boolean() })

export type TransferableQuery = {
  readonly groupId: string
  readonly keyword?: string
  readonly page: number
  readonly pageSize: number
  readonly shippableOnly?: boolean
}

export type TransferRecordQuery = {
  readonly kind?: MallProduct["kind"]
  readonly orderId?: string
  readonly page: number
  readonly pageSize: number
}

export type TransferRequest = {
  readonly ids: readonly string[]
  readonly kind: MallProduct["kind"]
  readonly sourceGroupId: string
  readonly targetGroupId: string
}

export type ShipRequest = {
  readonly ids: readonly string[]
  readonly sourceGroupId: string
}

export type TransferResult = z.infer<typeof TransferResultSchema>

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

export type MerchantInvoiceQuery = {
  readonly keyword?: string
  readonly page: number
  readonly pageSize: number
  readonly status?: string
}

export type InvoiceIssueRequest = {
  readonly file: File | null
  readonly invoiceNumber: string
}

export type RefundRequest = { readonly reason: string; readonly reclaim: boolean }
export type RefundResult = { readonly points: number; readonly reclaimed: number }

export type ProductCreateInput = {
  readonly enabled: boolean
  readonly inventoryGroupId: string | null
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
  invoiceFileUrl(invoiceId: string): string
  invoices(query: MerchantInvoiceQuery): Promise<Paged<InvoiceRecord>>
  issueInvoice(invoiceId: string, input: InvoiceIssueRequest): Promise<InvoiceRecord>
  refundOrder(orderId: string, input: RefundRequest): Promise<RefundResult>
  rejectInvoice(invoiceId: string, reason: string): Promise<InvoiceRecord>
  ledger(query: MerchantLedgerQuery): Promise<Paged<LedgerEntry>>
  orders(query: MerchantOrderQuery): Promise<Paged<MallOrderRecord>>
  products(query: ProductListQuery): Promise<Paged<MallProduct>>
  recharge(input: RechargeInput): Promise<RechargeResult>
  shipOrder(orderId: string, input: ShipRequest): Promise<TransferResult>
  transfer(input: TransferRequest): Promise<TransferResult>
  transferable(
    kind: MallProduct["kind"],
    query: TransferableQuery,
  ): Promise<Paged<TransferableResource>>
  transfers(query: TransferRecordQuery): Promise<Paged<TransferRecord>>
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
    invoiceFileUrl: (invoiceId) =>
      `${apiBaseUrl}/merchant/invoices/${encodeURIComponent(invoiceId)}/file`,
    invoices: async (query) =>
      InvoicePageSchema.parse(
        await client.get("merchant/invoices", { searchParams: query }).json(),
      ),
    issueInvoice: async (invoiceId, { file, invoiceNumber }) => {
      const body = new FormData()
      body.set("invoiceNumber", invoiceNumber)
      if (file !== null) body.set("file", file)
      return InvoiceSchema.parse(
        await client
          .post(`merchant/invoices/${encodeURIComponent(invoiceId)}/issue`, { body })
          .json(),
      )
    },
    refundOrder: async (orderId, input) =>
      z
        .object({ points: z.number().int(), reclaimed: z.number().int() })
        .parse(
          await client
            .post(`merchant/orders/${encodeURIComponent(orderId)}/refund`, { json: input })
            .json(),
        ),
    rejectInvoice: async (invoiceId, reason) =>
      InvoiceSchema.parse(
        await client
          .post(`merchant/invoices/${encodeURIComponent(invoiceId)}/reject`, { json: { reason } })
          .json(),
      ),
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
    shipOrder: async (orderId, input) =>
      TransferResultSchema.parse(
        await client
          .post(`merchant/orders/${encodeURIComponent(orderId)}/ship`, { json: input })
          .json(),
      ),
    transfer: async (input) =>
      TransferResultSchema.parse(await client.post("merchant/transfers", { json: input }).json()),
    transferable: async (kind, query) =>
      TransferablePageSchema.parse(
        await client
          .get(`merchant/transferable/${kind === "account" ? "accounts" : "proxies"}`, {
            searchParams: query,
          })
          .json(),
      ),
    transfers: async (query) =>
      TransferRecordPageSchema.parse(
        await client.get("merchant/transfers", { searchParams: query }).json(),
      ),
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
