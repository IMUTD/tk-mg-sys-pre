import { createProductionApp } from "../../apps/api/src/composition"
import { createMigratedTestDatabase, getTestDatabaseUrl } from "../../apps/api/src/db/test-database"
import { parseIdentityConfig } from "../../apps/api/src/modules/identity-verification/config"

// Local acceptance fixture: isolated tk_mg_test_* database and synthetic provider only.
const database = await createMigratedTestDatabase()
const platform = "22222222-2222-4222-8222-222222222222"
const tenant = "11111111-1111-4111-8111-111111111111"
const systemActor = "99999999-9999-4999-8999-999999999999"
const group = "33333333-3333-4333-8333-333333333333"
const passwordHash = await Bun.password.hash("identity-fixture-only")
await database.client`insert into app_user(id,email,display_name,password_hash,role,provisioned_by,enabled,is_platform) values
  (${tenant},'tenant@identity.test','测试管理员',${passwordHash},'administrator','init-tool',true,false),
  (${platform},'platform@identity.test','测试平台',${passwordHash},'administrator','sys',true,true),
  (${systemActor},'system@identity.test','系统审计',${passwordHash},'administrator','sys',false,false)`
await database.client`insert into access_group(id,name) values(${group},'identity-fixture')`
await database.client`insert into user_group(user_id,group_id) values(${tenant},${group}),(${platform},${group})`
const application = createProductionApp({
  databaseUrl: getTestDatabaseUrl(),
  redisUrl: "redis://127.0.0.1:6379",
  secretEncryptionKey: "12345678901234567890123456789012",
  systemActorId: systemActor,
  authCookieSecure: false,
  identity: parseIdentityConfig({
    ADMIN_IDENTITY_MODE: "enforced",
    ALIBABA_CLOUD_ACCESS_KEY_ID: "synthetic-fixture",
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: "synthetic-fixture",
    IDENTITY_HMAC_KEY: "12345678901234567890123456789012",
  }),
  identityProvider: {
    verify: async () => ({
      status: "verified",
      name: "测试",
      number: "11010519491231002X",
      code: "200",
      bizCode: "1",
      requestId: "synthetic-browser-result",
    }),
  },
})
const server = Bun.serve({ hostname: "127.0.0.1", port: 3017, fetch: application.app.fetch })
console.log("Identity browser fixture listening on loopback port 3017; provider is synthetic")
const stop = async () => {
  server.stop(true)
  await application.close()
  await database.close()
}
process.once("SIGTERM", () => {
  void stop()
})
process.once("SIGINT", () => {
  void stop()
})
