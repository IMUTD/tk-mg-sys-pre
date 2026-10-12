import { describe, expect, it } from "bun:test"

import { takeBalanced } from "./allocate"
import { drawTexts, fillStep, type FillAccount, type FillContext, resolveProxyLink } from "./fill"

const account: FillAccount = {
  backupDevice: "192.168.1.9",
  backupKey: "backup-1",
  identifier: "user-a",
  language: "zh",
  region: "CN",
  secret: "secret-a",
}

const context = (patch: Partial<FillContext> = {}): FillContext => ({
  account,
  device: { host: "192.168.76.140" },
  instance: { index: "2" },
  manualText: false,
  proxy: {
    host: "10.0.0.8",
    link: "vless://node",
    password: "proxy-pass",
    port: "1080",
    safe: "true",
    tun: "false",
    username: "proxy-user",
  },
  text: null,
  video: "",
  ...patch,
})

describe("dispatch fill", () => {
  it("keeps literal params and fills constrained sources", () => {
    const filled = fillStep(
      {
        input: { ip: "", port: "", type: "2" },
        scopes: { ip: "external", port: "external", type: "internal" },
        skill: "SetProxy",
        sources: { ip: "proxy.host", port: "proxy.port", type: "literal" },
      },
      context(),
    )
    expect(filled.missingKeys).toEqual([])
    expect(filled.parameters).toEqual({ ip: "10.0.0.8", port: "1080", type: "2" })
  })

  it("lets a chosen text pool override the constraint", () => {
    const filled = fillStep(
      {
        input: { text: "" },
        scopes: { text: "external" },
        skill: "SendText",
        sources: { text: "account.identifier" },
      },
      context({
        manualText: true,
        text: { content: "抽到的文案", resourceId: "text-1" },
      }),
    )
    expect(filled.parameters.text).toBe("抽到的文案")
    expect(filled.textResourceId).toBe("text-1")
  })

  it("uses the accelerator V2 link when the landing proxy has none", () => {
    expect(resolveProxyLink("", "vless://relay")).toBe("vless://relay")
    expect(resolveProxyLink("vless://own", "vless://relay")).toBe("vless://own")
  })

  it("marks an empty constrained value as missing", () => {
    const filled = fillStep(
      {
        input: { vless: "" },
        scopes: { vless: "external" },
        skill: "IndependentV5S5",
        sources: { vless: "proxy.link" },
      },
      context({ proxy: null }),
    )
    expect(filled.missingKeys).toEqual(["vless"])
    expect(filled.parameters.vless).toBe("")
  })

  it("draws text in order and then cycles", () => {
    const materials = [
      { category: "评论", content: "第一条", createdAt: "2026-01-02", id: "b" },
      { category: "评论", content: "更早", createdAt: "2026-01-01", id: "a" },
      { category: "其他", content: "别的", createdAt: "2026-01-03", id: "c" },
    ]
    expect(drawTexts(materials, "sequence", undefined, 3).map((item) => item.content)).toEqual([
      "更早",
      "第一条",
      "别的",
    ])
    expect(drawTexts(materials, "tag", "评论", 3).map((item) => item.content)).toEqual([
      "更早",
      "第一条",
      "更早",
    ])
  })

  it("spreads picks across the least used candidates", () => {
    const counts = new Map<string, number>()
    const candidates = [{ id: "box-b" }, { id: "box-a" }]
    const picked = [1, 2, 3].map(() => takeBalanced(candidates, counts)?.id)
    expect(picked).toEqual(["box-a", "box-b", "box-a"])
  })
})