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
  CancelOrderInputSchema,
  type LedgerEntry,
  LedgerQuerySchema,
  MallError,
  type MallErrorCode,
  type MallOrder,
  MerchantLedgerQuerySchema,
  MerchantOrderQuerySchema,
  OrderQuerySchema,
  ProductCreateSchema,
  ProductQuerySchema,
  ProductUpdateSchema,
  PurchaseInputSchema,
  RechargeInputSchema,
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
  "order_not_found",
  "product_not_found",
]

const statusFor = (code: MallErrorCode): 404 | 409 => (NOT_FOUND_CODES.includes(code) ? 404 : 409)

const mallResponse = async (context: Context, run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run()
  } catch (error) {
    if (error instanceof MallError) {
      return context.json({ error: error.code }, statusFor(error.code))
    }
    throw error
  }
}

/** 买家不需要知道是哪位平台人员操作的。 */
const forBuyer = ({ actorName: _actorName, ...entry }: LedgerEntry) => entry

const orderForBuyer = ({ buyerName: _buyerName, ...order }: MallOrder) => order

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
      ? context.json(await service.listProducts({ ...query.data, enabledOnly: true }))
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
