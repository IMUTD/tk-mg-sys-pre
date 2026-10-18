import { describe, expect, it } from "vitest"

import {
  type DeskAccountPreview,
  emptyDeskQuery,
  matchesDeskQuery,
  normalizeDeskQuery,
  resolveDeskPoolName,
} from "./desk-pool"

const preview = (patch: Partial<DeskAccountPreview> = {}): DeskAccountPreview => ({
  app: "tiktok",
  backType: "",
  deviceId: null,
  favorite: false,
  follower: 0,
  following: 0,
  hasPassword: false,
  hasTotp: false,
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  online: false,
  proxyId: null,
  region: "",
  remark: "",
  status: "4",
  tag: "测试",
  tagBucket: [],
  transferCodes: [],
  uid: "",
  username: "pool@example.test",
  ...patch,
})

describe("desk pool preview", () => {
  it("uses the typed text as the pool name and otherwise keeps the automatic name", () => {
    expect(resolveDeskPoolName("账号状态=正常", "")).toBe("账号状态=正常")
    expect(resolveDeskPoolName("账号状态=正常", "  养号池  ")).toBe("养号池")
    expect(resolveDeskPoolName("", "   ")).toBe("全部账号")
  })

  it("matches every account when no condition is selected", () => {
    expect(matchesDeskQuery(preview(), normalizeDeskQuery(emptyDeskQuery()))).toBe(true)
    expect(
      matchesDeskQuery(preview({ status: "0", tag: "其他" }), normalizeDeskQuery(emptyDeskQuery())),
    ).toBe(true)
  })

  it("includes an unregistered account when the condition does not ask for another status", () => {
    const query = normalizeDeskQuery({ ...emptyDeskQuery(), tag: "测试" })
    expect(matchesDeskQuery(preview(), query)).toBe(true)
    expect(matchesDeskQuery(preview({ tag: "其他" }), query)).toBe(false)
  })

  it("requires every selected remark and still accepts a saved single remark", () => {
    const named = preview({ remark: "甲" })
    const both = preview({ remark: `甲${"\u001e"}乙` })
    const many = normalizeDeskQuery({ ...emptyDeskQuery(), userRemarks: ["甲", "乙"] })
    const saved = normalizeDeskQuery({ ...emptyDeskQuery(), userRemark: "甲" })
    expect(matchesDeskQuery(both, many)).toBe(true)
    expect(matchesDeskQuery(named, many)).toBe(false)
    expect(matchesDeskQuery(preview({ remark: "丙" }), many)).toBe(false)
    expect(matchesDeskQuery(named, saved)).toBe(true)
    expect(matchesDeskQuery(preview({ remark: "乙" }), saved)).toBe(false)
  })

  it("keeps 正常 away from unregistered accounts", () => {
    const query = normalizeDeskQuery({ ...emptyDeskQuery(), status: "0" })
    expect(matchesDeskQuery(preview({ status: "4" }), query)).toBe(false)
    expect(matchesDeskQuery(preview({ status: "0" }), query)).toBe(true)
  })
})
