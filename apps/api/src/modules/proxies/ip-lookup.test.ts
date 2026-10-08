import { describe, expect, it } from "bun:test"
import { GroupIdSchema } from "../../lib/authorization"
import { ProxyConfigurationSchema } from "./configuration"
import { createIpLookupTransport, detectProxyIp, ipLookupUrl } from "./ip-lookup"
import { ProxyProbeError } from "./probe"
import { type ProbeSnapshot, ProxyIdSchema } from "./repository"

const options = { channel: "cn", mode: "detailed", useTurbo: false } as const
const snapshot = (host = "8.8.8.8", configuration = {}): ProbeSnapshot => ({
  token: "lookup",
  nodes: [],
  proxy: {
    id: ProxyIdSchema.parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    groupId: GroupIdSchema.parse("11111111-1111-4111-8111-111111111111"),
    name: "lookup",
    endpoint: `${host}:1`,
    note: "",
    tags: [],
    encryptedCredentials: "must-not-decrypt",
    credentialState: "configured",
    status: "ready",
    createdAt: new Date(),
    updatedAt: new Date(),
    configuration: ProxyConfigurationSchema.parse({ host, port: 1, ...configuration }),
  },
})
const information = (ip = "8.8.8.8") => ({ ip, country: "US", city: "Test", isp: "Test ISP" })
const providerBody = (ip = "8.8.8.8") => ({
  ip,
  country_code: "US",
  country: "United States",
  city: "Test",
  isp: "Test ISP",
})

describe("IP-only lookup", () => {
  it("only queries the configured IP, ignoring unusable ports, credentials and acceleration", async () => {
    let queried = ""
    const result = await detectProxyIp(
      snapshot(),
      { ...options, useTurbo: true },
      {
        query: async (ip) => {
          queried = ip
          return { delay: 12, information: information(ip) }
        },
      },
    )
    expect(queried).toBe("8.8.8.8")
    expect(result).toMatchObject({
      ok: true,
      detection_type: "ip_lookup",
      connectivity_checked: false,
      target_ip: "8.8.8.8",
      use_turbo: false,
      accelerator_id: null,
      message: "ip_information_found",
      results: [{ url: "https://api.ip.sb/geoip/8.8.8.8", response_body: { ip: "8.8.8.8" } }],
    })
  })
  it("resolves a hostname and queries its public answer, not the service egress", async () => {
    const result = await detectProxyIp(
      snapshot("public.example"),
      options,
      {
        query: async (ip) => {
          expect(ip).toBe("8.8.8.8")
          return { delay: 1, information: information(ip) }
        },
      },
      async (host) => {
        expect(host).toBe("public.example")
        return "8.8.8.8"
      },
    )
    expect(result.target_ip).toBe("8.8.8.8")
    expect(result.ok).toBe(true)
  })
  it("rejects private and reserved addresses without contacting a provider", async () => {
    let calls = 0
    for (const host of ["127.0.0.1", "100.65.10.245", "203.0.113.1", "::1"]) {
      const result = await detectProxyIp(snapshot(host), options, {
        query: async () => {
          calls++
          return { delay: 1, information: information() }
        },
      })
      expect(result).toMatchObject({ ok: false, message: "proxy_address_not_public", results: [] })
    }
    expect(calls).toBe(0)
  })
  it("keeps expected-country validation while retaining the queried IP information", async () => {
    const result = await detectProxyIp(snapshot("8.8.8.8", { region: "CA" }), options, {
      query: async (ip) => ({ delay: 1, information: information(ip) }),
    })
    expect(result).toMatchObject({
      ok: false,
      message: "proxy_region_mismatch",
      results: [{ response_body: { ip: "8.8.8.8", country: "US" } }],
    })
  })
  it("rejects provider IP mismatches and sanitizes unexpected errors", async () => {
    expect(
      await detectProxyIp(snapshot(), options, {
        query: async () => ({ delay: 1, information: information("1.1.1.1") }),
      }),
    ).toMatchObject({ ok: false, message: "ip_information_mismatch", results: [] })
    const result = await detectProxyIp(snapshot(), options, {
      query: async () => {
        throw new Error("private-secret")
      },
    })
    expect(result.message).toBe("ip_information_failed")
    expect(JSON.stringify(result)).not.toContain("private-secret")
  })
  it("builds fixed provider URLs for IPv4 and IPv6", () => {
    expect(ipLookupUrl("8.8.8.8", "us")).toBe("https://api.ipapi.is/?q=8.8.8.8")
    expect(ipLookupUrl("2606:4700:4700::1111", "cn")).toBe(
      "https://api.ip.sb/geoip/2606%3A4700%3A4700%3A%3A1111",
    )
    expect(() => ipLookupUrl("http://127.0.0.1", "cn")).toThrow()
  })
})

