import { afterEach, describe, expect, it, vi } from "vitest"

import {
  accountStatistics,
  accountsToCsv,
  assignProxies,
  createBackupAccount,
  createSeedAccounts,
  emptyAccountQuery,
  filterAccounts,
  hideMiddle,
  isRecentlyDeleted,
  mergeTransferKeys,
  recycleAccounts,
  resetBannedStatus,
  restoreAccounts,
  transferStatistics,
} from "./myt-account"

describe("myt-account", () => {
  afterEach(() => vi.restoreAllMocks())

  it("hides the live list from recycled seed accounts", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-09-17T12:00:00").getTime())
    const accounts = createSeedAccounts()
    const live = filterAccounts(accounts, emptyAccountQuery())
    const recycled = filterAccounts(accounts, emptyAccountQuery(), true)

    expect(live.some((item) => item.username === "user.alpha")).toBe(true)
    expect(live.some((item) => item.username === "recycled.one")).toBe(false)
    expect(recycled.map((item) => item.username)).toEqual(["recycled.one"])
    const recycledAccount = accounts.find((item) => item.id === 3008)
    if (recycledAccount === undefined) throw new Error("missing recycled account")
    expect(isRecentlyDeleted(recycledAccount)).toBe(true)

    const expiredAccount = {
      ...recycledAccount,
      deleteTime: "2026-09-09 11:08:00",
      id: 3010,
      username: "expired.recycle",
    }
    const recycledWithExpired = filterAccounts(
      [...accounts, expiredAccount],
      emptyAccountQuery(),
      true,
    )
    expect(recycledWithExpired.map((item) => item.username)).toEqual(["recycled.one"])
  })

  it("applies 云大师 quick filters and UID query", () => {
    const accounts = createSeedAccounts()
    const noPassword = filterAccounts(accounts, {
      ...emptyAccountQuery(),
      quick: ["noPassword"],
    })
    const uids = filterAccounts(accounts, {
      ...emptyAccountQuery(),
      uidQuery: "184992211，7123456789012345678",
    })

    expect(noPassword.map((item) => item.username)).toEqual(["user.bravo"])
    expect(uids.map((item) => item.username).sort()).toEqual(["travel.daily", "user.alpha"])
  })

  it("keeps accounts that carry every selected tag", () => {
    const account = (id: number, username: string, tagBucket: string[]) => ({
      ...createBackupAccount({
        app: "tiktok",
        backType: "2",
        createTime: "2026-10-14 12:00:00",
        deviceId: 1,
        deviceSeq: 1,
        id,
        password: "",
        proxyId: null,
        tag: "",
        username,
      }),
      tagBucket,
    })
    const accounts = [
      account(1, "alpha", ["甲", "乙"]),
      account(2, "beta", ["丙"]),
      account(3, "gamma", ["丁"]),
    ]

    expect(
      filterAccounts(accounts, { ...emptyAccountQuery(), tagBucket: ["甲", "乙"] }).map(
        (item) => item.username,
      ),
    ).toEqual(["alpha"])
    expect(
      filterAccounts(accounts, { ...emptyAccountQuery(), tagBucket: ["乙", "丙"] }).map(
        (item) => item.username,
      ),
    ).toEqual([])
    expect(
      filterAccounts(accounts, { ...emptyAccountQuery(), tagBucket: ["甲"] }).map(
        (item) => item.username,
      ),
    ).toEqual(["alpha"])
  })

  it("keeps only accounts missing a group, tag, or remark", () => {
    const account = (id: number, username: string, tag: string, tagBucket: string[], remark: string) => ({
      ...createBackupAccount({
        app: "tiktok",
        backType: "2",
        createTime: "2026-10-14 12:00:00",
        deviceId: 1,
        deviceSeq: 1,
        id,
        password: "",
        proxyId: null,
        tag,
        username,
      }),
      remark,
      tagBucket,
    })
    const accounts = [
      account(1, "grouped", "测试", ["甲"], "急急急"),
      account(2, "blank", "", [], ""),
    ]
    expect(
      filterAccounts(accounts, { ...emptyAccountQuery(), ungrouped: true }).map((item) => item.username),
    ).toEqual(["blank"])
    expect(
      filterAccounts(accounts, { ...emptyAccountQuery(), untagged: true }).map((item) => item.username),
    ).toEqual(["blank"])
    expect(
      filterAccounts(accounts, { ...emptyAccountQuery(), unremarked: true }).map((item) => item.username),
    ).toEqual(["blank"])
  })

  it("matches mixed identity, exact remark and every region", () => {
    const row = (
      id: number,
      username: string,
      uid: string,
      remark: string,
      region: string,
    ) => ({
      ...createBackupAccount({
        app: "tiktok",
        backType: "2",
        createTime: "2026-10-14 12:00:00",
        deviceId: 1,
        deviceSeq: 1,
        id,
        password: "",
        proxyId: null,
        tag: "",
        username,
      }),
      region,
      remark,
      uid,
    })
    const accounts = [
      row(1, "Alpha", "uid-1", "墨西哥", "US"),
      row(2, "beta", "uid-2", "备注甲", "GB"),
    ]

    expect(
      filterAccounts(accounts, { ...emptyAccountQuery(), identity: "alpha\nuid-2" }).map(
        (item) => item.username,
      ),
    ).toEqual(["Alpha", "beta"])
    expect(
      filterAccounts(accounts, { ...emptyAccountQuery(), userRemark: "墨西哥" }).map(
        (item) => item.username,
      ),
    ).toEqual(["Alpha"])
    expect(
      filterAccounts(accounts, { ...emptyAccountQuery(), region: ["US", "GB"] }).map(
        (item) => item.username,
      ),
    ).toEqual([])
    expect(
      filterAccounts(accounts, {
        ...emptyAccountQuery(),
        identity: "alpha",
        region: ["US"],
        userRemark: "墨西哥",
      }).map((item) => item.username),
    ).toEqual(["Alpha"])
  })

  it("groups statistics and transfer codes from seed accounts", () => {
    const accounts = createSeedAccounts()
    const stats = accountStatistics(accounts)
    const transfers = transferStatistics(accounts)

    expect(stats.find((row) => row.tag === "美国区")).toEqual({
      available: 1,
      baned: 1,
      tag: "美国区",
      total: 2,
      transferred: 0,
    })
    expect(transfers.find((row) => row.transferKey.startsWith("a1b2"))?.count).toBe(3)
  })

  it("recycles then restores without echoing secrets into CSV", () => {
    const accounts = recycleAccounts(createSeedAccounts(), [3001], "2026-09-17 12:00:00")
    expect(filterAccounts(accounts, emptyAccountQuery()).some((item) => item.id === 3001)).toBe(
      false,
    )
    const restored = restoreAccounts(accounts, [3001], "2026-09-17 12:01:00")
    expect(filterAccounts(restored, emptyAccountQuery()).some((item) => item.id === 3001)).toBe(
      true,
    )
    const csv = accountsToCsv(filterAccounts(restored, emptyAccountQuery()))
    expect(csv).toContain("已配置")
    expect(csv).not.toContain("Acc#SeedAlpha")
    expect(hideMiddle("a1b2c3d4e5f6789012345678901234ab")).toBe("a1b2****34ab")
  })

  it("resets banned accounts and assigns proxies by group", () => {
    const reset = resetBannedStatus(createSeedAccounts(), "美国区", "2026-09-17 12:00:00")
    expect(reset.find((item) => item.id === 3005)?.status).toBe("0")
    const assigned = assignProxies(reset, ["亮2"], [101, 102], "average", "2026-09-17 12:00:00")
    expect(assigned.find((item) => item.username === "user.bravo")?.proxyId).toBe(102)
    const merged = mergeTransferKeys(
      assigned,
      ["a1b2c3d4e5f6789012345678901234ab", "b2c3d4e5f6789012345678901234abcd"],
      "ffffffffffffffffffffffffffffffff",
      "2026-09-17 12:00:00",
    )
    expect(merged.filter((item) => item.transferKey.startsWith("ffff")).length).toBe(4)
  })
})
