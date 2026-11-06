import { expect, it } from "bun:test"
import { clickChanceReady, clickJumpPassed, jumpNodesShouldSkip, jumpTag, jumpWhenMode, jumpWriteBack, jumpWritePair, statusShouldJump } from "./jump-nodes"

it("keeps a missing jump switch on success", () => {
  expect(jumpWhenMode(undefined)).toBe("success")
  expect(jumpWhenMode("")).toBe("success")
  expect(jumpWhenMode("later")).toBeNull()
})

it("keeps a missing live-check jump switch off", () => {
  expect(jumpWhenMode(undefined, "off")).toBe("off")
  expect(statusShouldJump(true, "success")).toBe(true)
  expect(statusShouldJump(false, "success")).toBe(false)
  expect(statusShouldJump(false, "failure")).toBe(true)
  expect(statusShouldJump(true, "failure")).toBe(false)
  expect(statusShouldJump(false, "off")).toBe(false)
})

it("accepts a jump tag up to 64 characters", () => {
  expect(jumpTag(undefined)).toBe("")
  expect(jumpTag("  已登录  ")).toBe("已登录")
  expect(jumpTag("a".repeat(64))).toHaveLength(64)
  expect(jumpTag("a".repeat(65))).toBeNull()
  expect(jumpTag(1)).toBeNull()
})

it("picks a legacy tag or a chosen field", () => {
  const legacy = { tagOnFailure: "未登录", tagOnSuccess: " 已登录 " }
  expect(jumpWriteBack("2", legacy)).toEqual({
    field: "tags",
    hit: true,
    label: "标签",
    value: "已登录",
  })
  expect(jumpWriteBack("0", legacy)?.value).toBe("未登录")
  expect(jumpWriteBack(undefined, legacy)).toBeNull()
  expect(jumpWriteBack("2", { tagOnFailure: "未登录" })).toBeNull()
  expect(jumpWriteBack("0", {})).toBeNull()
  expect(
    jumpWriteBack("2", { writeOnSuccessField: "follower", writeOnSuccessValue: "1200" }),
  ).toEqual({ field: "follower", hit: true, label: "粉丝量", value: "1200" })
  expect(
    jumpWriteBack("2", {
      tagOnSuccess: "已登录",
      writeOnSuccessField: "",
      writeOnSuccessValue: "",
    }),
  ).toBeNull()
  expect(jumpWritePair("follower", "01")).toBeNull()
  expect(jumpWritePair("follower", "0")).toEqual({ field: "follower", value: "0" })
  expect(jumpWritePair("", "已登录")).toBeNull()
  expect(jumpWritePair("identifier", "a")).toBeNull()
})

it("accepts a click chance from 0 to 100 and treats a blank value as ready", () => {
  expect(clickChanceReady(undefined)).toBe(true)
  expect(clickChanceReady("")).toBe(true)
  expect(clickChanceReady("0")).toBe(true)
  expect(clickChanceReady("100")).toBe(true)
  expect(clickChanceReady("37")).toBe(true)
  expect(clickChanceReady("101")).toBe(false)
  expect(clickChanceReady("00")).toBe(false)
  expect(clickJumpPassed("true")).toBe(true)
  expect(clickJumpPassed(true)).toBe(true)
  expect(clickJumpPassed("false")).toBe(false)
  expect(clickJumpPassed(undefined)).toBe(false)
})

it("skips later steps only for the selected jump result", () => {
  expect(jumpNodesShouldSkip(2, "success")).toBe(true)
  expect(jumpNodesShouldSkip(0, "success")).toBe(false)
  expect(jumpNodesShouldSkip(0, "failure")).toBe(true)
  expect(jumpNodesShouldSkip(1, "failure")).toBe(false)
  expect(jumpNodesShouldSkip(2, "off")).toBe(false)
  expect(jumpNodesShouldSkip(0, "off")).toBe(false)
})
