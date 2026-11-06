import { describe, expect, it } from "vitest"

import { combineChecks, pageSlice } from "./operation-controls"

describe("operation list controls", () => {
  it("keeps every active check for intersection and any check for union", () => {
    expect(combineChecks("and", [true, false, null])).toBe(false)
    expect(combineChecks("or", [true, false, null])).toBe(true)
    expect(combineChecks("nand", [true, false, null])).toBe(true)
    expect(combineChecks("nand", [true, true])).toBe(false)
    expect(combineChecks("nand", [false, false])).toBe(true)
    expect(combineChecks("or", [null, null])).toBe(true)
    expect(combineChecks("nand", [])).toBe(true)
    expect(combineChecks("and", [])).toBe(true)
  })

  it("slices the current page without dropping later rows", () => {
    expect(pageSlice([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4])
  })
})
