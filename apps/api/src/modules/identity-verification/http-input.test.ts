import { expect, it } from "bun:test"
import { requireSameOrigin } from "./http-input"

it("accepts the public HTTPS origin preserved by a reverse proxy", () => {
  // Given
  const request = new Request("http://internal:3000/api", {
    headers: {
      host: "admin.example:8443",
      origin: "https://admin.example:8443",
      "x-forwarded-proto": "https",
    },
  })
  // When / Then
  expect(() => requireSameOrigin(request)).not.toThrow()
})
it("rejects a different public host despite forwarded headers", () => {
  // Given
  const request = new Request("http://internal:3000/api", {
    headers: {
      host: "admin.example",
      origin: "https://attacker.example",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "attacker.example",
    },
  })
  // When / Then
  expect(() => requireSameOrigin(request)).toThrow()
})
