import { describe, expect, it } from "vitest"

import { addMonths, daysLeft, expirySortKey, expiryState, renewedUntil } from "./service-time"

const now = new Date(2026, 10, 13, 12, 0, 0)
const at = (days: number): string => new Date(now.getTime() + days * 86_400_000).toISOString()

describe("box service time", () => {
  it("classifies boxes by how much paid time is left", () => {
    expect(expiryState(null, now)).toBe("none")
    expect(expiryState(at(-1), now)).toBe("expired")
    expect(expiryState(at(3), now)).toBe("expiring")
    expect(expiryState(at(7), now)).toBe("expiring")
    expect(expiryState(at(8), now)).toBe("active")
  })

  it("rounds days left up and never below zero", () => {
    expect(daysLeft(at(0.2), now)).toBe(1)
    expect(daysLeft(at(10), now)).toBe(10)
    expect(daysLeft(at(-5), now)).toBe(0)
    expect(daysLeft(null, now)).toBe(0)
  })

  it("clamps to the last day of a shorter month like PostgreSQL", () => {
    expect(addMonths(new Date(2027, 0, 31, 9), 1)).toEqual(new Date(2027, 1, 28, 9))
    expect(addMonths(new Date(2028, 0, 31, 9), 1)).toEqual(new Date(2028, 1, 29, 9))
    expect(addMonths(new Date(2026, 10, 13, 9), 12)).toEqual(new Date(2027, 10, 13, 9))
  })

  it("extends unexpired time and restarts expired time from now", () => {
    const future = new Date(2026, 11, 20, 8, 0, 0)
    expect(renewedUntil(future.toISOString(), 3, now)).toEqual(new Date(2027, 2, 20, 8, 0, 0))
    expect(renewedUntil(at(-30), 1, now)).toEqual(new Date(2026, 11, 13, 12, 0, 0))
    expect(renewedUntil(null, 6, now)).toEqual(new Date(2027, 4, 13, 12, 0, 0))
  })

  it("puts never-opened boxes first, then the earliest end", () => {
    const keys = [at(30), null, at(-2), at(3)].map(expirySortKey)
    expect([...keys].sort((a, b) => a - b)).toEqual([
      expirySortKey(null),
      expirySortKey(at(-2)),
      expirySortKey(at(3)),
      expirySortKey(at(30)),
    ])
  })
})
