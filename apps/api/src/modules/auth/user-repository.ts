import type { Sql } from "postgres"

import { type Role, RoleSchema } from "../../lib/authorization"

type UserInput = {
  readonly email: string
  readonly passwordHash: string
  readonly role: string
}

type UserRecord = {
  readonly email: string
  readonly role: Role
}

type UserRepository = {
  readonly create: (input: UserInput) => Promise<UserRecord>
}

class UserPersistenceError extends Error {
  public constructor() {
    super("User insert did not return a record")
    this.name = "UserPersistenceError"
  }
}

export class InvalidUserRoleError extends Error {
  public constructor() {
    super("User role is not a recognized app_role")
    this.name = "InvalidUserRoleError"
  }
}

export const createUserRepository = (client: Sql): UserRepository => ({
  create: async (input) => {
    const role = RoleSchema.safeParse(input.role)
    if (!role.success) {
      throw new InvalidUserRoleError()
    }

    const rows = await client<UserRecord[]>`
      insert into app_user (id, email, password_hash, role)
      values (${crypto.randomUUID()}, ${input.email}, ${input.passwordHash}, ${role.data})
      returning email, role
    `
    const created = rows[0]

    if (created === undefined) {
      throw new UserPersistenceError()
    }

    return created
  },
})
