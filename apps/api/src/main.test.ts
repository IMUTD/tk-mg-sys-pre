import { describe, expect, it } from "bun:test"

import { createApiRequestHandler, createShutdownHandler, parseApiRuntimeConfig } from "./main"

describe("parseApiRuntimeConfig", () => {
  it("uses the production API port when PORT is omitted", () => {
    // Given
    const environment = {
      DATABASE_URL: "postgres://tk_mg:password@postgres:5432/tk_mg",
      REDIS_URL: "redis://redis:6379",
      SECRET_ENCRYPTION_KEY: "12345678901234567890123456789012",
      TK_MG_SYSTEM_ACTOR_ID: "99999999-9999-4999-8999-999999999999",
    }

    // When
    const result = parseApiRuntimeConfig(environment)

    // Then
    expect(result.port).toBe(3000)
    expect(result.authCookieSecure).toBe(true)
  })

  it("requires an explicit false value to allow HTTP session cookies", () => {
    const environment = {
      DATABASE_URL: "postgres://tk_mg:password@postgres:5432/tk_mg",
      REDIS_URL: "redis://redis:6379",
      SECRET_ENCRYPTION_KEY: "12345678901234567890123456789012",
      TK_MG_SYSTEM_ACTOR_ID: "99999999-9999-4999-8999-999999999999",
    }
    expect(
      parseApiRuntimeConfig({ ...environment, AUTH_COOKIE_SECURE: "false" }).authCookieSecure,
    ).toBe(false)
    expect(() => parseApiRuntimeConfig({ ...environment, AUTH_COOKIE_SECURE: "no" })).toThrow()
  })
})

describe("createApiRequestHandler", () => {
  it("reports unavailable when a required dependency readiness check fails", async () => {
    // Given
    const handler = createApiRequestHandler({
      appFetch: () => Response.json({ status: "alive" }),
      checkReadiness: async () => Promise.reject(new Error("Redis unavailable")),
    })

    // When
    const response = await handler(new Request("http://api/ready"))

    // Then
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: "unavailable" })
  })
})

describe("createShutdownHandler", () => {
  it("closes the API once when shutdown is requested repeatedly", async () => {
    // Given
    let closeCount = 0
    const shutdown = createShutdownHandler(
      async () => {
        closeCount += 1
      },
      () => undefined,
    )

    // When
    shutdown()
    shutdown()
    await Promise.resolve()

    // Then
    expect(closeCount).toBe(1)
  })
})
