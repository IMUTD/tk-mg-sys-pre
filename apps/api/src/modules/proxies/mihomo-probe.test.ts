import { describe, expect, it } from "bun:test"
import { GroupIdSchema } from "../../lib/authorization"
import { ProxyConfigurationSchema } from "./configuration"
import { buildMihomoProbeConfig, detectDial, isAgentRelayPort } from "./mihomo-probe"
import { ProxyIdSchema, type StoredProxy } from "./repository"

const node = (id: string, overrides = {}): StoredProxy => ({
  id: ProxyIdSchema.parse(id),
  groupId: GroupIdSchema.parse("11111111-1111-4111-8111-111111111111"),
  createdAt: new Date(),
  updatedAt: new Date(),
  credentialState: "none",
  encryptedCredentials: "",
  endpoint: "1.1.1.1:3000",
  name: "test",
  note: "",
  tags: [],
  status: "ready",
  configuration: ProxyConfigurationSchema.parse({ host: "1.1.1.1", port: 3000, ...overrides }),
})
const landingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const relayId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const options = { channel: "us" as const, mode: "detailed" as const, useTurbo: false }
const pin = async () => "8.8.8.8"

describe("mihomo relay probe", () => {
  it("keeps the backend listener off the agent relay ports", () => {
    expect(isAgentRelayPort(10801)).toBe(true)
    expect(isAgentRelayPort(24010)).toBe(true)
    expect(isAgentRelayPort(18080)).toBe(false)
  })

  it("dials the landing SOCKS5 through VLESS on loopback", async () => {
    const vless = `vless://${relayId}@example.org:443?security=none`
    const config = await buildMihomoProbeConfig(
      [
        {
          proxy: node(landingId, { protocol: "socks5", host: "1.1.1.1", port: 3000 }),
          secret: { username: "land", password: "land-secret", extra: "" },
        },
        {
          proxy: node(relayId, {
            protocol: "v2",
            host: "example.org",
            port: 443,
            v2Protocol: "vless",
            turbo: true,
          }),
          secret: { username: "", password: "", extra: vless },
        },
      ],
      18080,
      "probe-user",
      "probe-password",
      pin,
    )
    expect(config).toMatchObject({
      port: 18080,
      "bind-address": "127.0.0.1",
      "allow-lan": false,
      rules: ["MATCH,PROXY"],
    })
    expect(config).not.toHaveProperty("tun")
    expect(config).not.toHaveProperty("external-controller")
    expect(config["proxies"]).toEqual([
      expect.objectContaining({ name: "dialer", type: "vless", server: "8.8.8.8", port: 443 }),
      expect.objectContaining({
        name: "land",
        type: "socks5",
        server: "8.8.8.8",
        port: 3000,
        "dialer-proxy": "dialer",
      }),
    ])
  })

  it("records both internet access and the exit IP", async () => {
    const landing = node(landingId, {
      protocol: "socks5",
      acceleratorId: relayId,
      region: "AU",
    })
    const relay = node(relayId, {
      protocol: "v2",
      host: "example.org",
      port: 443,
      v2Protocol: "vless",
      turbo: true,
    })
    const result = await detectDial(
      { token: "test", proxy: landing, nodes: [landing, relay] },
      options,
      {
        query: async (nodes) => {
          expect(nodes.map((item) => item.proxy.id)).toEqual([landingId, relayId])
          return {
            connectivity: {
              ok: true,
              delay: 40,
              status: 204,
              url: "https://www.gstatic.com/generate_204",
            },
            informationDelay: 55,
            information: {
              ip: "1.1.1.1",
              country: "AU",
              countryName: "Australia",
              region: "",
              city: "",
              isp: "",
              asn: "",
            },
          }
        },
      },
      () => ({
        username: "",
        password: "",
        extra: `vless://${relayId}@example.org:443?security=none`,
      }),
    )
    expect(result).toMatchObject({
      ok: true,
      detection_type: "proxy_connectivity",
      connectivity_checked: true,
      message: "proxy_online",
      target_ip: "1.1.1.1",
      accelerator_id: relayId,
      results: [
        { ok: true, response_body: { country: "AU" } },
        { ok: true, url: "https://www.gstatic.com/generate_204" },
      ],
    })
  })

  it("fails the check when the dial cannot reach the internet", async () => {
    const landing = node(landingId, { protocol: "http" })
    const result = await detectDial(
      { token: "test", proxy: landing, nodes: [landing] },
      options,
      {
        query: async () => ({
          connectivity: {
            ok: false,
            delay: 10,
            status: 0,
            url: "https://www.gstatic.com/generate_204",
          },
          information: null,
          informationDelay: 0,
        }),
      },
      () => ({ username: "u", password: "p", extra: "" }),
    )
    expect(result.ok).toBe(false)
    expect(result.message).toBe("proxy_connection_failed")
    expect(result.connectivity_checked).toBe(true)
    expect(result.results).toEqual([
      expect.objectContaining({ ok: false, url: "https://www.gstatic.com/generate_204" }),
    ])
  })
})
