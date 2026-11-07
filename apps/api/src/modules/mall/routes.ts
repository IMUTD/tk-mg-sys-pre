import type { Context, Hono } from "hono"
import { z } from "zod"

import { canViewPage, GroupIdSchema, isPlatformScope } from "../../lib/authorization"
import { PageKey } from "../../lib/pages"
import {
  authorizePageViewRequest,
  hasPageAuthorizationFailure,
  sessionPrincipal,
} from "../access/page-authorization"
import { requireGroupAccess } from "../access/service"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import type { AuthService, SessionPrincipal } from "../auth/service"
import {
  AdjustInputSchema,
  AlipayRechargeInputSchema,
  CancelOrderInputSchema,
  InvoiceCreateSchema,
  InvoiceNumberSchema,
  InvoiceQuerySchema,
  InvoiceRejectSchema,
  type LedgerEntry,
  LedgerQuerySchema,
  MAX_INVOICE_FILE_BYTES,
  MallError,
  type MallErrorCode,
  type MallOrder,
  type MallProduct,
  MerchantLedgerQuerySchema,
  MerchantOrderQuerySchema,
  OrderQuerySchema,
  ProductCreateSchema,
  ProductQuerySchema,
  ProductUpdateSchema,
  PurchaseInputSchema,
  RechargeInputSchema,
  RefundOrderInputSchema,
  ShipOrderInputSchema,
  TransferableQuerySchema,
  TransferInputSchema,
  TransferRecordQuerySchema,
  WalletQuerySchema,
} from "./model"
import type { MallService } from "./service"

const IdSchema = z.string().uuid()

const MALL_PAGES = [
  PageKey.MallRecords,
  PageKey.MallOrders,
  PageKey.MallInvoices,
  PageKey.MallRedeem,
] as const

