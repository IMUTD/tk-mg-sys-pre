import { expect, test } from "bun:test"
import sharp from "sharp"
import { z } from "zod"
import { createProductionApp } from "./composition"
import {
  createMigratedTestDatabase,
  getTestDatabaseUrl,
  hasConfiguredTestDatabase,
} from "./db/test-database"
import { parseIdentityConfig } from "./modules/identity-verification/config"
import { ConsentVersion } from "./modules/identity-verification/types"

const integrationTest = hasConfiguredTestDatabase ? test : test.skip

integrationTest(
  "real production assembly gates late routes and revokes all sessions after unbind",
  async () => {
    const db = await createMigratedTestDatabase()
    const tenantId = "11111111-1111-4111-8111-111111111111"
    const platformId = "22222222-2222-4222-8222-222222222222"
    const password = "identity-test-password"
    const hash = await Bun.password.hash(password)
    await db.client`insert into app_user(id,email,password_hash,role,provisioned_by) values
    (${tenantId},'tenant@example.test',${hash},'administrator','init-tool'),
    (${platformId},'platform@example.test',${hash},'administrator','sys')`
    await db.client`update app_user set is_platform = true where id = ${platformId}`
    let calls = 0
    const runtime = createProductionApp({
      databaseUrl: getTestDatabaseUrl(),
      redisUrl: "redis://127.0.0.1:6379",
      secretEncryptionKey: "12345678901234567890123456789012",
      systemActorId: platformId,
      authCookieSecure: false,
      identity: parseIdentityConfig({
        ADMIN_IDENTITY_MODE: "enforced",
        IDENTITY_HMAC_KEY: "12345678901234567890123456789012",
        ALIBABA_CLOUD_ACCESS_KEY_ID: "fixture",
        ALIBABA_CLOUD_ACCESS_KEY_SECRET: "fixture",
      }),
      identityProvider: {
        verify: async () => {
          calls += 1
          return {
            status: "verified",
            name: "测试",
            number: "11010519491231002X",
            code: "200",
            bizCode: "1",
            requestId: "synthetic-provider",
          }
        },
      },
    })
    const app = runtime.app
    const login = async (email: string) => {
      const response = await app.request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      expect(response.status).toBe(200)
      return response.headers.get("set-cookie")?.split(";")[0] ?? ""
    }
    try {
      const cookie = await login("tenant@example.test")
      const anotherSession = await login("tenant@example.test")
      for (const path of [
        "/api/box-service/orders",
        "/api/tasks",
        "/api/groups/33333333-3333-4333-8333-333333333333/dispatches",
      ]) {
        const response = await app.request(path, { method: "POST", headers: { cookie } })
        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({ error: "identity_verification_required" })
      }
      const before = await app.request("/api/auth/session", { headers: { cookie } })
      expect(await before.json()).toMatchObject({
        user: { isPlatformAdmin: false, identity: { required: true, canAccessBusiness: false } },
      })
      const image = await sharp({
        create: { width: 100, height: 100, channels: 3, background: "white" },
      })
        .png()
        .toBuffer()
      const form = new FormData()
      form.append("frontImage", new File([image], "synthetic.png", { type: "image/png" }))
      form.append("consentVersion", ConsentVersion)
      form.append("consentAccepted", "true")
      const verified = await app.request("http://localhost/api/identity-verification/attempts", {
        method: "POST",
        headers: { cookie, Origin: "http://localhost", "Idempotency-Key": crypto.randomUUID() },
        body: form,
      })
      expect(verified.status).toBe(200)
      expect(await verified.json()).toMatchObject({ attempt: { status: "verified" } })
      const state = await app.request("/api/identity-verification/me", { headers: { cookie } })
      const summary = z
        .object({ version: z.number(), canAccessBusiness: z.boolean() })
        .parse(await state.json())
      expect(summary.canAccessBusiness).toBe(true)
      const platform = await login("platform@example.test")
      const unbound = await app.request(
        `http://localhost/api/platform/identity-verifications/${tenantId}/unbind`,
        {
          method: "POST",
          headers: {
            cookie: platform,
            Origin: "http://localhost",
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            expectedVersion: summary.version,
            reason: "测试解绑",
            operatorPassword: password,
          }),
        },
      )
      expect(unbound.status).toBe(200)
      for (const oldCookie of [cookie, anotherSession])
        expect(
          (await app.request("/api/auth/session", { headers: { cookie: oldCookie } })).status,
        ).toBe(401)
      expect(
        (await app.request("/api/auth/session", { headers: { cookie: platform } })).status,
      ).toBe(200)
      expect(calls).toBe(1)
      expect((await app.request("/agent/heartbeat", { method: "POST" })).status).toBe(401)
      expect((await app.request("/api/pay/alipay/notify", { method: "POST" })).status).not.toBe(403)
    } finally {
      await runtime.close()
      await db.close()
    }
  },
  15_000,
)
