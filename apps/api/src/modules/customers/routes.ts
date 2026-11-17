import type { Context, Hono } from "hono"
import { z } from "zod"

import { isPlatformScope } from "../../lib/authorization"
import { sessionPrincipal } from "../access/page-authorization"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import type { AuthService, SessionPrincipal } from "../auth/service"
import { CustomerConflictError, type CustomerRepository } from "./repository"

export const CustomerCreateSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
})

export const CustomerUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    password: z.string().min(8).max(128).optional(),
  })
  .refine((input) => input.enabled !== undefined || input.password !== undefined)

const CustomerIdSchema = z.string().uuid()

const readJson = async <T>(request: Request, schema: z.ZodType<T>): Promise<T | null> => {
  const body: unknown = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  return parsed.success ? parsed.data : null
}

/** 客户管理只对平台方开放；其他人一律 404，不暴露接口存在。 */
export const registerCustomerRoutes = (
  app: Hono,
  authService: AuthService,
  auditRepository: AuditRepository,
  repository: CustomerRepository,
): void => {
  const authorizePlatform = async (
    context: Context,
    action: string,
  ): Promise<{ readonly principal: SessionPrincipal } | { readonly response: Response }> => {
    const principal = await sessionPrincipal(context, authService)
    if (principal === null) {
      return { response: context.json({ error: "authentication_required" }, 401) }
    }
    if (!isPlatformScope(principal.scope)) {
      await writeAuditEvent(auditRepository, {
        action,
        actorId: principal.userId,
        outcome: "denied",
        target: "customers",
      })
      return { response: context.json({ error: "not_found" }, 404) }
    }
    return { principal }
  }

  app.get("/api/customers", async (context) => {
    const authorization = await authorizePlatform(context, "customer.list")
    if ("response" in authorization) return authorization.response
    return context.json({ items: await repository.list() })
  })

  app.post("/api/customers", async (context) => {
    const authorization = await authorizePlatform(context, "customer.create")
    if ("response" in authorization) return authorization.response
    const input = await readJson(context.req.raw, CustomerCreateSchema)
    if (input === null) return context.json({ error: "invalid_customer_request" }, 400)
    try {
      const customer = await repository.create({
        displayName: input.displayName,
        email: input.email,
        passwordHash: await Bun.password.hash(input.password),
        platformUserId: authorization.principal.userId,
      })
      await writeAuditEvent(auditRepository, {
        action: "customer.create",
        actorId: authorization.principal.userId,
        outcome: "allowed",
        target: `member:${customer.id}`,
      })
      return context.json(customer, 201)
    } catch (error) {
      if (error instanceof CustomerConflictError) return context.json({ error: error.code }, 409)
      throw error
    }
  })

  app.patch("/api/customers/:customerId", async (context) => {
    const authorization = await authorizePlatform(context, "customer.update")
    if ("response" in authorization) return authorization.response
    const customerId = CustomerIdSchema.safeParse(context.req.param("customerId"))
    if (!customerId.success) return context.json({ error: "not_found" }, 404)
    const input = await readJson(context.req.raw, CustomerUpdateSchema)
    if (input === null) return context.json({ error: "invalid_customer_request" }, 400)
    const customer = await repository.update(customerId.data, {
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.password === undefined
        ? {}
        : { passwordHash: await Bun.password.hash(input.password) }),
    })
    if (customer === null) return context.json({ error: "not_found" }, 404)
    await writeAuditEvent(auditRepository, {
      action: input.password === undefined ? "customer.update" : "customer.password.reset",
      actorId: authorization.principal.userId,
      outcome: "allowed",
      target: `member:${customer.id}`,
    })
    return context.json(customer)
  })
}
