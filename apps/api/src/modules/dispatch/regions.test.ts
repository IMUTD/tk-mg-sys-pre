import { describe, expect, it } from "bun:test"

import { regionCodes, regionContinents, regionParameter, regionPoint } from "./regions"

describe("region catalog", () => {
  it("lists the 25 hot TikTok countries once", () => {
    const codes = regionContinents.flatMap((continent) =>
      continent.countries.map((country) => country.code),
    )
    expect(regionCodes.size).toBe(25)
    expect(new Set(codes).size).toBe(codes.length)
    expect(regionCodes).toEqual(new Set(codes))
    expect(regionCodes.has("CN")).toBe(false)
    expect(regionContinents.map((continent) => continent.name)).toEqual([
      "美洲",
      "亚洲",
      "欧洲",
      "非洲",
      "大洋洲",
    ])
  })

  it("maps region skills onto one parameter", () => {
    expect(regionParameter("UpdateFingerprint")).toBe("country")
    expect(regionParameter("SetLanguageCountry")).toBe("country")
    expect(regionParameter("CreateAndroid")).toBe("countryCode")
    expect(regionParameter("ResetAndroidContainer")).toBe("countryCode")
    expect(regionParameter("SwitchAndroidPhoneModel")).toBe("countryCode")
    expect(regionParameter("SetIPLocation")).toBeNull()
  })

  it("gives every listed country one city point and no others", () => {
    const codes = [...regionCodes]
    expect(codes).toHaveLength(25)
    for (const code of codes) {
      const point = regionPoint(code)
      expect(point).not.toBeNull()
      const latitude = Number(point?.latitude)
      const longitude = Number(point?.longitude)
      expect(point?.latitude).toMatch(/^-?\d+\.\d{4}$/)
      expect(point?.longitude).toMatch(/^-?\d+\.\d{4}$/)
      expect(latitude).toBeGreaterThanOrEqual(-90)
      expect(latitude).toBeLessThanOrEqual(90)
      expect(longitude).toBeGreaterThanOrEqual(-180)
      expect(longitude).toBeLessThanOrEqual(180)
    }
    expect(regionPoint("CN")).toBeNull()
    expect(regionPoint("XX")).toBeNull()
    expect(regionPoint("US")).toEqual({ latitude: "40.7128", longitude: "-74.0060" })
    expect(regionPoint("JP")).toEqual({ latitude: "35.6762", longitude: "139.6503" })
  })
})
