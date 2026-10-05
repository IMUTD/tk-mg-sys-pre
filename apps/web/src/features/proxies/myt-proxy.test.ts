import { describe, expect, it } from "vitest"

import {
  applyCheckResult,
  batchUpdateByTags,
  createSeedProxies,
  emptyProxyQuery,
  expirePresetOptions,
  filterProxies,
  genCurlCmd,
  importProxies,
  proxiesToCsv,
  proxyTypeLabel,
} from "./myt-proxy"

describe("myt-proxy", () => {
  it("filters seed proxies by 云大师 query fields", () => {
    const proxies = createSeedProxies()
    const byTag = filterProxies(proxies, { ...emptyProxyQuery(), tag: "亮2" })
    const favorite = filterProxies(proxies, { ...emptyProxyQuery(), favorite: true })
    const noTag = filterProxies(proxies, { ...emptyProxyQuery(), noTag: true })
    const socks = filterProxies(proxies, { ...emptyProxyQuery(), type: "2" })
    const search = filterProxies(proxies, { ...emptyProxyQuery(), search: "华东" })
    const cutoff = expirePresetOptions(new Date())[0]
    if (cutoff === undefined) throw new Error("missing expire preset")
    const expiring = filterProxies(proxies, { ...emptyProxyQuery(), expiredTime: cutoff.value })

    expect(byTag.map((item) => item.id).sort()).toEqual([101, 106])
    expect(favorite.map((item) => item.id)).toEqual([106])
    expect(noTag.map((item) => item.remark)).toEqual(["临时线路"])
    expect(socks.every((item) => item.type === "2")).toBe(true)
    expect(search.map((item) => item.remark)).toEqual(["华东代理"])
    expect(expiring.map((item) => item.remark)).toEqual(["临时线路"])
  })

  it("imports SOCKS lines and V2 links without exposing secrets in CSV", () => {
    const socks = importProxies(
      {
        autoSeq: true,
        content: "10.0.0.9|9090|imp-user|imp-pass",
        expiredTime: null,
        proxyType: "static",
        remark: "导入",
        safe: false,
        save: false,
        tag: "导入组",
        tun: false,
        turbo: false,
        type: "2",
      },
      201,
      "2026-09-17 12:00:00",
    )
    const v2 = importProxies(
      {
        autoSeq: false,
        content: "vless://demo-uuid@203.0.113.30:443#demo",
        expiredTime: null,
        proxyType: "static",
        remark: "V2",
        safe: false,
        save: false,
        tag: "加速",
        tun: false,
        turbo: false,
        type: "0",
      },
      301,
      "2026-09-17 12:00:00",
    )
    const csv = proxiesToCsv(createSeedProxies())

    expect(socks[0]).toMatchObject({
      id: 201,
      ip: "10.0.0.9",
      password: "imp-pass",
      port: "9090",
      tag: "导入组-1",
      username: "imp-user",
    })
    expect(v2[0]).toMatchObject({
      extra: "vless://demo-uuid@203.0.113.30:443#demo",
      id: 301,
      ip: "203.0.113.30",
      port: "443",
      type: "0",
    })
    expect(csv).toContain("已配置")
    expect(csv).toContain("华东代理")
    expect(csv).not.toContain("proxy-east-secret")
    expect(csv).not.toContain("imp-pass")
    expect(proxyTypeLabel("2")).toBe("SOCKS5")
  })

  it("simulates local detect results and batch tag updates", () => {
    const now = "2026-09-17 12:00:00"
    const checked = applyCheckResult(
      createSeedProxies(),
      [102, 105],
      { channel: "us", mode: "detailed", useTurbo: false },
      now,
    )
    const updated = batchUpdateByTags(
      checked.proxies,
      [102],
      { expiredTime: "2026-12-01 00:00:00", safe: "on", save: "keep", tun: "on" },
      now,
    )
    const proxy102 = updated.find((item) => item.id === 102)

    expect(checked.succeeded).toBe(2)
    expect(checked.failed).toBe(0)
    expect(proxy102?.tun).toBe(true)
    expect(proxy102?.safe).toBe(true)
    expect(proxy102?.save).toBe(false)
    expect(proxy102?.expiredTime).toBe("2026-12-01 00:00:00")
    expect(proxy102?.result).toContain("10.0.1.8")
    expect(
      genCurlCmd({ ip: "10.0.0.5", password: "x", port: "8080", type: "2", username: "u" }),
    ).toBe("curl -x socks5://u:x@10.0.0.5:8080 https://ipinfo.io")
  })
})
