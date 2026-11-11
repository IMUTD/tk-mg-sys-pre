import { describe, expect, it } from "bun:test"

import type { ShareDrawFile, TextMaterial } from "./fill"
import {
  applyReplayChoices,
  nextListedProxy,
  proxyIdForStep,
  redrawFile,
  redrawProxy,
  redrawText,
  replayOffers,
  type ReplayProxy,
  type ReplayStep,
} from "./replay"

const step = (patch: Partial<ReplayStep> & Pick<ReplayStep, "skill" | "sources">): ReplayStep => ({
  parameters: {},
  scopes: Object.fromEntries(Object.keys(patch.sources).map((key) => [key, "external"])),
  sequence: 0,
  textResourceId: null,
  ...patch,
})

const emptySelection = {
  files: [],
  language: "",
  proxies: null,
  proxyIds: [],
  proxyTag: null,
  region: "",
  texts: [],
}

describe("stage replay draws", () => {
  it("avoids the current proxy when another one is in range", () => {
    const picked = redrawProxy(
      [
        { id: "proxy-a" },
        { id: "proxy-b" },
      ],
      "proxy-a",
    )
    expect(picked?.id).toBe("proxy-b")
  })

  it("keeps the only proxy", () => {
    expect(redrawProxy([{ id: "proxy-a" }], "proxy-a")?.id).toBe("proxy-a")
  })

  it("walks the selected proxy list and wraps", () => {
    const listed = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((id) => ({ id }))
    expect(nextListedProxy(listed, "b")?.id).toBe("c")
    expect(nextListedProxy(listed, "j")?.id).toBe("a")
    expect(nextListedProxy([{ id: "only" }], "only")?.id).toBe("only")
    expect(nextListedProxy(listed, null)?.id).toBe("a")
  })

  it("advances past the landing on the step when the task proxy is different", () => {
    const listed: ReplayProxy[] = ["a", "b", "c"].map((id, index) => ({
      host: `10.0.0.${index + 1}`,
      id,
      link: "same",
      name: id,
      password: "",
      port: "3000",
      safe: "",
      tun: "",
      username: "",
    }))
    const step = {
      parameters: { landIp: "10.0.0.2", landPort: "3000", vless: "same" },
      scopes: { landIp: "external", landPort: "external", vless: "external" },
      sequence: 0,
      skill: "IndependentV5S5",
      sources: { landIp: "proxy.host", landPort: "proxy.port", vless: "proxy.link" },
      textResourceId: null,
    } satisfies ReplayStep
    expect(nextListedProxy(listed, proxyIdForStep(step, listed, "a"))?.id).toBe("c")
  })

  it("takes the next text and wraps", () => {
    const materials: TextMaterial[] = [
      { category: "", content: "甲", createdAt: "1", id: "a" },
      { category: "", content: "乙", createdAt: "2", id: "b" },
    ]
    expect(redrawText(materials, "sequence", undefined, "a")?.content).toBe("乙")
    expect(redrawText(materials, "sequence", undefined, "b")?.content).toBe("甲")
  })

  it("draws a different random file when the directory has more than one", () => {
    const files: ShareDrawFile[] = [
      { deviceId: "box", host: "10.0.0.1", parent: "bf", path: "video/bf/1.mp4", pool: "video" },
      { deviceId: "box", host: "10.0.0.1", parent: "bf", path: "video/bf/2.mp4", pool: "video" },
    ]
    const picked = redrawFile(
      files,
      { deviceId: "box", directory: "bf", mode: "random", sequence: 0, source: "pool.video" },
      "video/bf/1.mp4",
      () => 0,
    )
    expect(picked?.path).not.toBe("video/bf/1.mp4")
    expect(picked?.path).toBe("video/bf/2.mp4")
  })

  it("hides a country covered by the task region and a device host", () => {
    const offers = replayOffers(
      [
        step({
          parameters: { country: "US", host: "10.0.0.1" },
          skill: "UpdateFingerprint",
          sources: { country: "account.region", host: "device.host" },
        }),
      ],
      { ...emptySelection, region: "US" },
      "",
    )
    expect(offers).toEqual([])
  })

  it("splits a V2+S5 proxy from the other proxy fields and redraws them separately", () => {
    const steps = [
      step({
        parameters: { host: "1.1.1.1", vless: "vless://old" },
        sequence: 0,
        skill: "SetProxy",
        sources: { host: "proxy.host" },
      }),
      step({
        parameters: { vless: "vless://old" },
        scopes: { vless: "external" },
        sequence: 2,
        skill: "IndependentV5S5",
        sources: { vless: "proxy.link" },
      }),
    ]
    const offers = replayOffers(steps, emptySelection, "落地甲", new Map([[2, true]]))
    expect(offers.map((item) => item.label)).toEqual(["代理", "V2+S5 外部参数"])
    expect(offers[1]).toMatchObject({ current: "vless://old", refresh: true, sequence: 2 })
    const applied = applyReplayChoices(steps, [
      { kind: "proxy", mode: "redraw" },
      { kind: "proxy", mode: "redraw", sequence: 2 },
    ], {
      account: { backup_key: "", backup_name: "", identifier: "", language: "", region: "", secret: "" },
      files: new Map(),
      proxy: {
        host: "9.9.9.9",
        id: "stage",
        link: "",
        name: "整段",
        password: "",
        port: "1080",
        safe: "",
        tun: "",
        username: "",
      },
      stepProxies: new Map([
        [
          2,
          {
            host: "8.8.8.8",
            id: "v5",
            link: "vless://new",
            name: "新代理",
            password: "p",
            port: "1",
            safe: "",
            tun: "",
            username: "u",
          },
        ],
      ]),
      texts: new Map(),
    })
    expect(applied.proxyId).toBe("v5")
    expect(applied.steps[0]?.parameters["host"]).toBe("9.9.9.9")
    expect(applied.steps[1]?.parameters["vless"]).toBe("vless://new")
    expect(applied.missing).toEqual([])
  })
})
