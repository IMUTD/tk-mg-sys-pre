import { afterEach, expect, it } from "bun:test"
import { hasConfiguredTestDatabase, type MigratedTestDatabase } from "../../db/test-database"
import { firstUserId, platformId, setupIdentity } from "./test-fixtures"
import type { IdentityProvider, ProviderResult } from "./types"

const integration = hasConfiguredTestDatabase ? it : it.skip
let database: MigratedTestDatabase | null = null
afterEach(async () => {
  await database?.close()
  database = null
})
const verified: ProviderResult = {
  status: "verified",
  name: "张三",
  number: "11010519491231002X",
  code: "200",
  bizCode: "1",
  requestId: "test",
}
const pendingProvider = () => {
  const started = Promise.withResolvers<void>()
  const result = Promise.withResolvers<ProviderResult>()
  const provider: IdentityProvider = {
    verify: async () => {
      started.resolve()
      return result.promise
    },
  }
  return { started, result, provider }
}
const setup = async (provider?: IdentityProvider, clock?: () => Date) => {
  const fixture = await setupIdentity(provider, clock)
  database = fixture.database
  return fixture
}
const unbind = (version: number) => ({
  actorId: platformId,
  userId: firstUserId,
  idempotencyKey: "unbind-first",
  expectedVersion: version,
  reason: "账户转交",
  operatorPassword: "operator-password",
})
integration("returns current processing attempt before applying rate limits", async () => {
  // Given
  const pending = pendingProvider()
  const { submit } = await setup(pending.provider)
  const first = submit()
  await pending.started.promise
  // When
  const replay = await submit(firstUserId, "other-request")
  // Then
  expect(replay.status).toBe("verifying")
  pending.result.resolve(verified)
  expect((await first).id).toBe(replay.id)
})
integration("cannot restore a binding when unbound before the provider result", async () => {
  // Given
  const pending = pendingProvider()
  const { submit, service } = await setup(pending.provider)
  const first = submit()
  await pending.started.promise
  await service.unbind(unbind(1))
  // When
  pending.result.resolve(verified)
  const result = await first
  // Then
  expect(result.status).toBe("superseded")
  expect(await service.getAccess(firstUserId)).toMatchObject({
    status: "unbound",
    version: 2,
    canAccessBusiness: false,
  })
})
integration("invalidates in-flight verification even when an account is reenabled", async () => {
  // Given
  const pending = pendingProvider()
  const { submit, service, sql } = await setup(pending.provider)
  const first = submit()
  await pending.started.promise
  await sql`update app_user set enabled=false where id=${firstUserId}`
  await sql`update app_user set enabled=true where id=${firstUserId}`
  // When
  pending.result.resolve(verified)
  const result = await first
  // Then
  expect(result.status).toBe("superseded")
  expect(await service.getAccess(firstUserId)).toMatchObject({
    status: "error",
    canAccessBusiness: false,
  })
})
integration("rejects successful provider data after the result deadline", async () => {
  // Given
  let now = new Date("2026-11-05T00:00:00Z")
  const pending = pendingProvider()
  const { submit, service } = await setup(pending.provider, () => now)
  const first = submit()
  await pending.started.promise
  now = new Date(now.getTime() + 31000)
  // When
  pending.result.resolve(verified)
  // Then
  await expect(first).rejects.toMatchObject({ status: 504, code: "identity_provider_timeout" })
  expect(await service.getAccess(firstUserId)).toMatchObject({
    status: "error",
    canAccessBusiness: false,
  })
})
integration("expires abandoned processing leases on status reads", async () => {
  // Given
  let now = new Date("2026-11-05T00:00:00Z")
  const pending = pendingProvider()
  const { submit, service } = await setup(pending.provider, () => now)
  const first = submit()
  await pending.started.promise
  now = new Date(now.getTime() + 91000)
  // When
  const state = await service.getMe(firstUserId)
  pending.result.resolve(verified)
  // Then
  expect(state.status).toBe("error")
  await expect(first).rejects.toMatchObject({ code: "identity_provider_timeout" })
})
integration("does not remove a newer binding when unbind version is stale", async () => {
  // Given
  let now = new Date("2026-11-05T00:00:00Z")
  const { submit, service } = await setup(undefined, () => now)
  await submit()
  await service.unbind(unbind(1))
  now = new Date(now.getTime() + 61000)
  await submit(firstUserId, "later-attempt")
  // When / Then
  await expect(
    service.unbind({ ...unbind(1), idempotencyKey: "another-unbind" }),
  ).rejects.toMatchObject({ code: "stale_version" })
  expect(await service.getAccess(firstUserId)).toMatchObject({ status: "verified", version: 3 })
})
integration("retains verified identity when an account is disabled", async () => {
  // Given
  const { submit, service, sql } = await setup()
  await submit()
  // When
  await sql`update app_user set enabled=false where id=${firstUserId}`
  // Then
  expect(await service.getAccess(firstUserId)).toMatchObject({
    status: "verified",
    canAccessBusiness: false,
    version: 1,
  })
})
integration("rechecks the result deadline after waiting for the user lock", async () => {
  // Given
  let now = new Date("2026-11-05T00:00:00Z")
  const pending = pendingProvider()
  const { submit, sql } = await setup(pending.provider, () => now)
  const first = submit()
  await pending.started.promise
  const locked = Promise.withResolvers<void>()
  const unlock = Promise.withResolvers<void>()
  const blocker = sql.begin(async (tx) => {
    await tx`select id from app_user where id=${firstUserId} for update`
    locked.resolve()
    await unlock.promise
  })
  await locked.promise
  pending.result.resolve(verified)
  let waiting = false
  try {
    for (let index = 0; index < 100 && !waiting; index++) {
      const rows = await sql<
        { readonly count: number }[]
      >`select count(*)::int as count from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select id, enabled, role%'`
      waiting = (rows[0]?.count ?? 0) > 0
    }
    expect(waiting).toBe(true)
    // When
    now = new Date(now.getTime() + 31000)
  } finally {
    unlock.resolve()
    await blocker
  }
  // Then
  await expect(first).rejects.toMatchObject({ code: "identity_provider_timeout", status: 504 })
})
integration(
  "never calls the provider when a reservation deadline expires behind the quota lock",
  async () => {
    // Given
    let now = new Date("2026-11-05T00:00:00Z")
    const { submit, sql, calls } = await setup(undefined, () => now)
    const dayStart = Date.parse("2026-11-04T16:00:00Z")
    const locked = Promise.withResolvers<void>()
    const unlock = Promise.withResolvers<void>()
    const blocker = sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(817203, ${Math.floor(dayStart / 86400000)})`
      locked.resolve()
      await unlock.promise
    })
    await locked.promise
    const first = submit()
    let waiting = false
    try {
      for (let index = 0; index < 100 && !waiting; index++) {
        const rows = await sql<
          { readonly count: number }[]
        >`select count(*)::int as count from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select pg_advisory_xact_lock(817203,%'`
        waiting = (rows[0]?.count ?? 0) > 0
      }
      expect(waiting).toBe(true)
      // When
      now = new Date(now.getTime() + 31000)
    } finally {
      unlock.resolve()
      await blocker
    }
    // Then
    await expect(first).rejects.toMatchObject({ code: "identity_provider_timeout", status: 504 })
    expect(calls()).toBe(0)
  },
)
