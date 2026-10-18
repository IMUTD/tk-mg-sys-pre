import { describe, expect, it } from "bun:test"
import { initializeDeploymentDatabase } from "./bootstrap-deployment"
import { createMigratedTestDatabase, hasConfiguredTestDatabase } from "./db/test-database"

const config = {
  databaseUrl: "postgres://unused/test",
  email: "deployment@example.com",
  password: "first-deployment-password",
  systemActorId: "99999999-9999-4999-8999-999999999999",
} as const

type IdentityRow = {
  readonly id: string
  readonly email: string
  readonly enabled: boolean
  readonly role: string
  readonly password_hash: string
  readonly password_plain: string
}

describe("deployment identity initialization", () => {
  it.skipIf(!hasConfiguredTestDatabase)(
    "creates separate identities and preserves passwords on retry",
    async () => {
      const database = await createMigratedTestDatabase()
      try {
        await initializeDeploymentDatabase(database.client, config)
        const before = await database.client<IdentityRow[]>`select * from app_user order by email`
        await initializeDeploymentDatabase(database.client, {
          ...config,
          password: "changed-password",
        })
        const after = await database.client<IdentityRow[]>`select * from app_user order by email`
        expect(after).toEqual(before)
        expect(after).toHaveLength(2)
        const admin = after.find((row) => row.email === config.email)
        const actor = after.find((row) => row.id === config.systemActorId)
        expect(admin?.enabled).toBe(true)
        expect(actor?.enabled).toBe(false)
        expect(actor?.role).toBe("administrator")
        expect(admin?.password_plain).toBe("")
      } finally {
        await database.close()
      }
    },
  )

  it.skipIf(!hasConfiguredTestDatabase)(
    "refuses to repurpose an existing enabled user as system actor",
    async () => {
      const database = await createMigratedTestDatabase()
      try {
        await database.client`
        insert into app_user (id, email, password_hash, role, enabled)
        values (${config.systemActorId}, 'existing@example.com', 'untouched', 'administrator', true)
      `
        await expect(initializeDeploymentDatabase(database.client, config)).rejects.toThrow()
        const users = await database.client<IdentityRow[]>`select * from app_user`
        expect(users).toHaveLength(1)
        expect(users[0]?.enabled).toBe(true)
        expect(users[0]?.password_hash).toBe("untouched")
      } finally {
        await database.close()
      }
    },
  )
})
