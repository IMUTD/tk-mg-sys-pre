export const guardOrder = ["ad", "transcode"] as const

export type GuardCode = (typeof guardOrder)[number]

const nodeProbe = { input: { timeout: "3000", useNewMode: "true" }, skill: "DumpNodeXmlEx" }

export const guardCatalog: Record<
  GuardCode,
  {
    readonly label: string
    readonly marker: string
    readonly probe: { readonly input: Record<string, string>; readonly skill: string }
  }
> = {
  ad: { label: "广告通过", marker: "Settings", probe: nodeProbe },
  transcode: { label: "转码通过", marker: "Apps", probe: nodeProbe },
}

export const normalizeGuards = (raw: unknown): GuardCode[] | null => {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return null
  for (const item of raw) {
    if (item !== "ad" && item !== "transcode") return null
  }
  return []
}

export const xmlHasText = (xml: string, marker: string): boolean => {
  const pattern = /text="([^"]*)"/g
  for (const match of xml.matchAll(pattern)) {
    const value = (match[1] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&")
    if (value.includes(marker)) return true
  }
  return false
}
