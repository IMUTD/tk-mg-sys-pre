import { describe, expect, it } from "bun:test"

import { drawRepeatCount } from "./repository"

describe("drawRepeatCount", () => {
  it("draws the inclusive bounds", () => {
    expect(drawRepeatCount(2, 5, () => 0)).toBe(2)
    expect(drawRepeatCount(2, 5, () => 0.999)).toBe(5)
    expect(drawRepeatCount(4, 4, () => 0.2)).toBe(4)
  })
})
