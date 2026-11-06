export const languageSkills = ["SetLanguageCountry", "UpdateFingerprint"] as const

export const languageParameter = (skill: string): "language" | null =>
  skill === "SetLanguageCountry" || skill === "UpdateFingerprint" ? "language" : null

export type DispatchLanguage = { readonly code: string; readonly name: string }

export const languageCatalog: readonly DispatchLanguage[] = [
  { code: "en", name: "英语" },
  { code: "es", name: "西班牙语" },
  { code: "pt", name: "葡萄牙语" },
  { code: "in", name: "印尼语" },
  { code: "ar", name: "阿拉伯语" },
  { code: "ru", name: "俄语" },
  { code: "bn", name: "孟加拉语" },
  { code: "vi", name: "越南语" },
  { code: "tr", name: "土耳其语" },
  { code: "th", name: "泰语" },
  { code: "ja", name: "日语" },
  { code: "fr", name: "法语" },
  { code: "de", name: "德语" },
  { code: "zh", name: "中文" },
  { code: "ko", name: "韩语" },
]

export const languageCodes: ReadonlySet<string> = new Set(languageCatalog.map((item) => item.code))
