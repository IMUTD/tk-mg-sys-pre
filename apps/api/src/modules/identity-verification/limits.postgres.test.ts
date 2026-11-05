import { afterEach, expect, it } from "bun:test"
import sharp from "sharp"
import { hasConfiguredTestDatabase, type MigratedTestDatabase } from "../../db/test-database"
import { parseProviderResponse } from "./provider-result"
import { firstUserId, platformId, secondUserId, setupIdentity } from "./test-fixtures"
import { ConsentVersion, type IdentityProvider } from "./types"

const integration = hasConfiguredTestDatabase ? it : it.skip
let database: MigratedTestDatabase | null = null
afterEach(async () => {
  await database?.close()
  database = null
})
const setup = async (provider?: IdentityProvider, clock?: () => Date) => {
  const fixture = await setupIdentity(provider, clock)
  database = fixture.database
  return fixture
}
const rejected: IdentityProvider = {
  verify: async () => ({
    status: "rejected",
    errorCode: "identity_mismatch",
    code: "200",
    bizCode: "2",
    requestId: null,
  }),
}
const unbind = {
  actorId: platformId,
  userId: firstUserId,
  idempotencyKey: "unbind-first",
  expectedVersion: 1,
  reason: "账户转交",
  operatorPassword: "operator-password",
}
integration("rejects changed image under a reused key before rate limits", async () => {
  // Given
  const { submit, service } = await setup(rejected)
  await submit()
  const image = await sharp({
    create: { width: 65, height: 100, channels: 3, background: "black" },
  })
    .png()
    .toBuffer()
  // When / Then
  await expect(
    service.submit({
      userId: firstUserId,
      idempotencyKey: "first-attempt",
      frontImage: new File([image], "front.png", { type: "image/png" }),
      consentAccepted: true,
      consentVersion: ConsentVersion,
    }),
  ).rejects.toMatchObject({ code: "idempotency_conflict", status: 409 })
})
integration("clears fingerprints after 24 hours without repeating provider calls", async () => {
  // Given
  let now = new Date("2026-11-05T00:00:00Z")
  const { submit, sql, calls } = await setup(undefined, () => now)
  await submit()
  now = new Date(now.getTime() + 86400001)
  // When / Then
  await expect(submit()).rejects.toMatchObject({ code: "idempotency_expired" })
  expect(calls()).toBe(1)
  expect(
    (
      await sql<
        { readonly fingerprint: string | null }[]
      >`select request_fingerprint as fingerprint from identity_verification_attempt`
    )[0]?.fingerprint,
  ).toBeNull()
})
integration("counts attempts atomically against the user daily cap", async () => {
  // Given
  let now = new Date("2026-11-05T00:00:00Z")
  const { submit } = await setup(rejected, () => now)
  for (let index = 0; index < 5; index++) {
    await submit(firstUserId, `attempt-${index}`)
    now = new Date(now.getTime() + 61000)
  }
  // When / Then
  await expect(submit(firstUserId, "attempt-sixth")).rejects.toMatchObject({
    code: "rate_limited",
    status: 429,
  })
})
integration("preserves the minute limit across a UTC+8 date boundary", async () => {
  // Given
  let now = new Date("2026-11-05T15:59:50Z")
  const { submit } = await setup(rejected, () => now)
  await submit()
  now = new Date("2026-11-05T16:00:10Z")
  // When / Then
  await expect(submit(firstUserId, "after-midnight")).rejects.toMatchObject({
    code: "rate_limited",
    status: 429,
  })
})
integration("enforces a shared five-failure password limiter", async () => {
  // Given
  const { submit, service, sql } = await setup()
  await submit()
  for (let index = 0; index < 5; index++)
    await expect(
      service.unbind({ ...unbind, operatorPassword: "bad-password" }),
    ).rejects.toMatchObject({ code: "invalid_operator_password" })
  // When / Then
  await expect(service.unbind(unbind)).rejects.toMatchObject({
    code: "password_rate_limited",
    status: 429,
  })
  expect(await sql`select * from identity_password_failure`).toHaveLength(5)
  expect(await service.getAccess(firstUserId)).toMatchObject({ status: "verified" })
})
integration("revokes every target session and clears identity data atomically", async () => {
  // Given
  const { submit, service, sql } = await setup()
  await submit()
  for (const hash of ["first-session", "second-session"])
    await sql`insert into app_session(id,user_id,token_hash,expires_at) values (${crypto.randomUUID()},${firstUserId},${hash},now()+interval '1 day')`
  // When
  await service.unbind(unbind)
  // Then
  const sessions =
    await sql`select id from app_session where user_id=${firstUserId} and revoked_at is null`
  const state =
    await sql`select encrypted_name,encrypted_number,cert_no_hmac,current_attempt_id from admin_identity_verification where user_id=${firstUserId}`
  expect(sessions).toHaveLength(0)
  expect({ ...state[0] }).toEqual({
    encrypted_name: null,
    encrypted_number: null,
    cert_no_hmac: null,
    current_attempt_id: null,
  })
})
integration("rejects a changed reason for a reused unbind key", async () => {
  // Given
  const { submit, service } = await setup()
  await submit()
  await service.unbind(unbind)
  // When / Then
  await expect(service.unbind({ ...unbind, reason: "其他原因" })).rejects.toMatchObject({
    code: "idempotency_conflict",
  })
})
integration("lists eligible accounts without identity rows", async () => {
  // Given
  const { service } = await setup()
  // When
  const result = await service.list(platformId, { page: 1, pageSize: 20 })
  // Then
  expect(result.total).toBe(2)
  expect(result.items.map((item) => item.userId).sort()).toEqual([firstUserId, secondUserId].sort())
  expect(result.items.every((item) => item.status === "unverified")).toBe(true)
})
integration("persists sanitized failure when cloud response is malformed", async () => {
  // Given
  const { submit, sql } = await setup({
    verify: async () =>
      parseProviderResponse({
        code: "200",
        resultObject: {
          bizCode: "1",
          cardInfo: JSON.stringify({ certName: "张三", certNo: "invalid" }),
        },
      }),
  })
  // When / Then
  await expect(submit()).rejects.toMatchObject({
    code: "identity_provider_invalid_response",
    status: 503,
  })
  const rows = await sql<{ readonly status: string }[]>`select * from identity_verification_attempt`
  expect(rows[0]?.status).toBe("error")
  expect(JSON.stringify(rows)).not.toContain("张三")
})
integration(
  "records a local error even when an injected provider throws synchronously",
  async () => {
    // Given
    const { submit, sql } = await setup({
      verify: () => {
        throw new Error("cloud transport failure")
      },
    })
    // When / Then
    await expect(submit()).rejects.toMatchObject({
      code: "identity_provider_unavailable",
      status: 503,
    })
    expect(
      (
        await sql<{ readonly status: string }[]>`select status from identity_verification_attempt`
      )[0]?.status,
    ).toBe("error")
  },
)
integration("returns actionable image errors with the persisted attempt ID", async () => {
  // Given
  const { submit } = await setup({ verify: async () => parseProviderResponse({ code: "405" }) })
  // When / Then
  await expect(submit()).rejects.toMatchObject({
    code: "unsupported_image",
    status: 415,
    attemptId: expect.any(String),
  })
})
integration("reports the true total on a page past the last result", async () => {
  // Given
  const { service } = await setup()
  // When
  const result = await service.list(platformId, { page: 2, pageSize: 100 })
  // Then
  expect(result).toMatchObject({ total: 2, items: [] })
})
integration(
  "retains pending verification records when deleting an account is attempted",
  async () => {
    // Given
    const { sql } = await setup()
    await sql`insert into admin_identity_verification(user_id) values (${firstUserId})`
    // When / Then
    await expect(
      (async () => await sql`delete from app_user where id=${firstUserId}`)(),
    ).rejects.toMatchObject({ code: "23503" })
  },
)
