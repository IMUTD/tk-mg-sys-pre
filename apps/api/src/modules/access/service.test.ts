import { describe, expect, it } from "bun:test"

import { createAccessScope, GroupIdSchema, Permission, Role } from "../../lib/authorization"
import { requireGroupAccess, requirePermission } from "./service"

describe("requirePermission", () => {
  it("allows an administrator without duplicating every permission in its scope", () => {
    // Given
    const scope = createAccessScope({
      groupIds: [],
      permissions: [],
      role: Role.Administrator,
    })

    // When
    const result = requirePermission(scope, Permission.ResourcesRead)

    // Then
    expect(result).toEqual({ kind: "allowed" })
  })

  it("denies an operator when the required permission is absent", () => {
    // Given
    const scope = createAccessScope({
      groupIds: [],
      permissions: [],
      role: Role.Operator,
    })

    // When
    const result = requirePermission(scope, Permission.ResourcesWrite)

    // Then
    expect(result).toEqual({ kind: "denied", reason: "permission" })
  })
})

describe("requireGroupAccess", () => {
  it("hides a group from an operator outside that group", () => {
    // Given
    const scope = createAccessScope({
      groupIds: [GroupIdSchema.parse("11111111-1111-4111-8111-111111111111")],
      permissions: [Permission.ResourcesRead],
      role: Role.Operator,
    })
    const requestedGroupId = GroupIdSchema.parse("22222222-2222-4222-8222-222222222222")

    // When
    const result = requireGroupAccess(scope, requestedGroupId)

    // Then
    expect(result).toEqual({ kind: "hidden" })
  })
})
