import { describe, expect, it } from "vitest"

import { createSeedAccounts } from "../accounts/myt-account"
import {
  allowCopy,
  createSeedTaskRes,
  emptyCreatePoolQuery,
  emptyTaskResQuery,
  filterSourceAccounts,
  filterTaskRes,
  remainingDays,
  unusedAccountsToCsv,
  validatePoolKey,
} from "./myt-task-res"

describe("myt-task-res", () => {
  it("filters seed task resources by 云大师 query fields", () => {
    const pools = createSeedTaskRes()
    const byKey = filterTaskRes(pools, { ...emptyTaskResQuery(), key: "1107" })
    const byRemark = filterTaskRes(pools, { ...emptyTaskResQuery(), remark: "测试" })
    const byId = filterTaskRes(pools, { ...emptyTaskResQuery(), id: "101" })

    expect(byKey.map((item) => item.id)).toEqual([102, 101])
    expect(byRemark.map((item) => item.key)).toEqual(["gen-1108测试"])
    expect(byId.map((item) => item.key)).toEqual(["1107发布"])
    expect(filterTaskRes(pools, emptyTaskResQuery())[0]?.id).toBe(103)
  })

  it("hides copy on generated pools without filter condition", () => {
    const pools = createSeedTaskRes()
    const generated = pools.find((item) => item.key.startsWith("gen-"))
    const publish = pools.find((item) => item.key === "1107发布")
    if (generated === undefined || publish === undefined) throw new Error("missing seed pool")

    expect(allowCopy(generated)).toBe(false)
    expect(allowCopy(publish)).toBe(true)
  })

  it("rejects pool keys that contain plus signs", () => {
    expect(validatePoolKey("")).toBe("编码不能为空")
    expect(validatePoolKey("发布+1")).toBe("账号池名不能包含 +")
    expect(validatePoolKey("1107发布")).toBeNull()
  })

  it("filters source accounts by local device and skips recycled rows", () => {
    const accounts = filterSourceAccounts(createSeedAccounts(), {
      ...emptyCreatePoolQuery(),
      backType: "2",
      deviceId: 23849,
    })

    expect(accounts.map((item) => item.id)).toEqual([3001, 3004])
    expect(accounts.some((item) => item.id === 3008)).toBe(false)
  })

  it("exports unused accounts without echoing passwords", () => {
    const pool = createSeedTaskRes().find((item) => item.key === "1107发布")
    if (pool === undefined) throw new Error("missing seed pool")
    const csv = unusedAccountsToCsv(pool)
    expect(csv).toContain("UID")
    expect(csv).not.toContain("Acc#SeedAlpha")
    expect(remainingDays("2026-09-10 10:00:00", new Date(2026, 8, 17, 16, 0, 0))).toBe("23天")
  })
})
