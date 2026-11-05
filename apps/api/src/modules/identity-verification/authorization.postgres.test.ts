import { afterEach, expect, it } from "bun:test"
import { hasConfiguredTestDatabase, type MigratedTestDatabase } from "../../db/test-database"
import { firstUserId, platformId, secondUserId, setupIdentity } from "./test-fixtures"

const integration = hasConfiguredTestDatabase ? it : it.skip
let database: MigratedTestDatabase | null = null
afterEach(async () => {
  await database?.close()
  database = null
})
const setup = async () => {
  const fixture = await setupIdentity()
  database = fixture.database
  return fixture
}
const unbind = {
  actorId: platformId,
  userId: firstUserId,
  idempotencyKey: "unbind-first",
  expectedVersion: 1,
  reason: "账户转交",
  operatorPassword: "operator-password",
}
for (const target of ["platform", "member"] as const) {
  integration(
    `rejects ${target} targets without revoking sessions or creating identity rows`,
    async () => {
      // Given
      const { service, sql } = await setup()
      const userId = target === "platform" ? platformId : secondUserId
      if (target === "member") await sql`update app_user set role='operator' where id=${userId}`
      await sql`insert into app_session(id,user_id,token_hash,expires_at) values (${crypto.randomUUID()},${userId},'target-session',now()+interval '1 day')`
      // When / Then
      await expect(service.unbind({ ...unbind, userId, expectedVersion: 0 })).rejects.toMatchObject(
        { code: "forbidden", status: 403 },
      )
      expect(
        await sql`select id from app_session where user_id=${userId} and revoked_at is null`,
      ).toHaveLength(1)
      expect(
        await sql`select user_id from admin_identity_verification where user_id=${userId}`,
      ).toHaveLength(0)
    },
  )
}
integration("permits platform unbinding for a disabled init-tool administrator", async () => {
  // Given
  const { service, sql, submit } = await setup()
  await submit()
  await sql`update app_user set enabled=false where id=${firstUserId}`
  // When
  const result = await service.unbind(unbind)
  // Then
  expect(result.status).toBe("unbound")
})
integration("rejects init-tool and disabled operators from unbinding", async () => {
  // Given
  const { service, sql, submit } = await setup()
  await submit()
  // When / Then
  await expect(service.unbind({ ...unbind, actorId: secondUserId })).rejects.toMatchObject({
    code: "forbidden",
  })
  await sql`update app_user set enabled=false where id=${platformId}`
  await expect(service.unbind(unbind)).rejects.toMatchObject({ code: "forbidden" })
  expect(
    (
      await sql<
        { readonly status: string }[]
      >`select status from admin_identity_verification where user_id=${firstUserId}`
    )[0]?.status,
  ).toBe("verified")
})
integration("includes safe unbind history after identity fields are removed", async () => {
  // Given
  const { submit, service } = await setup()
  await submit()
  await service.unbind(unbind)
  // When
  const history = await service.listUnbindings(platformId, firstUserId)
  // Then
  expect(history).toHaveLength(1)
  expect(history[0]).toMatchObject({ actorId: platformId, reason: unbind.reason })
  expect(JSON.stringify(history)).not.toContain("11010519491231002X")
  expect(JSON.stringify(history)).not.toContain("fingerprint")
})
