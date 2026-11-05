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
integration("rolls back unbind and session revocation when its audit cannot be saved", async () => {
  // Given
  const { submit, service, sql } = await setup()
  await submit()
  await sql`insert into app_session(id,user_id,token_hash,expires_at) values (${crypto.randomUUID()},${firstUserId},'active-session',now()+interval '1 day')`
  await sql.unsafe(
    "CREATE FUNCTION reject_unbind_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'identity.unbind' THEN RAISE EXCEPTION 'fixture audit rejection'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_unbind_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION reject_unbind_audit();",
  )
  // When / Then
  await expect(
    service.unbind({
      actorId: platformId,
      userId: firstUserId,
      idempotencyKey: "unbind-first",
      expectedVersion: 1,
      reason: "账户转交",
      operatorPassword: "operator-password",
    }),
  ).rejects.toMatchObject({ code: "P0001" })
  expect(await service.getAccess(firstUserId)).toMatchObject({ status: "verified", version: 1 })
  expect(
    await sql`select id from app_session where user_id=${firstUserId} and revoked_at is null`,
  ).toHaveLength(1)
})
integration("never commits a verified identity without its successful attempt audit", async () => {
  // Given
  const { submit, sql } = await setup()
  await sql.unsafe(
    "CREATE FUNCTION reject_verify_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'identity.verify' THEN RAISE EXCEPTION 'fixture audit rejection'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_verify_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION reject_verify_audit();",
  )
  // When / Then
  await expect(submit()).rejects.toMatchObject({ code: "P0001" })
  expect(
    await sql`select user_id from admin_identity_verification where status='verified'`,
  ).toHaveLength(0)
  expect(
    await sql`select id from identity_verification_attempt where status='verified'`,
  ).toHaveLength(0)
})
integration("reserves only one final global quota slot under concurrent submissions", async () => {
  // Given
  const { submit, sql, calls } = await setup()
  await sql`insert into identity_verification_attempt(id,user_id,binding_version,idempotency_key,status,consent_version,consented_at,started_at,deadline_at,lease_expires_at) select gen_random_uuid(),${platformId},0,'seed-'||n,'error','fixture',now(),now(),now(),now() from generate_series(1,999) n`
  // When
  const results = await Promise.allSettled([submit(firstUserId), submit(secondUserId)])
  // Then
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
  const rejected = results.find((result) => result.status === "rejected")
  expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({
    code: "rate_limited",
    status: 429,
  })
  expect(calls()).toBe(1)
})
