import { describe, expect, it } from "bun:test"

import { parseRegistrationRows } from "./parser"

describe("parseRegistrationRows", () => {
  it("parses the supported registration resource formats and marks duplicate lines", () => {
    // Given
    const content = [
      "person@gmail.com----google-password",
      "api-sms----twilio----api-token",
      "microsoft-oauth----person@outlook.com----client-id----refresh-token",
      "pop3----mail@example.com----mail-password----pop.example.com----995",
      "person@gmail.com----google-password",
    ].join("\n")

    // When
    const parsed = parseRegistrationRows(content)

    // Then
    expect(parsed.valid.map((row) => row.kind)).toEqual([
      "google-email",
      "api-sms",
      "microsoft-oauth",
      "pop3",
    ])
    expect(parsed.invalid).toEqual([
      { line: 5, raw: "person@gmail.com----google-password", reason: "duplicate resource" },
    ])
  })

  it("returns malformed and unsupported rows without accepting them", () => {
    // Given
    const content =
      "person@gmail.com----google-password\nbad\npop3----mail@example.com----pw----host----invalid-port"

    // When
    const parsed = parseRegistrationRows(content)

    // Then
    expect(parsed.valid).toHaveLength(1)
    expect(parsed.invalid).toEqual([
      { line: 2, raw: "bad", reason: "unsupported resource format" },
      {
        line: 3,
        raw: "pop3----mail@example.com----pw----host----invalid-port",
        reason: "POP3 port must be between 1 and 65535",
      },
    ])
  })
})
