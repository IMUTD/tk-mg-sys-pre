import { describe, expect, it } from "bun:test"

import { createInMemoryAuditRepository, writeAuditEvent } from "./service"

describe("writeAuditEvent", () => {
  it("persists a denied action with its actor and target", async () => {
    // Given
    const repository = createInMemoryAuditRepository()

    // When
    await writeAuditEvent(repository, {
      action: "resource.export",
      actorId: "11111111-1111-4111-8111-111111111111",
      outcome: "denied",
      target: "group:22222222-2222-4222-8222-222222222222",
    })

    // Then
    expect(repository.all()).toEqual([
      expect.objectContaining({
        action: "resource.export",
        outcome: "denied",
        target: "group:22222222-2222-4222-8222-222222222222",
      }),
    ])
  })
})
