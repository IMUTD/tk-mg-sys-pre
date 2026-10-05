import { describe, expect, it } from "bun:test"

import { bootstrapAdministrator, parseBootstrapAdministratorConfig } from "./bootstrap-admin"
import { Role } from "./lib/authorization"
import { createAuthService, createInMemoryAuthRepository } from "./modules/auth/service"

describe("bootstrapAdministrator", () => {
  it("creates an administrator with a derived hash and never returns the plaintext password", async () => {
    // Given
    const config = parseBootstrapAdministratorConfig({
      ADMIN_BOOTSTRAP_EMAIL: "admin@example.internal",
      ADMIN_BOOTSTRAP_PASSWORD: "correct-horse-battery-staple",
      DATABASE_URL: "postgres://tk_mg:password@postgres:5432/tk_mg",
    })
    let persistedPasswordHash = ""

    // When
    const result = await bootstrapAdministrator(config, {
      create: async (input) => {
        persistedPasswordHash = input.passwordHash
        return true
      },
      hashPassword: async (password) => `hash:${password}`,
    })

    // Then
    expect(result).toEqual({ kind: "created" })
    expect(persistedPasswordHash).toBe("hash:correct-horse-battery-staple")
    expect(JSON.stringify(result)).not.toContain("correct-horse-battery-staple")
  })
})

describe("bootstrap administrator CLI configuration", () => {
  it("normalizes a mixed-case bootstrap email so normal login lookup can find it", async () => {
    // Given
    const config = parseBootstrapAdministratorConfig({
      ADMIN_BOOTSTRAP_EMAIL: "Admin@Example.Internal",
      ADMIN_BOOTSTRAP_PASSWORD: "correct-horse-battery-staple",
      DATABASE_URL: "postgres://tk_mg:password@postgres:5432/tk_mg",
    })
    let createdEmail = ""

    // When
    await bootstrapAdministrator(config, {
      create: async (input) => {
        createdEmail = input.email
        return true
      },
      hashPassword: async () => "password-hash",
    })
    const authentication = createAuthService(
      createInMemoryAuthRepository([
        {
          email: createdEmail,
          groupIds: [],
          id: "f13e2068-33fe-45a1-b878-c41f71a2859f",
          password: "password-hash",
          permissions: [],
          role: Role.Administrator,
        },
      ]),
      async (password, passwordHash) =>
        password === "correct-horse-battery-staple" && passwordHash === "password-hash",
    )
    const result = await authentication.login({
      email: "admin@example.internal",
      password: "correct-horse-battery-staple",
    })

    // Then
    expect(createdEmail).toBe("admin@example.internal")
    expect(result.kind).toBe("authenticated")
  })
})
