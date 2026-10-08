import { describe, expect, it } from "vitest"

import { poolTestDetails, poolTestDevice, poolTestSources } from "../../test/account-pool-fixtures"
import {
  allowCopy,
  emptyCreatePoolQuery,
  emptyTaskResQuery,
  filterSourceAccounts,
  filterTaskRes,
  poolAccountsToCsv,
  remainingDays,
  unusedAccountsToCsv,
  validatePoolKey,
} from "./myt-task-res"
import { deskPoolDetails, poolDevices, poolFormQuery, sourceAccount } from "./wiring"

const devices = poolDevices([poolTestDevice])
const testPools = () => [
  deskPoolDetails(poolTestDetails(), devices),
  deskPoolDetails(poolTestDetails(102, "1107养号"), devices),
  deskPoolDetails(poolTestDetails(103, "gen-1108测试", poolTestSources(), null), devices),
]

describe("myt-task-res", () => {
  it("filters persisted task resources by 云大师 query fields", () => {
    const pools = testPools()
    const byKey = filterTaskRes(pools, { ...emptyTaskResQuery(), key: "1107" })
    const byRemark = filterTaskRes(pools, { ...emptyTaskResQuery(), remark: "测试" })
    const byId = filterTaskRes(pools, { ...emptyTaskResQuery(), id: "101" })

    expect(byKey.map((item) => item.id)).toEqual([102, 101])
    expect(byRemark.map((item) => item.key)).toEqual(["gen-1108测试"])
    expect(byId.map((item) => item.key)).toEqual(["1107发布"])
    expect(filterTaskRes(pools, emptyTaskResQuery())[0]?.id).toBe(103)
  })

  it("hides copy on generated pools without filter condition", () => {
    const pools = testPools()
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

  it("filters sources by device and skips deleted, disabled and transferred rows", () => {
    const first = poolTestSources()[0]
    if (first === undefined) throw new Error("missing fixture")
    const account = sourceAccount(first, 0, devices)
    const candidates = [
      account,
      { ...account, id: 2, deleted: true },
      { ...account, id: 3, enable: false },
      { ...account, id: 4, transferred: true },
      { ...account, id: 5, deviceId: 2 },
      { ...account, id: 6, transferKey: "not-eligible" },
    ]
    const found = filterSourceAccounts(candidates, { ...emptyCreatePoolQuery(), deviceId: 1 })
    expect(found.map((item) => item.id)).toEqual([1])
  })

  it("exports unused accounts without echoing passwords", () => {
    const pool = testPools().find((item) => item.key === "1107发布")
    if (pool === undefined) throw new Error("missing seed pool")
    const csv = unusedAccountsToCsv(pool)
    expect(csv).toContain("UID")
    expect(csv).not.toContain("Acc#SeedAlpha")
    expect(csv.split("\n")).toHaveLength(3)
    expect(csv).toContain("user.alpha")
    expect(
      poolAccountsToCsv(
        pool.accounts.filter(
          (account) =>
            account.recordId !== undefined &&
            pool.progress[0]?.unusedAccountIds?.includes(account.recordId),
        ),
      ),
    ).not.toContain("user.alpha")
    expect(remainingDays("2026-09-10 10:00:00", new Date(2026, 8, 17, 16, 0, 0))).toBe("23天")
  })

  it("quotes CSV cells and neutralizes spreadsheet formulas", () => {
    const first = deskPoolDetails(poolTestDetails(), devices).accounts[0]
    if (first === undefined) throw new Error("missing fixture")
    const csv = poolAccountsToCsv([{ ...first, username: "=SUM(1,2)", remark: 'a,"b"\nc' }])
    expect(csv).toContain('"\'=SUM(1,2)"')
    expect(csv).toContain('"a,""b""\nc"')
  })

  it("preserves all saved filter fields when copying", () => {
    const detail = poolTestDetails()
    const filter = detail.filterCondition
    if (filter === null) throw new Error("missing fixture filter")
    const pool = deskPoolDetails(
      {
        ...detail,
        filterCondition: {
          ...filter,
          tagInclude: ["标签A"],
          tagExclude: ["标签B"],
          online: true,
          status: "0",
          tagQueryMode: "OR",
        },
      },
      devices,
    )
    expect(poolFormQuery(pool)).toMatchObject({
      deviceId: 1,
      online: true,
      status: "0",
      tagInclude: ["标签A"],
      tagExclude: ["标签B"],
      tagQueryMode: "OR",
    })
  })
})
