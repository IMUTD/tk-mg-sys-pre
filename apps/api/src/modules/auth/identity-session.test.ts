import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { registerIdentityGate } from "../access/identity-gate"
import { withIdentityAccess } from "./identity-session"
import { createAuthService, createInMemoryAuthRepository } from "./service"

const userId = "10000000-0000-4000-8000-000000000001"
const access = {
  mode: "enforced" as const,
  required: true,
  canVerify: true,
  status: "unverified" as const,
  canAccessBusiness: false,
  version: 0,
  isPlatformAdmin: false,
}
const setup = async () => {
  const base = createAuthService(
    createInMemoryAuthRepository([
      {
        id: userId,
        email: "admin@example.test",
        password: "test",
        role: "administrator",
        groupIds: [],
        permissions: [],
      },
    ]),
    async (input, stored) => input === stored,
  )
  const auth = withIdentityAccess(base, async () => access)
  const login = await auth.login({ email: "admin@example.test", password: "test" })
  if (login.kind !== "authenticated") throw new Error("Fixture failed to log in")
  return { auth, login, cookie: `tk_mg_session=${login.sessionToken}` }
}

describe("identity session and backend gate", () => {
  test("adds server-derived identity status to login and session", async () => {
    const { auth, login } = await setup()
    expect(login.principal.identity).toEqual(access)
    expect((await auth.session(login.sessionToken))?.identity).toEqual(access)
  })

  test("blocks a business route registered after the gate", async () => {
    const { auth, cookie } = await setup()
    const app = new Hono()
    registerIdentityGate(app, auth)
    app.post("/api/box-service/orders", (c) => c.json({ created: true }))
    const response = await app.request("/api/box-service/orders", {
      method: "POST",
      headers: { cookie },
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: "identity_verification_required" })
  })

  test("keeps authentication, identity and signed payment callback routes reachable", async () => {
    const { auth, cookie } = await setup()
    const app = new Hono()
    registerIdentityGate(app, auth)
    for (const path of [
      "/api/auth/login",
      "/api/auth/logout",
      "/api/pay/alipay/notify",
      "/api/identity-verification/attempts",
    ])
      app.post(path, (c) => c.json({ reached: true }))
    app.get("/api/identity-verification/me", (c) => c.json({ reached: true }))
    for (const path of [
      "/api/auth/login",
      "/api/auth/logout",
      "/api/pay/alipay/notify",
      "/api/identity-verification/attempts",
    ])
      expect((await app.request(path, { method: "POST", headers: { cookie } })).status).toBe(200)
    expect(
      (await app.request("/api/identity-verification/me", { headers: { cookie } })).status,
    ).toBe(200)
  })

  test("does not exempt arbitrary notify paths or different methods", async () => {
    const { auth, cookie } = await setup()
    const app = new Hono()
    registerIdentityGate(app, auth)
    app.post("/api/tasks/notify", (c) => c.json({ reached: true }))
    app.get("/api/pay/alipay/notify", (c) => c.json({ reached: true }))
    expect(
      (await app.request("/api/tasks/notify", { method: "POST", headers: { cookie } })).status,
    ).toBe(403)
    expect((await app.request("/api/pay/alipay/notify", { headers: { cookie } })).status).toBe(403)
  })

  test("never applies human identity rules to agent callbacks", async () => {
    const { auth } = await setup()
    const app = new Hono()
    registerIdentityGate(app, auth)
    app.post("/agent/heartbeat", (c) => c.json({ reached: true }))
    expect((await app.request("/agent/heartbeat", { method: "POST" })).status).toBe(200)
  })

  test("rechecks access on every session request instead of trusting login state", async () => {
    const { auth, login, cookie } = await setup()
    let allowed = true
    const dynamic = withIdentityAccess(auth, async () => ({
      ...access,
      canAccessBusiness: allowed,
    }))
    const app = new Hono()
    registerIdentityGate(app, dynamic)
    app.get("/api/tasks", (c) => c.json({ reached: true }))
    expect((await app.request("/api/tasks", { headers: { cookie } })).status).toBe(200)
    allowed = false
    expect((await app.request("/api/tasks", { headers: { cookie } })).status).toBe(403)
    await dynamic.logout(login.sessionToken)
    expect((await app.request("/api/tasks", { headers: { cookie } })).status).toBe(401)
  })
})
