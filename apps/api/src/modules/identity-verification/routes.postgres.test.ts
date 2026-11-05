import { afterEach, expect, it } from "bun:test"
import { Hono } from "hono"
import { hasConfiguredTestDatabase, type MigratedTestDatabase } from "../../db/test-database"
import { Role } from "../../lib/authorization"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import { registerIdentityRoutes } from "./routes"
import { firstUserId, platformId, setupIdentity } from "./test-fixtures"
import { ConsentVersion } from "./types"

const integration = hasConfiguredTestDatabase ? it : it.skip
let database: MigratedTestDatabase | null = null
afterEach(async () => {
  await database?.close()
  database = null
})
const setup = async () => {
  const fixture = await setupIdentity()
  database = fixture.database
  const authService = createAuthService(
    createInMemoryAuthRepository([
      {
        id: firstUserId,
        email: "first@test.test",
        password: "pw",
        role: Role.Administrator,
        groupIds: [],
        permissions: [],
      },
      {
        id: platformId,
        email: "platform@test.test",
        password: "pw",
        role: Role.Administrator,
        groupIds: [],
        permissions: [],
      },
    ]),
    async (a, b) => a === b,
  )
  const login = await authService.login({ email: "first@test.test", password: "pw" })
  if (login.kind !== "authenticated") throw new Error("fixture login failed")
  const app = new Hono()
  registerIdentityRoutes(app, { authService, service: fixture.service })
  const cookie = `tk_mg_session=${login.sessionToken}`
  const form = () => {
    const body = new FormData()
    body.set("frontImage", new File([fixture.bytes], "front.png", { type: "image/png" }))
    body.set("consentAccepted", "true")
    body.set("consentVersion", ConsentVersion)
    return body
  }
  return { ...fixture, app, cookie, form }
}
integration("requires authentication before returning identity state", async () => {
  // Given
  const { app } = await setup()
  // When
  const response = await app.request("/api/identity-verification/me")
  // Then
  expect(response.status).toBe(401)
  expect(response.headers.get("cache-control")).toBe("no-store")
})
integration("blocks init-tool administrators from platform identity list", async () => {
  // Given
  const { app, cookie } = await setup()
  // When
  const response = await app.request("/api/platform/identity-verifications", {
    headers: { cookie },
  })
  // Then
  expect(response.status).toBe(403)
  expect(response.headers.get("cache-control")).toBe("no-store")
})
integration("rejects a foreign Origin before a paid attempt", async () => {
  // Given
  const { app, cookie, form, calls } = await setup()
  // When
  const response = await app.request("http://localhost/api/identity-verification/attempts", {
    method: "POST",
    headers: { cookie, origin: "https://evil.example", "Idempotency-Key": "attempt-http" },
    body: form(),
  })
  // Then
  expect(response.status).toBe(403)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(calls()).toBe(0)
})
integration("verifies through HTTP and exposes only masked identity", async () => {
  // Given
  const { app, cookie, form } = await setup()
  // When
  const response = await app.request("http://localhost/api/identity-verification/attempts", {
    method: "POST",
    headers: { cookie, origin: "http://localhost", "Idempotency-Key": "attempt-http" },
    body: form(),
  })
  const state = await app.request("/api/identity-verification/me", { headers: { cookie } })
  // Then
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(state.headers.get("cache-control")).toBe("no-store")
  const text = await state.text()
  expect(text).toContain('"status":"verified"')
  expect(text).not.toContain("11010519491231002X")
  expect(text).not.toContain("张三")
  expect(text).not.toContain("encrypted")
  expect(text).not.toContain("hmac")
})
