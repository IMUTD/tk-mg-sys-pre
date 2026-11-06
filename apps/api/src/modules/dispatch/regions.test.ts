import { describe, expect, it } from "bun:test"

import { regionCodes, regionContinents, regionParameter } from "./regions"

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
})
