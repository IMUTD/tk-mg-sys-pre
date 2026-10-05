import { createHash } from "node:crypto"

import {
  type AccessScope,
  createAccessScope,
  GroupIdSchema,
  type Permission,
  PermissionSchema,
  type UserId,
  UserIdSchema,
} from "../../lib/authorization"
import type { PageAccess } from "../../lib/pages"

const SessionLifetimeMilliseconds = 1000 * 60 * 60 * 8

export type AuthenticatedUser = {
  readonly displayName: string
  readonly email: string
  readonly enabled: boolean
  readonly id: UserId
  readonly passwordHash: string
  readonly scope: AccessScope
}

type SessionRecord = {
  readonly expiresAt: Date
  readonly id: string
  readonly revokedAt: Date | null
  readonly tokenHash: string
  readonly userId: UserId
}

type NewSession = {
  readonly expiresAt: Date
  readonly id: string
  readonly tokenHash: string
  readonly userId: UserId
}

export interface AuthRepository {
  createSession(input: NewSession): Promise<void>
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>
  findUserByEmail(email: string): Promise<AuthenticatedUser | null>
  findUserById(userId: UserId): Promise<AuthenticatedUser | null>
  revokeSession(tokenHash: string): Promise<void>
}

type PasswordVerifier = (password: string, passwordHash: string) => Promise<boolean>

type LoginInput = {
  readonly email: string
  readonly password: string
}

export type SessionPrincipal = {
  readonly displayName: string
  readonly email: string
  readonly scope: AccessScope
  readonly userId: UserId
}

export type LoginResult =
  | {
      readonly kind: "authenticated"
      readonly principal: SessionPrincipal
      readonly sessionToken: string
    }
  | { readonly kind: "invalid_credentials" }

export interface AuthService {
  login(input: LoginInput): Promise<LoginResult>
  logout(sessionToken: string): Promise<void>
  session(sessionToken: string): Promise<SessionPrincipal | null>
}

const hashSessionToken = (token: string): string => createHash("sha256").update(token).digest("hex")

const verifyWithBunPassword: PasswordVerifier = async (password, passwordHash) =>
  Bun.password.verify(password, passwordHash)

export const createAuthService = (
  repository: AuthRepository,
  passwordVerifier: PasswordVerifier = verifyWithBunPassword,
): AuthService => ({
  login: async (input) => {
    const user = await repository.findUserByEmail(input.email)
    if (
      user === null ||
      !user.enabled ||
      !(await passwordVerifier(input.password, user.passwordHash))
    ) {
      return { kind: "invalid_credentials" }
    }

    const sessionToken = crypto.randomUUID()
    const session: NewSession = {
      expiresAt: new Date(Date.now() + SessionLifetimeMilliseconds),
      id: crypto.randomUUID(),
      tokenHash: hashSessionToken(sessionToken),
      userId: user.id,
    }
    await repository.createSession(session)

    return {
      kind: "authenticated",
      principal: {
        displayName: user.displayName,
        email: user.email,
        scope: user.scope,
        userId: user.id,
      },
      sessionToken,
    }
  },
  logout: async (sessionToken) => repository.revokeSession(hashSessionToken(sessionToken)),
  session: async (sessionToken) => {
    const session = await repository.findSessionByTokenHash(hashSessionToken(sessionToken))
    if (session === null || session.revokedAt !== null || session.expiresAt <= new Date()) {
      return null
    }

    const user = await repository.findUserById(session.userId)
    if (user === null || !user.enabled) {
      return null
    }

    return {
      displayName: user.displayName,
      email: user.email,
      scope: user.scope,
      userId: user.id,
    }
  },
})

export type InMemoryAuthUserInput = {
  readonly displayName?: string
  readonly email: string
  readonly enabled?: boolean
  readonly groupIds: readonly string[]
  readonly id: string
  readonly password: string
  readonly pages?: readonly PageAccess[]
  readonly permissions: readonly Permission[]
  readonly role: AccessScope["role"]
}

export const createInMemoryAuthRepository = (
  users: readonly InMemoryAuthUserInput[],
): AuthRepository => {
  const usersByEmail = new Map<string, AuthenticatedUser>()
  const usersById = new Map<UserId, AuthenticatedUser>()
  const sessionsByTokenHash = new Map<string, SessionRecord>()

  for (const user of users) {
    const normalized: AuthenticatedUser = {
      displayName: user.displayName?.trim() || user.email.toLowerCase(),
      email: user.email.toLowerCase(),
      enabled: user.enabled ?? true,
      id: UserIdSchema.parse(user.id),
      passwordHash: user.password,
      scope: createAccessScope({
        groupIds: user.groupIds.map((groupId) => GroupIdSchema.parse(groupId)),
        ...(user.pages === undefined ? {} : { pages: user.pages }),
        permissions: user.permissions.map((permission) => PermissionSchema.parse(permission)),
        role: user.role,
      }),
    }
    usersByEmail.set(normalized.email, normalized)
    usersById.set(normalized.id, normalized)
  }

  return {
    createSession: async (input) => {
      sessionsByTokenHash.set(input.tokenHash, { ...input, revokedAt: null })
    },
    findSessionByTokenHash: async (tokenHash) => sessionsByTokenHash.get(tokenHash) ?? null,
    findUserByEmail: async (email) => usersByEmail.get(email.toLowerCase()) ?? null,
    findUserById: async (userId) => usersById.get(userId) ?? null,
    revokeSession: async (tokenHash) => {
      const existing = sessionsByTokenHash.get(tokenHash)
      if (existing !== undefined) {
        sessionsByTokenHash.set(tokenHash, { ...existing, revokedAt: new Date() })
      }
    },
  }
}
