import { describe, expect, it } from "bun:test"

import { createInMemoryAccountPoolRepository } from "./repository"
import { createAccountPoolService } from "./service"

const groupId = "11111111-1111-4111-8111-111111111111"
const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const firstOperatorId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const secondOperatorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

describe("account-pool service", () => {
  it("creates exactly one active lease when concurrent operators request the same account", async () => {
    // Given
    const repository = createInMemoryAccountPoolRepository([{ accountId, groupId }])
    const service = createAccountPoolService(repository)

    // When
    const [first, second] = await Promise.all([
      service.lease({ accountId, groupId, operatorId: firstOperatorId }),
      service.lease({ accountId, groupId, operatorId: secondOperatorId }),
    ])

    // Then
    expect([first.kind, second.kind].sort()).toEqual(["conflict", "leased"])
  })

  it("allows a designated administrator to reclaim another operator's active lease", async () => {
    // Given
    const repository = createInMemoryAccountPoolRepository([{ accountId, groupId }])
    const service = createAccountPoolService(repository)
    await service.lease({ accountId, groupId, operatorId: firstOperatorId })

    // When
    const reclaimed = await service.release({
      accountId,
      allowReclaim: true,
      groupId,
      operatorId: secondOperatorId,
    })

    // Then
    expect(reclaimed).toBe(true)
  })

  it("does not allow an ordinary operator to return another operator's active lease", async () => {
    // Given
    const repository = createInMemoryAccountPoolRepository([{ accountId, groupId }])
    const service = createAccountPoolService(repository)
    await service.lease({ accountId, groupId, operatorId: firstOperatorId })

    // When
    const released = await service.release({
      accountId,
      allowReclaim: false,
      groupId,
      operatorId: secondOperatorId,
    })

    // Then
    expect(released).toBe(false)
  })
})
