import { expect, it } from "bun:test"
import { parseIdentityConfig } from "./config"

it("defaults off when credentials are absent", () => {
  // Given / When
  const config = parseIdentityConfig({})
  // Then
  expect(config.mode).toBe("off")
})
it("requires cloud credentials when enabled", () => {
  // Given / When / Then
  expect(() =>
    parseIdentityConfig({
      ADMIN_IDENTITY_MODE: "enforced",
      IDENTITY_HMAC_KEY: "0123456789abcdef0123456789abcdef",
    }),
  ).toThrow()
})
it("parses configured mode and region when valid", () => {
  // Given / When
  const config = parseIdentityConfig({
    ADMIN_IDENTITY_MODE: "optional",
    ALIYUN_IDENTITY_REGION: "cn-shanghai",
    IDENTITY_HMAC_KEY: "0123456789abcdef0123456789abcdef",
    ALIBABA_CLOUD_ACCESS_KEY_ID: "test",
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: "test",
  })
  // Then
  expect(config.mode).toBe("optional")
  expect(config.region).toBe("cn-shanghai")
})
it("ignores blank optional secrets when mode is off", () => {
  // Given / When
  const config = parseIdentityConfig({
    ADMIN_IDENTITY_MODE: "off",
    ALIBABA_CLOUD_ACCESS_KEY_ID: "",
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: "",
    IDENTITY_HMAC_KEY: "",
  })
  // Then
  expect(config.mode).toBe("off")
})
