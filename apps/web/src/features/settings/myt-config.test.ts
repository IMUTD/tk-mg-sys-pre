import { describe, expect, it } from "vitest"
import { applyConfigKey, emptyConfig, emptyConfigQuery, filterConfigs } from "./myt-config"
import { createTestConfigs } from "./myt-config.test-fixtures"

describe("myt-config", () => {
  it("filters seed configs by 云大师 query fields without exposing secrets in names", () => {
    const configs = createTestConfigs()
    const byName = filterConfigs(configs, { ...emptyConfigQuery(), name: "冰拓" })
    const byKey = filterConfigs(configs, { ...emptyConfigQuery(), key: "minio_media" })
    const byUser = filterConfigs(configs, { ...emptyConfigQuery(), username: "proxy-admin" })
    const byPassword = filterConfigs(configs, {
      ...emptyConfigQuery(),
      password: "bingtop-secret",
    })
    const byRemark = filterConfigs(configs, { ...emptyConfigQuery(), remark: "节流" })

    expect(byName.map((item) => item.id)).toEqual([1])
    expect(byKey.map((item) => item.name)).toEqual(["云端储存(媒体)"])
    expect(byUser.map((item) => item.name)).toEqual(["代理账号"])
    expect(byPassword.map((item) => item.name)).toEqual(["冰拓打码"])
    expect(byRemark.map((item) => item.key)).toEqual(["turbo_domain_keyword"])
    expect(filterConfigs(configs, emptyConfigQuery())[0]?.id).toBe(7)
  })

  it("fills name and default url when a config key is selected", () => {
    const next = applyConfigKey(emptyConfig(0, "2026-09-17 12:00:00"), "bingtop")

    expect(next).toMatchObject({
      key: "bingtop",
      name: "冰拓打码",
      url: "https://www.bingtop.com/ocr/upload/",
    })
  })
})
