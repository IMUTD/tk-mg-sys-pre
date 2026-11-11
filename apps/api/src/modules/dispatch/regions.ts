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

const regionPoints: Readonly<Record<string, readonly [string, string]>> = {
  US: ["40.7128", "-74.0060"],
  BR: ["-23.5505", "-46.6333"],
  MX: ["19.4326", "-99.1332"],
  CO: ["4.7110", "-74.0721"],
  AR: ["-34.6037", "-58.3816"],
  PE: ["-12.0464", "-77.0428"],
  ID: ["-6.2088", "106.8456"],
  PK: ["24.8607", "67.0011"],
  PH: ["14.5995", "120.9842"],
  BD: ["23.8103", "90.4125"],
  VN: ["10.8231", "106.6297"],
  TR: ["41.0082", "28.9784"],
  IQ: ["33.3152", "44.3661"],
  SA: ["24.7136", "46.6753"],
  TH: ["13.7563", "100.5018"],
  JP: ["35.6762", "139.6503"],
  RU: ["55.7558", "37.6173"],
  GB: ["51.5074", "-0.1278"],
  DE: ["52.5200", "13.4050"],
  FR: ["48.8566", "2.3522"],
  EG: ["30.0444", "31.2357"],
  NG: ["6.5244", "3.3792"],
  ZA: ["-26.2041", "28.0473"],
  DZ: ["36.7538", "3.0588"],
  AU: ["-33.8688", "151.2093"],
}

export const regionPoint = (
  code: string,
): { readonly latitude: string; readonly longitude: string } | null => {
  const point = regionPoints[code]
  if (point === undefined) return null
  return { latitude: point[0], longitude: point[1] }
}
