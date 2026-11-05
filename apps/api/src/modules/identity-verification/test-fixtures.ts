import sharp from "sharp"
import { createMigratedTestDatabase } from "../../db/test-database"
import { UserIdSchema } from "../../lib/authorization"
import { createSecretCipher } from "../../lib/crypto"
import { parseIdentityConfig } from "./config"
import { createIdentityService } from "./service"
import { ConsentVersion, type IdentityProvider } from "./types"
export const firstUserId = UserIdSchema.parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
export const secondUserId = UserIdSchema.parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
export const platformId = UserIdSchema.parse("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
export const setupIdentity = async (provider?: IdentityProvider, clock?: () => Date) => {
  const database = await createMigratedTestDatabase()
  const sql = database.client
  const hash = await Bun.password.hash("operator-password")
  await sql`insert into app_user(id,email,password_hash,role,provisioned_by) values (${firstUserId},'first@test.test',${hash},'administrator','init-tool'),(${secondUserId},'second@test.test',${hash},'administrator','init-tool'),(${platformId},'platform@test.test',${hash},'administrator','sys')`
  const config = parseIdentityConfig({
    ADMIN_IDENTITY_MODE: "enforced",
    ALIBABA_CLOUD_ACCESS_KEY_ID: "test",
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: "test",
    IDENTITY_HMAC_KEY: "0123456789abcdef0123456789abcdef",
  })
  let calls = 0
  const service = createIdentityService({
    sql,
    config,
    ...(clock ? { clock } : {}),
    cipher: createSecretCipher("0123456789abcdef0123456789abcdef"),
    provider: provider ?? {
      verify: async () => {
        calls++
        return {
          status: "verified",
          name: "张三",
          number: "11010519491231002X",
          code: "200",
          bizCode: "1",
          requestId: "test-request",
        }
      },
    },
  })
  const bytes = await sharp({
    create: { width: 65, height: 100, channels: 3, background: "white" },
  })
    .png()
    .toBuffer()
  const submit = (userId = firstUserId, key = "first-attempt") =>
    service.submit({
      userId,
      idempotencyKey: key,
      frontImage: new File([bytes], "front.png", { type: "image/png" }),
      consentVersion: ConsentVersion,
      consentAccepted: true,
    })
  return { database, sql, service, submit, calls: () => calls, bytes }
}
