import { describe, expect, it } from "bun:test"

import { guardCatalog, normalizeGuards, xmlHasText } from "./guards"

describe("guard scripts", () => {
  it("treats a Settings text attribute as the ad obstacle", () => {
    const xml = `<hierarchy><node text="Settings" bounds="[0,0][10,10]" /></hierarchy>`
    expect(xmlHasText(xml, "Settings")).toBe(true)
    expect(xmlHasText(xml, "Apps")).toBe(false)
  })

  it("treats an Apps text attribute as the transcode obstacle", () => {
    const xml = `<hierarchy><node text="Open Apps" /></hierarchy>`
    expect(xmlHasText(xml, "Apps")).toBe(true)
  })

  it("ignores the marker outside a text attribute", () => {
    const xml = `<hierarchy><node content-desc="Settings" text="Home" /></hierarchy>`
    expect(xmlHasText(xml, "Settings")).toBe(false)
  })

  it("keeps the probe skill in the catalog", () => {
    expect(guardCatalog.ad.probe.skill).toBe("DumpNodeXmlEx")
    expect(guardCatalog.transcode.probe.skill).toBe("DumpNodeXmlEx")
  })

  it("keeps ad before transcode", () => {
    expect(normalizeGuards(["transcode", "ad", "ad"])).toEqual(["ad", "transcode"])
    expect(normalizeGuards(["nope"])).toBeNull()
  })
})
