import { describe, expect, it } from "bun:test"

import { createApp } from "./app"

describe("createApp", () => {
  it("returns a healthy service response when health is requested", async () => {
    // Given
    const app = createApp()

    // When
    const response = await app.request("/health")

    // Then
    expect(response.status).toBe(200)
  })
})
