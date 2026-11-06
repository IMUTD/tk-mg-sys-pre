export const regionSkills = [
  "UpdateFingerprint",
  "SetLanguageCountry",
  "CreateAndroid",
  "ResetAndroidContainer",
  "SwitchAndroidPhoneModel",
] as const

export const regionParameter = (skill: string): "country" | "countryCode" | null => {
  if (skill === "UpdateFingerprint" || skill === "SetLanguageCountry") return "country"
  if (
    skill === "CreateAndroid" ||
    skill === "ResetAndroidContainer" ||
    skill === "SwitchAndroidPhoneModel"
  ) {
    return "countryCode"
  }
  return null
}

export type RegionCountry = { readonly code: string; readonly name: string }

export type RegionContinent = {
  readonly countries: readonly RegionCountry[]
  readonly name: "美洲" | "亚洲" | "欧洲" | "非洲" | "大洋洲"
}

export const regionContinents: readonly RegionContinent[] = [
  {
    name: "美洲",
    countries: [
      { code: "US", name: "美国" },
      { code: "BR", name: "巴西" },
      { code: "MX", name: "墨西哥" },
      { code: "CO", name: "哥伦比亚" },
      { code: "AR", name: "阿根廷" },
      { code: "PE", name: "秘鲁" },
    ],
  },
  {
    name: "亚洲",
    countries: [
      { code: "ID", name: "印度尼西亚" },
      { code: "PK", name: "巴基斯坦" },
      { code: "PH", name: "菲律宾" },
      { code: "BD", name: "孟加拉国" },
      { code: "VN", name: "越南" },
      { code: "TR", name: "土耳其" },
      { code: "IQ", name: "伊拉克" },
      { code: "SA", name: "沙特阿拉伯" },
      { code: "TH", name: "泰国" },
      { code: "JP", name: "日本" },
    ],
  },
  {
    name: "欧洲",
    countries: [
      { code: "RU", name: "俄罗斯" },
      { code: "GB", name: "英国" },
      { code: "DE", name: "德国" },
      { code: "FR", name: "法国" },
    ],
  },
  {
    name: "非洲",
    countries: [
      { code: "EG", name: "埃及" },
      { code: "NG", name: "尼日利亚" },
      { code: "ZA", name: "南非" },
      { code: "DZ", name: "阿尔及利亚" },
    ],
  },
  {
    name: "大洋洲",
    countries: [{ code: "AU", name: "澳大利亚" }],
  },
]

export const regionCodes: ReadonlySet<string> = new Set(
  regionContinents.flatMap((continent) => continent.countries.map((country) => country.code)),
)
