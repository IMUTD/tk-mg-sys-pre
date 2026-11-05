import { afterEach, expect, it, spyOn } from "bun:test"
import { hasConfiguredTestDatabase, type MigratedTestDatabase } from "../../db/test-database"
import { firstUserId, platformId, secondUserId, setupIdentity } from "./test-fixtures"
import { IdentityError } from "./types"
import * as imageUpload from "./upload"

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
integration("includes an administrator without a binding row as unverified", async () => {
  // Given
  const { service } = await setup()
  // When
  const access = await service.getAccess(firstUserId)
  // Then
  expect(access).toMatchObject({
    status: "unverified",
    required: true,
    canAccessBusiness: false,
    version: 0,
  })
})
integration("replays one successful attempt without calling the provider again", async () => {
  // Given
  const { service, submit, calls, sql } = await setup()
  const first = await submit()
  // When
  const replay = await submit()
  // Then
  expect(replay.id).toBe(first.id)
  expect(calls()).toBe(1)
  expect(await service.getAccess(firstUserId)).toMatchObject({
    status: "verified",
    canAccessBusiness: true,
  })
  const attempts = await sql`select * from identity_verification_attempt`
  expect(JSON.stringify(attempts)).not.toContain("11010519491231002X")
  expect(JSON.stringify(attempts)).not.toContain("张三")
})
integration(
  "binds only one account when two accounts concurrently verify the same identity",
  async () => {
    // Given
    const { submit, sql } = await setup()
    // When
    const results = await Promise.allSettled([submit(), submit(secondUserId)])
    // Then
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1)
    const rejected = results.find((item) => item.status === "rejected")
    expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({
      code: "identity_already_bound",
      status: 409,
    })
    const rows = await sql`select status from admin_identity_verification where status='verifying'`
    expect(rows).toHaveLength(0)
  },
)
integration("unbinds once and replays safely after a later version", async () => {
  // Given
  const { submit, service, sql } = await setup()
  await submit()
  const input = {
    actorId: platformId,
    userId: firstUserId,
    idempotencyKey: "unbind-first",
    expectedVersion: 1,
    reason: "账户转交",
    operatorPassword: "operator-password",
  }
  const first = await service.unbind(input)
  await sql`update admin_identity_verification set version=3 where user_id=${firstUserId}`
  // When
  const replay = await service.unbind(input)
  // Then
  expect(replay).toEqual({ ...first, replayed: true })
  const audits = await sql`select id from audit_event where action='identity.unbind'`
  expect(audits).toHaveLength(1)
})
integration("replays an accepted request while local decoder admission is exhausted", async () => {
  // Given
  const { submit, calls } = await setup()
  const first = await submit()
  const decoder = spyOn(imageUpload, "decodeIdentityImage").mockRejectedValue(
    new IdentityError("rate_limited", 429),
  )
  try {
    await expect(submit(secondUserId, "fresh-attempt")).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
    })
    expect(decoder).toHaveBeenCalledTimes(1)
    // When
    const replay = await submit()
    // Then
    expect(replay.id).toBe(first.id)
    expect(calls()).toBe(1)
    expect(decoder).toHaveBeenCalledTimes(1)
  } finally {
    decoder.mockRestore()
  }
})
integration("rejects a verified account before trying to decode another image", async () => {
  // Given
  const { submit } = await setup()
  await submit()
  const decoder = spyOn(imageUpload, "decodeIdentityImage").mockRejectedValue(
    new IdentityError("rate_limited", 429),
  )
  try {
    // When / Then
    await expect(submit(firstUserId, "another-image")).rejects.toMatchObject({
      code: "already_verified",
      status: 409,
    })
    expect(decoder).toHaveBeenCalledTimes(0)
  } finally {
    decoder.mockRestore()
  }
})
