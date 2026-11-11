import { describe, expect, it } from "vitest"

import { applyScreenToParams, paramsForSwipeDirection, swipeDirectionOf, withInferredSwipeDirection } from "./screen-map"

const upward = {
  direction: "up",
  millis: "400",
  x0: "540",
  x1: "540",
  y0: "1600",
  y1: "900",
}

const point = (x: number, y: number) => ({ h: 1920, w: 1080, x, y })

describe("swipe direction", () => {
  it("keeps the same stroke when the direction stays up", () => {
    expect(paramsForSwipeDirection(upward, "up")).toMatchObject({
      x0: "540",
      x1: "540",
      y0: "1600",
      y1: "900",
    })
  })

  it("reverses that stroke for down, left, and right", () => {
    expect(paramsForSwipeDirection(upward, "down")).toMatchObject({
      direction: "down",
      x0: "540",
      x1: "540",
      y0: "900",
      y1: "1600",
    })
    expect(paramsForSwipeDirection(upward, "left")).toMatchObject({
      x0: "890",
      x1: "190",
      y0: "1250",
      y1: "1250",
    })
    expect(paramsForSwipeDirection(upward, "right")).toMatchObject({
      x0: "190",
      x1: "890",
      y0: "1250",
      y1: "1250",
    })
  })

  it("reads an old upward stroke as up", () => {
    expect(swipeDirectionOf({ x0: "540", x1: "540", y0: "1600", y1: "900" })).toBe("up")
  })

  it("follows a finished coordinate edit", () => {
    expect(withInferredSwipeDirection({ ...upward, y0: "900", y1: "1600" }).direction).toBe("down")
    expect(withInferredSwipeDirection({ ...upward, y1: "" }).direction).toBe("up")
  })

  it("moves the end along the chosen direction from a tapped start", () => {
    const applied = applyScreenToParams({ ...upward, direction: "left" }, point(800, 1000), point(800, 1000))
    expect(applied?.params).toMatchObject({
      direction: "left",
      x0: "800",
      x1: "368",
      y0: "1000",
      y1: "1000",
    })
  })

  it("keeps a dragged stroke and records its direction", () => {
    const applied = applyScreenToParams(upward, point(200, 800), point(700, 830))
    expect(applied?.params).toMatchObject({
      direction: "right",
      x0: "200",
      x1: "700",
      y0: "800",
      y1: "830",
    })
  })
})
