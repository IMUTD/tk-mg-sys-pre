import { describe, expect, it } from "bun:test"
import { GroupIdSchema } from "../../lib/authorization"
import { ProxyConfigurationSchema, parseV2Outbound } from "./configuration"
import {
  buildProbeConfig,
  detectProxy,
  isPublicIp,
  normalizeIpInformation,
  ProxyProbeError,
  resolvePublicHost,
} from "./probe"
import { ProxyIdSchema, type StoredProxy } from "./repository"

const node = (id: string, overrides = {}): StoredProxy => ({
  id: ProxyIdSchema.parse(id),
  groupId: GroupIdSchema.parse("11111111-1111-4111-8111-111111111111"),
  createdAt: new Date(),
  updatedAt: new Date(),
  credentialState: "none",
  encryptedCredentials: "",
  endpoint: "8.8.8.8:8080",
  name: "test",
  note: "",
  tags: [],
  status: "ready",
  configuration: ProxyConfigurationSchema.parse({ host: "8.8.8.8", port: 8080, ...overrides }),
})
const firstId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const secondId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const thirdId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const options = { channel: "us", mode: "detailed", useTurbo: false } as const

describe("proxy probe configuration and safety", () => {
  it("rejects private, reserved, mapped-private, metadata and transition addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.1.1",
      "169.254.169.254",
      "172.16.2.1",
      "192.168.0.1",
      "100.65.10.245",
      "192.0.2.1",
      "203.0.113.1",
      "198.51.100.1",
      "0.0.0.0",
      "::1",
      "fe80::1",
      "fc00::1",
      "::ffff:127.0.0.1",
      "2002:7f00:1::",
      "bad",
    ])
      expect(isPublicIp(ip)).toBe(false)
    expect(isPublicIp("8.8.8.8")).toBe(true)
    expect(isPublicIp("2606:4700:4700::1111")).toBe(true)
  })
  it("rejects mixed DNS answers and pins public answers", async () => {
    await expect(
      resolvePublicHost("mixed.test", async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    ).rejects.toThrow("proxy_address_not_public")
    expect(
      await resolvePublicHost("public.test", async () => [{ address: "8.8.8.8", family: 4 }]),
    ).toBe("8.8.8.8")
  })
  it("parses supported V2 links without accepting arbitrary core configuration", () => {
    const vless = parseV2Outbound(
      `vless://${firstId}@example.org:443?security=tls&type=ws&path=%2Fproxy&sni=example.org`,
    )
    expect(vless).toMatchObject({
      type: "vless",
      server: "example.org",
      uuid: firstId,
      tls: { enabled: true, server_name: "example.org" },
      transport: { type: "ws", path: "/proxy" },
    })
    const vmess = parseV2Outbound(
      `vmess://${Buffer.from(
        JSON.stringify({
          add: "example.org",
          port: "443",
          id: firstId,
          net: "tcp",
          tls: "tls",
        }),
      ).toString("base64")}`,
    )
    expect(vmess.type).toBe("vmess")
    expect(() => parseV2Outbound(JSON.stringify({ ...vless, detour: "direct" }))).toThrow()
    expect(() =>
      parseV2Outbound(JSON.stringify({ ...vless, tls: { enabled: true, insecure: true } })),
    ).toThrow()
    expect(() => parseV2Outbound(`vless://${firstId}@example.org:443?type=xhttp`)).toThrow()
  })
  it("builds landing -> accelerator detours and never a direct fallback", async () => {
    const configuration = await buildProbeConfig(
      [
        {
          proxy: node(firstId, { protocol: "http" }),
          secret: { username: "u", password: "secret", extra: "" },
        },
        { proxy: node(secondId), secret: { username: "", password: "", extra: "" } },
      ],
      40000,
      "probe-user",
      "probe-password",
      async () => "8.8.8.8",
    )
    expect(configuration["outbounds"]).toEqual([
      expect.objectContaining({ type: "http", tag: "node-0", detour: "node-1", server: "8.8.8.8" }),
      expect.objectContaining({ type: "socks", version: "5", tag: "node-1", server: "8.8.8.8" }),
    ])
    expect(configuration["route"]).toMatchObject({
      rules: [
        expect.objectContaining({ domain: ["api.ipapi.is", "api.ip.sb"], port: 443 }),
        { action: "reject" },
      ],
    })
    expect(JSON.stringify(configuration)).not.toContain('"direct"')
  })
  it("uses actual provider IP, prioritizes the list and checks expected countries", async () => {
    const landing = node(firstId, {
      acceleratorId: secondId,
      acceleratorIds: [thirdId],
      region: "US",
    })
    const result = await detectProxy(
      {
        token: "test",
        proxy: landing,
        nodes: [landing, node(secondId, { turbo: true }), node(thirdId, { turbo: true })],
      },
      { ...options, useTurbo: true },
      {
        query: async (nodes) => {
          expect(nodes.map((item) => String(item.proxy.id))).toEqual([firstId, thirdId])
          return {
            delay: 50,
            information: { ip: "1.1.1.1", country: "DE", city: "Frankfurt", isp: "test" },
          }
        },
      },
      () => ({ username: "", password: "", extra: "" }),
    )
    expect(result.ok).toBe(false)
    expect(result.message).toBe("proxy_region_mismatch")
    expect(result.results[0]?.response_body?.ip).toBe("1.1.1.1")
    expect(result.accelerator_id).toBe(thirdId)
  })
  it("never claims success when acceleration is missing or the transport fails", async () => {
    const proxy = node(firstId)
    let called = false
    const result = await detectProxy(
      { token: "test", proxy, nodes: [proxy] },
      { ...options, useTurbo: true },
      {
        query: async () => {
          called = true
          throw new ProxyProbeError("private-password-must-not-leak")
        },
      },
      () => ({ username: "", password: "", extra: "" }),
    )
    expect(called).toBe(false)
    expect(result).toMatchObject({ ok: false, message: "accelerator_required", results: [] })
  })
  it("normalizes and limits public provider data", () => {
    expect(
      normalizeIpInformation("us", {
        ip: "1.1.1.1",
        location: { country_code: "AU", country: "Australia", city: "Sydney" },
        asn: { asn: 13335, org: "Cloudflare" },
      }),
    ).toMatchObject({ ip: "1.1.1.1", country: "AU", city: "Sydney", asn: "AS13335" })
    expect(() =>
      normalizeIpInformation("us", {
        ip: "127.0.0.1",
        location: { country_code: "US", country: "US" },
      }),
    ).toThrow()
    expect(() =>
      normalizeIpInformation("cn", { ip: "1.1.1.1", country_code: "US", isp: "x".repeat(1000) }),
    ).toThrow()
  })
  it("stops trying accelerator candidates when the selected provider returns a rate limit", async () => {
    const proxy = node(firstId, { acceleratorId: secondId, acceleratorIds: [thirdId] })
    let attempts = 0
    const result = await detectProxy(
      {
        token: "test",
        proxy,
        nodes: [proxy, node(secondId, { turbo: true }), node(thirdId, { turbo: true })],
      },
      { ...options, useTurbo: true },
      {
        query: async () => {
          attempts++
          throw new ProxyProbeError("ip_provider_rate_limited")
        },
      },
      () => ({ username: "", password: "", extra: "" }),
    )
    expect(attempts).toBe(1)
    expect(result).toMatchObject({ ok: false, message: "ip_provider_rate_limited", status: 429 })
  })
})
