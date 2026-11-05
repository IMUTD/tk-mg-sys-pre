import { describe, expect, it } from "bun:test"
import { normalizeIdentityNumber, parseProviderResponse } from "./provider-result"

describe("identity provider boundary", () => {
  it("normalizes a valid trailing x when checksum is valid", () => {
    // Given
    const input = "11010519491231002x"
    // When
    const result = normalizeIdentityNumber(input)
    // Then
    expect(result).toBe("11010519491231002X")
  })
  it("rejects a number when checksum is invalid", () => {
    // Given
    const input = "110105194912310021"
    // When
    const result = normalizeIdentityNumber(input)
    // Then
    expect(result).toBeNull()
  })
  it("accepts only code 200 bizCode 1 with valid card info", () => {
    // Given
    const response = {
      code: "200",
      requestId: "req",
      resultObject: {
        bizCode: "1",
        cardInfo: JSON.stringify({
          certName: "张三",
          certNo: "11010519491231002x",
          address: "ignored",
        }),
      },
    }
    // When
    const result = parseProviderResponse(response)
    // Then
    expect(result).toEqual({
      status: "verified",
      name: "张三",
      number: "11010519491231002X",
      code: "200",
      bizCode: "1",
      requestId: "req",
    })
  })
  for (const response of [
    null,
    {},
    { code: "200", resultObject: { bizCode: "1", cardInfo: "{}" } },
    { code: "200", resultObject: { bizCode: "1", cardInfo: "invalid" } },
  ]) {
    it("returns sanitized error when provider response is malformed", () => {
      // Given / When
      const result = parseProviderResponse(response)
      // Then
      expect(result.status).toBe("error")
      expect(JSON.stringify(result)).not.toContain("certNo")
    })
  }
  it("rejects identity when provider biz code is 2", () => {
    // Given / When
    const result = parseProviderResponse({ code: "200", resultObject: { bizCode: "2" } })
    // Then
    expect(result.status).toBe("rejected")
  })
})
for (const [code, errorCode] of [
  ["405", "unsupported_image"],
  ["420", "identity_image_unusable"],
  ["421", "image_too_large"],
  ["440", "identity_ocr_failed"],
  ["402", "identity_provider_unavailable"],
] as const) {
  it(`maps provider code ${code} to a sanitized actionable error`, () => {
    // Given / When
    const result = parseProviderResponse({ code })
    // Then
    expect(result).toMatchObject({ status: "error", errorCode })
  })
}
it("maps provider repeated-call limits without reporting identity mismatch", () => {
  // Given / When
  const result = parseProviderResponse({ code: "403" })
  // Then
  expect(result).toMatchObject({ status: "error", errorCode: "rate_limited" })
})
