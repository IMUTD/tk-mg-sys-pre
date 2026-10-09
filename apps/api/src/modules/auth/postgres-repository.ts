import type { Sql } from "postgres"

import {
  createAccessScope,
  GroupIdSchema,
  PermissionSchema,
  RoleSchema,
  UserIdSchema,
} from "../../lib/authorization"
import { permissionsForPages } from "../../lib/pages"
import { loadMergedPageAccess } from "../members/page-permission-repository"
import type { AuthenticatedUser, AuthRepository } from "./service"

type AuthUserRow = {
  readonly displayName: string | null
  readonly email: string
  readonly enabled: boolean
  readonly groupIds: readonly string[]
  readonly id: string
  readonly passwordHash: string
  readonly role: string
  readonly provisionedBy: string
}

type SessionRow = {
  readonly expiresAt: Date
  readonly id: string
  readonly revokedAt: Date | null
  readonly tokenHash: string
  readonly userId: string
}

const toAuthenticatedUser = async (client: Sql, row: AuthUserRow): Promise<AuthenticatedUser> => {
  const role = RoleSchema.parse(row.role)
  const pages = await loadMergedPageAccess(client, role, row.id)
  return {
    displayName: row.displayName?.trim() || row.email,
    email: row.email,
    enabled: row.enabled,
    id: UserIdSchema.parse(row.id),
    passwordHash: row.passwordHash,
    scope: createAccessScope({
      restrictGroups: row.provisionedBy === "init-tool",
      groupIds: row.groupIds.map((groupId) => GroupIdSchema.parse(groupId)),
      pages,
      permissions: PermissionSchema.array().parse(permissionsForPages(pages)),
      role,
    }),
  }
}

const toSessionRecord = (row: SessionRow) => ({
  expiresAt: row.expiresAt,
  id: row.id,
  revokedAt: row.revokedAt,
  tokenHash: row.tokenHash,
  userId: UserIdSchema.parse(row.userId),
})

const userBy = async (
  client: Sql,
  predicate: ReturnType<Sql>,
): Promise<AuthenticatedUser | null> => {
  const rows = await client<AuthUserRow[]>`
    select
      app_user.id,
      app_user.email,
      app_user.display_name as "displayName",
      app_user.enabled,
      app_user.password_hash as "passwordHash",
      app_user.role,
      app_user.provisioned_by as "provisionedBy",
      coalesce(array_agg(user_group.group_id) filter (where user_group.group_id is not null), '{}') as "groupIds"
    from app_user
    left join user_group on user_group.user_id = app_user.id
    where ${predicate}
    group by app_user.id, app_user.email, app_user.display_name, app_user.enabled, app_user.password_hash, app_user.role
  `
  const row = rows[0]
  return row === undefined ? null : toAuthenticatedUser(client, row)
}

export const createPostgresAuthRepository = (client: Sql): AuthRepository => ({
  createSession: async (input) => {
    await client`
      insert into app_session (id, user_id, token_hash, expires_at)
      values (${input.id}, ${input.userId}, ${input.tokenHash}, ${input.expiresAt})
    `
  },
  findSessionByTokenHash: async (tokenHash) => {
    const rows = await client<SessionRow[]>`
      select
        id,
        user_id as "userId",
        token_hash as "tokenHash",
        expires_at as "expiresAt",
        revoked_at as "revokedAt"
      from app_session
      where token_hash = ${tokenHash}
    `
    const row = rows[0]
    return row === undefined ? null : toSessionRecord(row)
  },
  findUserByEmail: async (email) => userBy(client, client`app_user.email = ${email.toLowerCase()}`),
  findUserById: async (userId) => userBy(client, client`app_user.id = ${userId}`),
  revokeSession: async (tokenHash) => {
    await client`update app_session set revoked_at = now() where token_hash = ${tokenHash}`
  },
})
