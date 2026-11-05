import type { Context, Handler, Hono } from "hono"
import { getCookie } from "hono/cookie"
import { z } from "zod"
import { type UserId, UserIdSchema } from "../../lib/authorization"
import type { AuthService } from "../auth/service"
import {
  listQuerySchema,
  readBoundedBody,
  readIdentityMultipart,
  requireSameOrigin,
} from "./http-input"
import { IdentityError, type IdentityService } from "./types"
import { unbindSchema } from "./unbind"

export const registerIdentityRoutes = (
  app: Hono,
  dependencies: { readonly authService: AuthService; readonly service: IdentityService },
): void => {
  const { authService, service } = dependencies
  const endpoint =
    (handler: (context: Context, userId: UserId) => Promise<Response>): Handler =>
    async (context) => {
      context.header("Cache-Control", "no-store")
      try {
        const token = getCookie(context, "tk_mg_session")
        const principal = token ? await authService.session(token) : null
        if (!principal) throw new IdentityError("authentication_required", 401)
        if (context.req.method === "POST") requireSameOrigin(context.req.raw)
        return await handler(context, principal.userId)
      } catch (error) {
        if (error instanceof IdentityError)
          return context.json(
            { error: error.code, ...(error.attemptId ? { attemptId: error.attemptId } : {}) },
            error.status,
          )
        if (
          error instanceof z.ZodError ||
          error instanceof SyntaxError ||
          error instanceof TypeError
        )
          return context.json({ error: "invalid_request" }, 400)
        // Unexpected storage failures are never serialized with query parameters or raw provider data.
        if (error instanceof Error) return context.json({ error: "identity_unavailable" }, 503)
        throw error
      }
    }
  app.get(
    "/api/identity-verification/me",
    endpoint(async (context, userId) => context.json(await service.getMe(userId))),
  )
  app.post(
    "/api/identity-verification/attempts",
    endpoint(async (context, userId) => {
      const form = await readIdentityMultipart(context.req.raw)
      const attempt = await service.submit({
        ...form,
        userId,
        idempotencyKey: context.req.header("Idempotency-Key") ?? "",
      })
      return context.json({ attempt }, attempt.status === "verifying" ? 202 : 200)
    }),
  )
  app.get(
    "/api/identity-verification/attempts/:id",
    endpoint(async (context, userId) =>
      context.json({
        attempt: await service.getAttempt(userId, z.uuid().parse(context.req.param("id"))),
      }),
    ),
  )
  app.get(
    "/api/platform/identity-verifications",
    endpoint(async (context, actorId) =>
      context.json(await service.list(actorId, listQuerySchema.parse(context.req.query()))),
    ),
  )
  app.get(
    "/api/platform/identity-verifications/:userId/attempts",
    endpoint(async (context, actorId) =>
      context.json({
        attempts: await service.listAttempts(
          actorId,
          UserIdSchema.parse(context.req.param("userId")),
        ),
        unbindings: await service.listUnbindings(
          actorId,
          UserIdSchema.parse(context.req.param("userId")),
        ),
      }),
    ),
  )
  app.post(
    "/api/platform/identity-verifications/:userId/unbind",
    endpoint(async (context, actorId) => {
      const bytes = await readBoundedBody(context.req.raw)
      const body = unbindSchema.parse(JSON.parse(new TextDecoder().decode(bytes)))
      return context.json(
        await service.unbind({
          ...body,
          actorId,
          userId: UserIdSchema.parse(context.req.param("userId")),
          idempotencyKey: context.req.header("Idempotency-Key") ?? "",
        }),
      )
    }),
  )
}
