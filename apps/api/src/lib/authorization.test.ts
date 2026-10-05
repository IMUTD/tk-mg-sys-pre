import { describe, expect, it } from "bun:test"

import { canAccessGroup, createAccessScope, GroupIdSchema } from "./authorization"

describe("canAccessGroup", () => {
  it("returns false when an operator is outside the requested group", () => {
    // Given
    const scope = createAccessScope({
      groupIds: [GroupIdSchema.parse("11111111-1111-4111-8111-111111111111")],
      permissions: ["resources:read"],
      role: "operator",
    })
    const requestedGroupId = GroupIdSchema.parse("22222222-2222-4222-8222-222222222222")

    // When
    const allowed = canAccessGroup(scope, requestedGroupId)

    // Then
    expect(allowed).toBe(false)
  })

  it("returns true when an administrator requests any group", () => {
    // Given
    const scope = createAccessScope({
      groupIds: [],
      permissions: ["resources:read"],
      role: "administrator",
    })
    const requestedGroupId = GroupIdSchema.parse("22222222-2222-4222-8222-222222222222")

    // When
    const allowed = canAccessGroup(scope, requestedGroupId)

    // Then
    expect(allowed).toBe(true)
  })
})
