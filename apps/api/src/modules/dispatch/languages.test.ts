import { describe, expect, it } from "bun:test"

import { languageCatalog, languageCodes, languageParameter } from "./languages"

describe("language catalog", () => {
  it("lists the 15 interface languages once", () => {
    const codes = languageCatalog.map((item) => item.code)
    expect(languageCodes.size).toBe(15)
    expect(new Set(codes).size).toBe(codes.length)
    expect(languageCodes).toEqual(new Set(codes))
    expect(languageCodes.has("in")).toBe(true)
    expect(languageCodes.has("id")).toBe(false)
    expect(languageCodes.has("ur")).toBe(false)
    expect(languageCodes.has("fil")).toBe(false)
    expect(languageCatalog.map((item) => item.name)).toEqual([
      "英语",
      "西班牙语",
      "葡萄牙语",
      "印尼语",
      "阿拉伯语",
      "俄语",
      "孟加拉语",
      "越南语",
      "土耳其语",
      "泰语",
      "日语",
      "法语",
      "德语",
      "中文",
      "韩语",
    ])
  })

  it("maps language skills onto the language parameter", () => {
    expect(languageParameter("SetLanguageCountry")).toBe("language")
    expect(languageParameter("UpdateFingerprint")).toBe("language")
    expect(languageParameter("SetIPLocation")).toBeNull()
    expect(languageParameter("CreateAndroid")).toBeNull()
  })
})