describe("fixed HTTPS IP-information transport", () => {
  it("requests an explicit IP without authentication or a proxy tunnel", async () => {
    const transport = createIpLookupTransport(async (url, init) => {
      expect(url).toBe("https://api.ip.sb/geoip/8.8.8.8")
      expect(init.redirect).toBe("error")
      expect(init.signal).toBeInstanceOf(AbortSignal)
      expect(new Headers(init.headers).has("authorization")).toBe(false)
      expect(new Headers(init.headers).has("cookie")).toBe(false)
      expect(init).not.toHaveProperty("proxy")
      expect(init).not.toHaveProperty("body")
      return Response.json(providerBody())
    }, 0)
    expect((await transport.query("8.8.8.8", options, 1000)).information.ip).toBe("8.8.8.8")
    await transport.close?.()
  })
  it("queries IPAPI with the requested IP rather than its default client address", async () => {
    const transport = createIpLookupTransport(async (url) => {
      expect(url).toBe("https://api.ipapi.is/?q=8.8.8.8")
      return Response.json({
        ip: "8.8.8.8",
        country: "United States",
        region: "",
        city: "",
        company: "Google",
        asn: "AS15169",
      })
    }, 0)
    expect(
      (await transport.query("8.8.8.8", { ...options, channel: "us" }, 1000)).information,
    ).toMatchObject({ ip: "8.8.8.8", country: "US", isp: "Google" })
  })
  it("rejects mismatches and oversized or malformed provider data", async () => {
    for (const response of [
      Response.json(providerBody("1.1.1.1")),
      new Response("x".repeat(65537)),
      Response.json({ error: "private-key" }),
    ]) {
      const transport = createIpLookupTransport(async () => response, 0)
      await expect(transport.query("8.8.8.8", options, 1000)).rejects.toThrow()
    }
  })
  it("honors provider throttling without retries or provider fallback", async () => {
    let calls = 0
    const transport = createIpLookupTransport(async () => {
      calls++
      return new Response("", { status: 429, headers: { "Retry-After": "60" } })
    }, 0)
    for (let i = 0; i < 2; i++)
      await expect(transport.query("8.8.8.8", options, 1000)).rejects.toThrow(
        "ip_provider_rate_limited",
      )
    expect(calls).toBe(1)
  })
  it("aborts timeout and shutdown requests and releases concurrency capacity", async () => {
    const transport = createIpLookupTransport(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        }),
      0,
    )
    await expect(transport.query("8.8.8.8", options, 10)).rejects.toThrow("ip_lookup_timeout")
    const running = transport.query("8.8.8.8", options, 1000)
    await transport.close?.()
    await expect(running).rejects.toThrow()
    await expect(transport.query("8.8.8.8", options, 1000)).rejects.toThrow(
      "probe_capacity_exceeded",
    )
  })
  it("caps concurrency and rate-limits request starts", async () => {
    const began: number[] = []
    const transport = createIpLookupTransport(async () => {
      began.push(Date.now())
      await Bun.sleep(100)
      return Response.json(providerBody())
    }, 30)
    const running = Array.from({ length: 4 }, () => transport.query("8.8.8.8", options, 1000))
    await expect(transport.query("8.8.8.8", options, 1000)).rejects.toThrow(
      "probe_capacity_exceeded",
    )
    await Promise.all(running)
    expect(began).toHaveLength(4)
    expect((began.at(-1) ?? 0) - (began[0] ?? 0)).toBeGreaterThanOrEqual(75)
  })
  it("persists an explicit provider limit as a failed lookup", async () => {
    const result = await detectProxyIp(snapshot(), options, {
      query: async () => {
        throw new ProxyProbeError("ip_provider_rate_limited")
      },
    })
    expect(result).toMatchObject({
      ok: false,
      status: 429,
      message: "ip_provider_rate_limited",
      detection_type: "ip_lookup",
      connectivity_checked: false,
    })
  })
})
