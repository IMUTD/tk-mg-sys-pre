import { describe, expect, it } from "vitest"
import {
  applyCheckResult,
  batchUpdateByTags,
  detectedRegionCode,
  emptyProxy,
  emptyProxyQuery,
  expirePresetOptions,
  filterProxies,
  proxyDetectedRegion,
  UNDETECTED_REGION,
  genCurlCmd,
  importProxies,
  proxiesToCsv,
  proxyTypeLabel,
} from "./myt-proxy"
import { createTestProxies } from "./myt-proxy.test-fixtures"

describe("myt-proxy", () => {
  it("filters seed proxies by 云大师 query fields", () => {
    const proxies = createTestProxies()
    const byTag = filterProxies(proxies, { ...emptyProxyQuery(), tag: "亮2" })
    const favorite = filterProxies(proxies, { ...emptyProxyQuery(), favorite: true })
    const noTag = filterProxies(proxies, { ...emptyProxyQuery(), noTag: true })
    const socks = filterProxies(proxies, { ...emptyProxyQuery(), type: "2" })
    const china = filterProxies(proxies, { ...emptyProxyQuery(), region: "CN" })
    const undetected = filterProxies(proxies, {
      ...emptyProxyQuery(),
      region: UNDETECTED_REGION,
    })
    const search = filterProxies(proxies, { ...emptyProxyQuery(), search: "华东" })
    const cutoff = expirePresetOptions(new Date())[0]
    if (cutoff === undefined) throw new Error("missing expire preset")
    const expiring = filterProxies(proxies, { ...emptyProxyQuery(), expiredTime: cutoff.value })

    expect(byTag.map((item) => item.id).sort()).toEqual([101, 106])
    expect(favorite.map((item) => item.id)).toEqual([106])
    expect(noTag.map((item) => item.remark)).toEqual(["临时线路"])
    expect(socks.every((item) => item.type === "2")).toBe(true)
    expect(china.map((item) => item.id)).toEqual([101])
    expect(proxyDetectedRegion(proxies[0]!)).toBe("CN")
    expect(undetected.map((item) => item.id).sort()).toEqual([102, 103, 104, 105, 106])
    expect(search.map((item) => item.remark)).toEqual(["华东代理"])
    expect(expiring.map((item) => item.remark)).toEqual(["临时线路"])
  })

  it("requires every selected remark and keeps blank remarks on 未备注", () => {
    const now = "2026-10-15 12:00:00"
    const named = (id: number, remark: string) => ({ ...emptyProxy(id, now), remark })
    const proxies = [named(1, "华东"), named(2, `华东${"\u001e"}备用`), named(3, "")]
    expect(
      filterProxies(proxies, { ...emptyProxyQuery(), remarks: ["华东", "备用"] }).map(
        (item) => item.id,
      ),
    ).toEqual([2])
    expect(
      filterProxies(proxies, { ...emptyProxyQuery(), unremarked: true }).map((item) => item.id),
    ).toEqual([3])
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
    const csv = proxiesToCsv(createTestProxies())

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
    expect(
      detectedRegionCode({
        channel: "cn",
        check_time: 1,
        failures: 0,
        include_response: true,
        message: "proxy_online",
        mode: "detailed",
        ok: true,
        results: [{ delay: 1, ok: true, response_body: { country: "jp", ip: "1.1.1.1" }, status: 200, url: "ip" }],
        status: 200,
        successes: 1,
        use_turbo: false,
      }),
    ).toBe("JP")
  })

  it("simulates local detect results and batch tag updates", () => {
    const now = "2026-09-17 12:00:00"
    const checked = applyCheckResult(
      createTestProxies(),
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
