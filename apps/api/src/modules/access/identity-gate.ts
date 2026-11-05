import type { Hono } from "hono"
import { getCookie } from "hono/cookie"
import { IdentityAccessUnavailableError } from "../auth/identity-session"
import type { AuthService } from "../auth/service"

const exemptions = new Set([
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "GET /api/auth/session",
  "POST /api/pay/alipay/notify",
  "GET /api/identity-verification/me",
  "POST /api/identity-verification/attempts",
  "GET /api/platform/identity-verifications",
])

const uuid = "[0-9a-fA-F-]{36}"
const attemptPath = new RegExp(`^/api/identity-verification/attempts/${uuid}$`)
const historyPath = new RegExp(`^/api/platform/identity-verifications/${uuid}/attempts$`)
const unbindPath = new RegExp(`^/api/platform/identity-verifications/${uuid}/unbind$`)

export const registerIdentityGate = (app: Hono, auth: AuthService): void => {
  app.use("/api/*", async (context, next) => {
    const { method, path } = context.req
    if (
      exemptions.has(`${method} ${path}`) ||
      (method === "GET" && (attemptPath.test(path) || historyPath.test(path))) ||
      (method === "POST" && unbindPath.test(path))
    )
      return next()
    const token = getCookie(context, "tk_mg_session")
    if (token === undefined) return context.json({ error: "authentication_required" }, 401)
    try {
      const principal = await auth.session(token)
      if (principal === null) return context.json({ error: "authentication_required" }, 401)
      if (principal.identity?.canAccessBusiness === false)
        return context.json({ error: "identity_verification_required" }, 403)
    } catch (error) {
      if (error instanceof IdentityAccessUnavailableError)
        return context.json({ error: "identity_access_unavailable" }, 503)
      throw error
    }
    return next()
  })
}
