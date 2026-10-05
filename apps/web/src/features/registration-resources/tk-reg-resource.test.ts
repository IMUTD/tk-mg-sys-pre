import { describe, expect, it } from "vitest"

import { detectFieldTypeInitial, parseSmartData } from "./tk-reg-resource"

describe("parseSmartData", () => {
  it("detects google email, password and assist email columns", () => {
    // Given
    const raw = "xxx12143@gmail.com----kljo23123----kljoiu@outlook.com"

    // When
    const parsed = parseSmartData(raw)

    // Then
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.mappings.map((mapping) => mapping.type)).toEqual([
      "email",
      "emailPassword",
      "assistEmail",
    ])
  })

  it("detects api sms account and endpoint columns", () => {
    // Given
    const raw = "31123456----https://sms11.com/token=weqe4122132frekrar"

    // When
    const parsed = parseSmartData(raw)

    // Then
    expect(detectFieldTypeInitial(parsed.rows, 0)).toBe("account")
    expect(parsed.mappings.map((mapping) => mapping.type)).toEqual(["account", "api"])
  })
})
