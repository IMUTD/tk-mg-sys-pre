import { describe, expect, it } from "bun:test"

import { normalizeScreenAct, screenActError } from "./screen-act"

const click = {
  mainAction: "ClickNode",
  mainText: "Follow",
}

describe("屏幕行为", () => {
  it("一段节点点击可以保存", () => {
    expect(screenActError(click)).toBeNull()
  })

  it("三段都空", () => {
    expect(screenActError({ beforeAction: "", mainAction: " ", afterAction: "" })).toBe("屏幕行为为空")
  })

  it("条件为空", () => {
    expect(screenActError({ mainAction: "WaitNode" })).toBe("条件为空")
  })

  it("间隔超出范围", () => {
    expect(screenActError({ ...click, interval: "60001" })).toBe("间隔无效")
  })

  it("关注点无效", () => {
    expect(screenActError({ ...click, mainFocus: "middle" })).toBe("关注点无效")
  })

  it("没写间隔和通过时补默认值", () => {
    const input: Record<string, string> = { mainAction: "ClickNode", mainText: "Follow" }
    expect(screenActError(input)).toBeNull()
    normalizeScreenAct(input)
    expect(input.interval).toBe("500")
    expect(input.mainPass).toBe("on")
  })

  it("持续滑动等待可以收进一段", () => {
    const input: Record<string, string> = {
      mainAction: "SwipeWait",
      mainFocus: "middle",
      mainSwipeText: "feed",
      mainText: "Follow",
      mainUp: "100",
    }
    expect(screenActError(input)).toBeNull()
    normalizeScreenAct(input)
    expect(input.mainPass).toBe("on")
    expect(input.mainSwipeInterval).toBe("500")
  })

  it("持续滑动等待沿用原来的失败原因", () => {
    expect(screenActError({ mainAction: "SwipeWait", mainSwipeText: "feed", mainUp: "100" })).toBe("出现条件为空")
    expect(screenActError({ mainAction: "SwipeWait", mainText: "Follow", mainUp: "100" })).toBe("滑动条件为空")
    expect(screenActError({ mainAction: "SwipeWait", mainSwipeText: "feed", mainText: "Follow" })).toBe("滑动距离无效")
    expect(
      screenActError({
        mainAction: "SwipeWait",
        mainSwipeInterval: "60001",
        mainSwipeText: "feed",
        mainText: "Follow",
        mainUp: "100",
      }),
    ).toBe("间隔无效")
  })
})
