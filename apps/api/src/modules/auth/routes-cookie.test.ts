import { describe, expect, it } from "bun:test"
import { Hono } from "hono"

import { Role } from "../../lib/authorization"
import { registerAuthRoutes } from "./routes"
import { createAuthService, createInMemoryAuthRepository } from "./service"

describe("deployment session cookies", () => {
  for (const secure of [true, false]) {
    it(`supports login, session and logout with secure=${secure}`, async () => {
      const repository = createInMemoryAuthRepository([
        {
          email: "admin@example.com",
          groupIds: [],
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          password: "test-password",
          permissions: [],
          role: Role.Administrator,
        },
      ])
      const app = new Hono()
      registerAuthRoutes(
        app,
        createAuthService(repository, async (password, hash) => password === hash),
        secure,
      )
      const login = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com", password: "test-password" }),
      })
      expect(login.status).toBe(200)
      const cookie = login.headers.get("set-cookie") ?? ""
      expect(cookie.includes("; Secure")).toBe(secure)
      expect(cookie).toContain("HttpOnly")
      expect(cookie).toContain("SameSite=Strict")
      const headers = { Cookie: cookie.split(";")[0] ?? "" }
      expect((await app.request("/api/auth/session", { headers })).status).toBe(200)
      const logout = await app.request("/api/auth/logout", { method: "POST", headers })
      expect(logout.headers.get("set-cookie")?.includes("; Secure")).toBe(secure)
      expect((await app.request("/api/auth/session", { headers })).status).toBe(401)
    })
  }
})
