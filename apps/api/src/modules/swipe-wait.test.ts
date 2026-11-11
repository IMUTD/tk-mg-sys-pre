import { describe, expect, test } from "bun:test"

import { normalizeSwipeWait, swipeWaitError } from "./swipe-wait"

const ready = {
  swipeResourceId: "com.app:id/feed",
  up: "700",
  text: "Follow",
  interval: "800",
}

describe("持续滑动等待", () => {
  test("两套条件齐全可以保存", () => {
    expect(swipeWaitError(ready)).toBeNull()
  })

  test("缺出现条件", () => {
    expect(swipeWaitError({ ...ready, text: "  " })).toBe("出现条件为空")
  })

  test("缺滑动条件", () => {
    expect(swipeWaitError({ ...ready, swipeResourceId: "" })).toBe("滑动条件为空")
  })

  test("方向全 0", () => {
    expect(swipeWaitError({ ...ready, up: "0" })).toBe("滑动距离无效")
  })

  test("间隔超出范围", () => {
    expect(swipeWaitError({ ...ready, interval: "60001" })).toBe("间隔无效")
    expect(swipeWaitError({ ...ready, interval: "-1" })).toBe("间隔无效")
  })

  test("没写间隔时按 500 保存", () => {
    const input = { ...ready, interval: "" }
    expect(swipeWaitError(input)).toBeNull()
    normalizeSwipeWait(input)
    expect(input.interval).toBe("500")
    expect(input.index).toBe("0")
  })
})
