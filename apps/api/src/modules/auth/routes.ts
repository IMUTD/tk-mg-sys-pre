import type { Hono } from "hono"
import { getCookie, setCookie } from "hono/cookie"
import { z } from "zod"

import type { AuthService } from "./service"

const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

type LoginRequest = z.infer<typeof LoginRequestSchema>

const SessionCookieName = "tk_mg_session"

const authenticationRequired = { error: "authentication_required" } as const

const readLoginRequest = async (request: Request): Promise<LoginRequest | null> => {
  try {
    const parsed = LoginRequestSchema.safeParse(await request.json())
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

export const registerAuthRoutes = (
  app: Hono,
  authService: AuthService,
  secureCookie = true,
): void => {
  app.post("/api/auth/login", async (context) => {
    const request = await readLoginRequest(context.req.raw)
    if (request === null) {
      return context.json({ error: "invalid_login_request" }, 400)
    }

    const result = await authService.login(request)
    switch (result.kind) {
      case "authenticated":
        setCookie(context, SessionCookieName, result.sessionToken, {
          httpOnly: true,
          maxAge: 60 * 60 * 8,
          path: "/",
          sameSite: "Strict",
          secure: secureCookie,
        })
        return context.json({ user: result.principal })
      case "invalid_credentials":
        return context.json({ error: "invalid_credentials" }, 401)
    }
  })

  app.post("/api/auth/logout", async (context) => {
    const sessionToken = getCookie(context, SessionCookieName)
    if (sessionToken !== undefined) {
      await authService.logout(sessionToken)
    }
    setCookie(context, SessionCookieName, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "Strict",
      secure: secureCookie,
    })
    return context.body(null, 204)
  })

  app.get("/api/auth/session", async (context) => {
    const sessionToken = getCookie(context, SessionCookieName)
    if (sessionToken === undefined) {
      return context.json(authenticationRequired, 401)
    }

    const principal = await authService.session(sessionToken)
    if (principal === null) {
      return context.json(authenticationRequired, 401)
    }
    return context.json({ user: principal })
  })
}
