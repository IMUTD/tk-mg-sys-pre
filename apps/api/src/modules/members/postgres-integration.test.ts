import { afterEach, describe, expect, it } from "bun:test"

import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { Role, UserIdSchema } from "../../lib/authorization"
import { PageKey } from "../../lib/pages"
import { createPostgresAuditRepository } from "../audit/service"
import { createPostgresPagePermissionRepository } from "./page-permission-repository"
import { createPostgresMemberRepository, MemberConflictError, MemberIdSchema } from "./repository"
import { createMemberService } from "./service"

const rows = <Row>(result: readonly Row[]): readonly Row[] => [...result]

const expectDatabaseCode = async (
  operation: () => Promise<unknown>,
  code: string,
): Promise<void> => {
  let actualCode: unknown = null
  try {
    await operation()
  } catch (error) {
    actualCode = Object.getOwnPropertyDescriptor(error, "code")?.value
  }
  expect(actualCode).toBe(code)
}

const databaseIntegrationTest = hasConfiguredTestDatabase ? it : it.skip
const firstAdministratorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const secondAdministratorId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const auditActorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const missingAuditActorId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const memberId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
const sessionId = "ffffffff-ffff-4fff-8fff-ffffffffffff"

let activeDatabase: MigratedTestDatabase | null = null

afterEach(async () => {
  if (activeDatabase !== null) {
    await activeDatabase.close()
    activeDatabase = null
  }
})

const createService = (database: MigratedTestDatabase) => {
  const auditRepository = createPostgresAuditRepository(database.client)
  return createMemberService({
    auditRepository,
    pagePermissions: createPostgresPagePermissionRepository(database.client),
    repository: createPostgresMemberRepository(database.client),
  })
}

describe("member PostgreSQL transactions", () => {
  databaseIntegrationTest(
    "rolls back member and session changes when audit insertion fails",
    async () => {
      // Given
      activeDatabase = await createMigratedTestDatabase()
      const client = activeDatabase.client
      await client`
      insert into app_user (id, email, password_hash, role, enabled)
      values (${memberId}, ${"member@example.com"}, ${"unused"}, ${Role.Operator}, true)
    `
      await client`
      insert into app_session (id, user_id, token_hash, expires_at)
      values (${sessionId}, ${memberId}, ${"member-session-token"}, ${new Date("2099-01-01T00:00:00.000Z")})
    `
      await client`
      insert into user_page_permission (user_id, page_key, can_view, can_delete)
      values (${memberId}, ${PageKey.Devices}, true, true)
    `
      const service = createService(activeDatabase)

      // When
      // Then
      await expectDatabaseCode(
        () =>
          service.update(UserIdSchema.parse(missingAuditActorId), MemberIdSchema.parse(memberId), {
            enabled: false,
            groupIds: [],
            role: Role.Engineer,
          }),
        "23503",
      )
      const members = await client<{ readonly enabled: boolean; readonly role: string }[]>`
      select enabled, role from app_user where id = ${memberId}
    `
      const sessions = await client<{ readonly revokedAt: Date | null }[]>`
      select revoked_at as "revokedAt" from app_session where id = ${sessionId}
    `
      const permissions = await client<
        { readonly canDelete: boolean; readonly canView: boolean; readonly pageKey: string }[]
      >`
      select
        page_key as "pageKey",
        can_view as "canView",
        can_delete as "canDelete"
      from user_page_permission
      where user_id = ${memberId}
    `
      const audits = await client<{ readonly count: number }[]>`
      select count(*)::int as count from audit_event
    `
      expect(rows(members)).toEqual([{ enabled: true, role: Role.Operator }])
      expect(rows(sessions)).toEqual([{ revokedAt: null }])
      expect(rows(permissions)).toEqual([
        { canDelete: true, canView: true, pageKey: PageKey.Devices },
      ])
      expect(rows(audits)).toEqual([{ count: 0 }])
    },
  )

  databaseIntegrationTest(
    "protects the last administrator during concurrent demotions",
    async () => {
      // Given
      activeDatabase = await createMigratedTestDatabase()
      const client = activeDatabase.client
      await client`
      insert into app_user (id, email, password_hash, role, enabled)
      values
        (${firstAdministratorId}, ${"first.admin@example.com"}, ${"unused"}, ${Role.Administrator}, true),
        (${secondAdministratorId}, ${"second.admin@example.com"}, ${"unused"}, ${Role.Administrator}, true),
        (${auditActorId}, ${"auditor@example.com"}, ${"unused"}, ${Role.Operator}, true)
    `
      const service = createService(activeDatabase)
      const actorId = UserIdSchema.parse(auditActorId)
      const demotion = { enabled: true, groupIds: [], role: Role.Operator }

      // When
      const results = await Promise.allSettled([
        service.update(actorId, MemberIdSchema.parse(firstAdministratorId), demotion),
        service.update(actorId, MemberIdSchema.parse(secondAdministratorId), demotion),
      ])

      // Then
      const conflicts = results.filter(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof MemberConflictError &&
          result.reason.code === "last_administrator",
      )
      const successfulUpdates = results.filter((result) => result.status === "fulfilled")
      const administrators = await client<{ readonly id: string }[]>`
      select id from app_user where role = ${Role.Administrator} and enabled = true
    `
      const audits = await client<{ readonly count: number }[]>`
      select count(*)::int as count
      from audit_event
      where action = ${"member.update"} and actor_id = ${auditActorId}
    `
      expect(conflicts).toHaveLength(1)
      expect(successfulUpdates).toHaveLength(1)
      expect(administrators).toHaveLength(1)
      expect(rows(audits)).toEqual([{ count: 1 }])
    },
  )
})
