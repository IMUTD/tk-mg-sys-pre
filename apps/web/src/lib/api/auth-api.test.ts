import { describe, expect, it } from "vitest"

import { resolveApiBaseUrl } from "./auth-api"

describe("resolveApiBaseUrl", () => {
  it("keeps the API prefix at the site root from a nested route", () => {
    // Given
    const nestedRouteOrigin = "https://tk-mg.intranet/operations/resources"

    // When
    const resolved = resolveApiBaseUrl("/api", nestedRouteOrigin)

    // Then
    expect(resolved).toBe("https://tk-mg.intranet/api")
  })
})