const parseJson = async <T>(request: Request, schema: z.ZodType<T>): Promise<T | null> => {
  try {
    const parsed = schema.safeParse(await request.json())
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

const NOT_FOUND_CODES: readonly MallErrorCode[] = [
  "group_not_found",
  "invoice_not_found",
  "order_not_found",
  "product_not_found",
  "resource_not_found",
]

const statusFor = (code: MallErrorCode): 404 | 409 | 503 =>
  code === "alipay_unavailable" ? 503 : NOT_FOUND_CODES.includes(code) ? 404 : 409

const isDeadlock = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "40P01"

const mallResponse = async (context: Context, run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run()
  } catch (error) {
    if (error instanceof MallError) {
      return context.json(
        error.items.length === 0
          ? { error: error.code }
          : { error: error.code, items: error.items },
        statusFor(error.code),
      )
    }
    // 事务已经回滚，重试是安全的。
    if (isDeadlock(error)) return context.json({ error: "resource_busy" }, 409)
    throw error
  }
}

/** 买家不需要知道是哪位平台人员操作的。 */
const forBuyer = ({ actorName: _actorName, ...entry }: LedgerEntry) => entry

const orderForBuyer = ({
  buyerName: _buyerName,
  inventoryGroupId: _inventoryGroupId,
  inventoryGroupName: _inventoryGroupName,
  ...order
}: MallOrder) => order

/** 买家看到的库存不超过实际能发的数量，也看不到货放在哪个分组。 */
const productForBuyer = ({
  available,
  inventoryGroupId: _inventoryGroupId,
  inventoryGroupName: _inventoryGroupName,
  stock,
  ...product
}: MallProduct) => ({
  ...product,
  stock: available === null ? stock : Math.min(stock, Math.max(available, 0)),
})

const pdfResponse = (content: Uint8Array, fileName: string): Response =>
  new Response(Buffer.from(content), {
    headers: {
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
    },
  })

const hasPdfHeader = (content: Uint8Array): boolean =>
  Buffer.from(content.subarray(0, 5)).toString("latin1") === "%PDF-"

/** 表单比文件略大，这里只是在读请求体之前挡掉明显超大的上传。 */
const MAX_ISSUE_BODY_BYTES = MAX_INVOICE_FILE_BYTES + 64 * 1024

export const registerMallRoutes = (
  app: Hono,
  authService: AuthService,
  auditRepository: AuditRepository,
  service: MallService,
): void => {
  const denied = async (
    context: Context,
    actorId: string,
    action: string,
    target: string,
  ): Promise<Response> => {
    await writeAuditEvent(auditRepository, { action, actorId, outcome: "denied", target })
    return context.json({ error: "not_found" }, 404)
  }

  const authorizeGroup = async (
    context: Context,
    action: string,
    pageKey: string,
  ): Promise<
    | { readonly groupId: string; readonly principal: SessionPrincipal }
    | { readonly response: Response }
  > => {
    const rawGroupId = context.req.param("groupId")
    const target = `group:${rawGroupId}`
    const authorization = await authorizePageViewRequest(
      context,
      authService,
      auditRepository,
      action,
      target,
      pageKey,
    )
    if (hasPageAuthorizationFailure(authorization)) return authorization
    const group = GroupIdSchema.safeParse(rawGroupId)
    if (
      !group.success ||
      requireGroupAccess(authorization.principal.scope, group.data).kind === "hidden"
    ) {
      return { response: await denied(context, authorization.principal.userId, action, target) }
    }
    return { groupId: group.data, principal: authorization.principal }
  }

  /** 商家接口只对平台方开放；其他人一律返回 404，不暴露接口存在。 */
  const authorizePlatform = async (
    context: Context,
    action: string,
  ): Promise<{ readonly principal: SessionPrincipal } | { readonly response: Response }> => {
    const principal = await sessionPrincipal(context, authService)
    if (principal === null) {
      return { response: context.json({ error: "authentication_required" }, 401) }
    }
    if (!isPlatformScope(principal.scope)) {
      return { response: await denied(context, principal.userId, action, "merchant") }
    }
    return { principal }
  }

  app.get("/api/mall/wallets", async (context) => {
    const principal = await sessionPrincipal(context, authService)
    if (principal === null) return context.json({ error: "authentication_required" }, 401)
    if (!MALL_PAGES.some((page) => canViewPage(principal.scope, page))) {
      return denied(context, principal.userId, "mall.wallet.list", "mall")
    }
    return context.json({ items: await service.listWallets(principal.scope.groupIds) })
  })

  app.get("/api/mall/payment-config", async (context) => {
    const principal = await sessionPrincipal(context, authService)
    if (principal === null) return context.json({ error: "authentication_required" }, 401)
    if (!MALL_PAGES.some((page) => canViewPage(principal.scope, page))) {
      return denied(context, principal.userId, "mall.payment.config", "mall")
    }
    return context.json({ alipay: service.alipayEnabled() })
  })

  /** 平台方能查看任意分组，但只有分组成员才能替分组花钱、充值和开票。 */
  const authorizeMember = async (context: Context, action: string, pageKey: string) => {
    const authorization = await authorizeGroup(context, action, pageKey)
    if ("response" in authorization) return authorization
    const { groupId, principal } = authorization
    if (!principal.scope.groupIds.some((id) => id === groupId)) {
      return {
        response: await denied(context, principal.userId, action, `group:${groupId}`),
      } as const
    }
    return authorization
  }

  app.post("/api/groups/:groupId/mall/recharges", async (context) => {
    const authorization = await authorizeMember(context, "mall.alipay.create", PageKey.MallRecords)
    if ("response" in authorization) return authorization.response
    const input = await parseJson(context.req.raw, AlipayRechargeInputSchema)
    if (input === null) return context.json({ error: "invalid_recharge_request" }, 400)
    return mallResponse(context, async () =>
      context.json(
        await service.createRecharge(authorization.principal.userId, authorization.groupId, input),
        201,
      ),
    )
  })

  app.get("/api/groups/:groupId/mall/recharges/:orderNo", async (context) => {
    const authorization = await authorizeGroup(context, "mall.alipay.status", PageKey.MallRecords)
    if ("response" in authorization) return authorization.response
    return mallResponse(context, async () =>
      context.json(
        await service.rechargeStatus(authorization.groupId, context.req.param("orderNo") ?? ""),
      ),
    )
  })

  // 支付宝的服务器调用这个地址，所以没有登录态，靠验签确认来源。
  app.post("/api/pay/alipay/mall/notify", async (context) => {
    const body = await context.req.parseBody().catch(() => null)
    if (body === null) return context.text("failure")
    const params = Object.fromEntries(
      Object.entries(body).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value]] : [],
      ),
    ) as Record<string, string>
    return context.text(await service.handleAlipayNotify(params))
  })

  app.get("/api/groups/:groupId/mall/invoice-quota", async (context) => {
    const authorization = await authorizeGroup(context, "mall.invoice.quota", PageKey.MallInvoices)
    if ("response" in authorization) return authorization.response
    return context.json(await service.invoiceQuota(authorization.groupId))
  })

  app.get("/api/groups/:groupId/mall/invoices", async (context) => {
    const authorization = await authorizeGroup(context, "mall.invoice.list", PageKey.MallInvoices)
    if ("response" in authorization) return authorization.response
    const query = InvoiceQuerySchema.safeParse(context.req.query())
    return query.success
      ? context.json(await service.listInvoices({ ...query.data, groupId: authorization.groupId }))
      : context.json({ error: "invalid_list_request" }, 400)
  })

  app.post("/api/groups/:groupId/mall/invoices", async (context) => {
    const authorization = await authorizeMember(
      context,
      "mall.invoice.create",
      PageKey.MallInvoices,
    )
    if ("response" in authorization) return authorization.response
    const input = await parseJson(context.req.raw, InvoiceCreateSchema)
    if (input === null) return context.json({ error: "invalid_invoice_request" }, 400)
    return mallResponse(context, async () =>
      context.json(
        await service.createInvoice(authorization.principal.userId, authorization.groupId, input),
        201,
      ),
    )
  })

  app.get("/api/groups/:groupId/mall/invoices/:invoiceId/file", async (context) => {
    const authorization = await authorizeGroup(context, "mall.invoice.file", PageKey.MallInvoices)
    if ("response" in authorization) return authorization.response
    const invoiceId = IdSchema.safeParse(context.req.param("invoiceId"))
    if (!invoiceId.success) return context.json({ error: "invoice_not_found" }, 404)
    return mallResponse(context, async () => {
      const file = await service.invoiceFile(invoiceId.data, authorization.groupId)
      return pdfResponse(file.content, file.fileName)
    })
  })

  app.get("/api/merchant/invoices", async (context) => {
    const authorization = await authorizePlatform(context, "merchant.invoice.list")
    if ("response" in authorization) return authorization.response
    const query = InvoiceQuerySchema.safeParse(context.req.query())
    return query.success
      ? context.json(await service.listInvoices(query.data))
      : context.json({ error: "invalid_list_request" }, 400)
  })

  app.get("/api/merchant/invoices/:invoiceId/file", async (context) => {
    const authorization = await authorizePlatform(context, "merchant.invoice.file")
    if ("response" in authorization) return authorization.response
    const invoiceId = IdSchema.safeParse(context.req.param("invoiceId"))
    if (!invoiceId.success) return context.json({ error: "invoice_not_found" }, 404)
    return mallResponse(context, async () => {
      const file = await service.invoiceFile(invoiceId.data)
      return pdfResponse(file.content, file.fileName)
    })
  })

  app.post("/api/merchant/invoices/:invoiceId/issue", async (context) => {
    const authorization = await authorizePlatform(context, "mall.invoice.issue")
    if ("response" in authorization) return authorization.response
    const invoiceId = IdSchema.safeParse(context.req.param("invoiceId"))
    if (!invoiceId.success) return context.json({ error: "invoice_not_found" }, 404)
    const length = Number(context.req.header("content-length") ?? 0)
    if (length > MAX_ISSUE_BODY_BYTES) return context.json({ error: "invoice_file_too_large" }, 413)
    const body = await context.req.parseBody().catch(() => null)
    const { file: upload, invoiceNumber: rawNumber } = body ?? {}
    const invoiceNumber = InvoiceNumberSchema.safeParse(rawNumber)
    if (!invoiceNumber.success) return context.json({ error: "invalid_invoice_request" }, 400)
    let file = null
    if (upload instanceof File) {
      if (upload.size > MAX_INVOICE_FILE_BYTES) {
        return context.json({ error: "invoice_file_too_large" }, 413)
      }
      const content = new Uint8Array(await upload.arrayBuffer())
      if (!hasPdfHeader(content)) return context.json({ error: "invoice_file_not_pdf" }, 400)
      file = { content, fileName: `发票-${invoiceNumber.data}.pdf` }
    }
    return mallResponse(context, async () =>
      context.json(
        await service.issueInvoice(authorization.principal.userId, invoiceId.data, {
          file,
          invoiceNumber: invoiceNumber.data,
        }),
      ),
    )
  })

  app.post("/api/merchant/invoices/:invoiceId/reject", async (context) => {
    const authorization = await authorizePlatform(context, "mall.invoice.reject")
    if ("response" in authorization) return authorization.response
    const invoiceId = IdSchema.safeParse(context.req.param("invoiceId"))
    if (!invoiceId.success) return context.json({ error: "invoice_not_found" }, 404)
    const input = await parseJson(context.req.raw, InvoiceRejectSchema)
    if (input === null) return context.json({ error: "invalid_invoice_request" }, 400)
    return mallResponse(context, async () =>
      context.json(
        await service.rejectInvoice(authorization.principal.userId, invoiceId.data, input.reason),
      ),
    )
  })

  app.post("/api/merchant/orders/:orderId/refund", async (context) => {
    const authorization = await authorizePlatform(context, "mall.order.refund")
    if ("response" in authorization) return authorization.response
    const orderId = IdSchema.safeParse(context.req.param("orderId"))
    if (!orderId.success) return context.json({ error: "order_not_found" }, 404)
    const input = await parseJson(context.req.raw, RefundOrderInputSchema)
    if (input === null) return context.json({ error: "invalid_refund_request" }, 400)
    return mallResponse(context, async () =>
      context.json(await service.refundOrder(authorization.principal.userId, orderId.data, input)),
    )
  })

  app.get("/api/groups/:groupId/mall/ledger", async (context) => {
    const authorization = await authorizeGroup(context, "mall.ledger.list", PageKey.MallRecords)
    if ("response" in authorization) return authorization.response
    const query = LedgerQuerySchema.safeParse(context.req.query())
    if (!query.success) return context.json({ error: "invalid_list_request" }, 400)
    const page = await service.listLedger({ ...query.data, groupId: authorization.groupId })
    return context.json({ items: page.items.map(forBuyer), total: page.total })
  })

  app.get("/api/groups/:groupId/mall/orders", async (context) => {
    const authorization = await authorizeGroup(context, "mall.order.list", PageKey.MallOrders)
    if ("response" in authorization) return authorization.response
    const query = OrderQuerySchema.safeParse(context.req.query())
    if (!query.success) return context.json({ error: "invalid_list_request" }, 400)
    const page = await service.listOrders({ ...query.data, groupId: authorization.groupId })
    return context.json({ items: page.items.map(orderForBuyer), total: page.total })
  })

  app.get("/api/groups/:groupId/mall/orders/:orderId/items", async (context) => {
    const authorization = await authorizeGroup(context, "mall.order.items", PageKey.MallOrders)
    if ("response" in authorization) return authorization.response
    const orderId = IdSchema.safeParse(context.req.param("orderId"))
    if (!orderId.success) return context.json({ error: "order_not_found" }, 404)
    return mallResponse(context, async () =>
      context.json({
        items: await service.listShipment(authorization.groupId, orderId.data),
      }),
    )
  })

  app.post("/api/groups/:groupId/mall/orders", async (context) => {
    const action = "mall.purchase"
    const authorization = await authorizeGroup(context, action, PageKey.MallRedeem)
    if ("response" in authorization) return authorization.response
    const { groupId, principal } = authorization
    // 平台方能查看任意分组，但只有分组成员才能花这个分组的积分。
    if (!principal.scope.groupIds.some((id) => id === groupId)) {
      return denied(context, principal.userId, action, `group:${groupId}`)
    }
    const input = await parseJson(context.req.raw, PurchaseInputSchema)
    if (input === null) return context.json({ error: "invalid_purchase_request" }, 400)
    return mallResponse(context, async () =>
      context.json(await service.purchase(principal.userId, groupId, input), 201),
    )
  })

  app.get("/api/mall/products", async (context) => {
    const authorization = await authorizePageViewRequest(
      context,
      authService,
      auditRepository,
      "mall.product.list",
      "mall",
      PageKey.MallRedeem,
    )
    if (hasPageAuthorizationFailure(authorization)) return authorization.response
    const query = ProductQuerySchema.safeParse(context.req.query())
    return query.success
      ? context.json(
          await service
            .listProducts({ ...query.data, enabledOnly: true })
            .then((page) => ({ items: page.items.map(productForBuyer), total: page.total })),
        )
      : context.json({ error: "invalid_list_request" }, 400)
  })

  app.get("/api/merchant/products", async (context) => {
    const authorization = await authorizePlatform(context, "merchant.product.list")
    if ("response" in authorization) return authorization.response
    const query = ProductQuerySchema.safeParse(context.req.query())
    return query.success
      ? context.json(await service.listProducts({ ...query.data, enabledOnly: false }))
      : context.json({ error: "invalid_list_request" }, 400)
  })

  app.post("/api/merchant/products", async (context) => {
    const authorization = await authorizePlatform(context, "mall.product.create")
    if ("response" in authorization) return authorization.response
    const input = await parseJson(context.req.raw, ProductCreateSchema)
    if (input === null) return context.json({ error: "invalid_product_request" }, 400)
    return mallResponse(context, async () =>
      context.json(await service.createProduct(authorization.principal.userId, input), 201),
    )
  })

  app.patch("/api/merchant/products/:productId", async (context) => {
    const authorization = await authorizePlatform(context, "mall.product.update")
    if ("response" in authorization) return authorization.response
    const productId = IdSchema.safeParse(context.req.param("productId"))
    if (!productId.success) return context.json({ error: "product_not_found" }, 404)
    const input = await parseJson(context.req.raw, ProductUpdateSchema)
    if (input === null) return context.json({ error: "invalid_product_request" }, 400)
    return mallResponse(context, async () =>
      context.json(
        await service.updateProduct(authorization.principal.userId, productId.data, input),
      ),
    )
  })

  app.get("/api/merchant/orders", async (context) => {
    const authorization = await authorizePlatform(context, "merchant.order.list")
    if ("response" in authorization) return authorization.response
    const query = MerchantOrderQuerySchema.safeParse(context.req.query())
    return query.success
      ? context.json(await service.listOrders(query.data))
      : context.json({ error: "invalid_list_request" }, 400)
  })

  app.post("/api/merchant/orders/:orderId/cancel", async (context) => {
    const authorization = await authorizePlatform(context, "mall.order.cancel")
    if ("response" in authorization) return authorization.response
    const orderId = IdSchema.safeParse(context.req.param("orderId"))
    if (!orderId.success) return context.json({ error: "order_not_found" }, 404)
    const input = await parseJson(context.req.raw, CancelOrderInputSchema)
    if (input === null) return context.json({ error: "invalid_cancel_request" }, 400)
    return mallResponse(context, async () =>
      context.json(
        await service.cancelOrder(authorization.principal.userId, orderId.data, input.reason),
      ),
    )
  })

  app.post("/api/merchant/orders/:orderId/ship", async (context) => {
    const authorization = await authorizePlatform(context, "mall.order.ship")
    if ("response" in authorization) return authorization.response
    const orderId = IdSchema.safeParse(context.req.param("orderId"))
    if (!orderId.success) return context.json({ error: "order_not_found" }, 404)
    const input = await parseJson(context.req.raw, ShipOrderInputSchema)
    if (input === null) return context.json({ error: "invalid_ship_request" }, 400)
    return mallResponse(context, async () =>
      context.json(await service.shipOrder(authorization.principal.userId, orderId.data, input)),
    )
  })

  for (const [path, kind] of [
    ["accounts", "account"],
    ["proxies", "proxy"],
  ] as const) {
    app.get(`/api/merchant/transferable/${path}`, async (context) => {
      const authorization = await authorizePlatform(context, `merchant.${kind}.list`)
      if ("response" in authorization) return authorization.response
      const query = TransferableQuerySchema.safeParse(context.req.query())
      return query.success
        ? context.json(await service.listTransferable(kind, query.data))
        : context.json({ error: "invalid_list_request" }, 400)
    })
  }

  app.get("/api/merchant/transfers", async (context) => {
    const authorization = await authorizePlatform(context, "merchant.transfer.list")
    if ("response" in authorization) return authorization.response
    const query = TransferRecordQuerySchema.safeParse(context.req.query())
    return query.success
      ? context.json(await service.listTransfers(query.data))
      : context.json({ error: "invalid_list_request" }, 400)
  })

  app.post("/api/merchant/transfers", async (context) => {
    const authorization = await authorizePlatform(context, "mall.resource.transfer")
    if ("response" in authorization) return authorization.response
    const input = await parseJson(context.req.raw, TransferInputSchema)
    if (input === null) return context.json({ error: "invalid_transfer_request" }, 400)
    return mallResponse(context, async () =>
      context.json(await service.transfer(authorization.principal.userId, input)),
    )
  })

  app.get("/api/merchant/wallets", async (context) => {
    const authorization = await authorizePlatform(context, "merchant.wallet.list")
    if ("response" in authorization) return authorization.response
    const query = WalletQuerySchema.safeParse(context.req.query())
    return query.success
      ? context.json(await service.listAllWallets(query.data))
      : context.json({ error: "invalid_list_request" }, 400)
  })

  app.get("/api/merchant/ledger", async (context) => {
    const authorization = await authorizePlatform(context, "merchant.ledger.list")
    if ("response" in authorization) return authorization.response
    const query = MerchantLedgerQuerySchema.safeParse(context.req.query())
    return query.success
      ? context.json(await service.listLedger(query.data))
      : context.json({ error: "invalid_list_request" }, 400)
  })

  app.post("/api/merchant/recharges", async (context) => {
    const authorization = await authorizePlatform(context, "mall.recharge")
    if ("response" in authorization) return authorization.response
    const input = await parseJson(context.req.raw, RechargeInputSchema)
    if (input === null) return context.json({ error: "invalid_recharge_request" }, 400)
    return mallResponse(context, async () =>
      context.json(await service.recharge(authorization.principal.userId, input), 201),
    )
  })

  app.post("/api/merchant/wallet-adjustments", async (context) => {
    const authorization = await authorizePlatform(context, "mall.adjust")
    if ("response" in authorization) return authorization.response
    const input = await parseJson(context.req.raw, AdjustInputSchema)
    if (input === null) return context.json({ error: "invalid_adjust_request" }, 400)
    return mallResponse(context, async () =>
      context.json(await service.adjust(authorization.principal.userId, input), 201),
    )
  })
}
