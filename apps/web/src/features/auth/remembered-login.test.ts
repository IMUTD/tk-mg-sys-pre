import { afterEach, describe, expect, it } from "vitest"

import { clearRememberedLogin, readRememberedLogin, writeRememberedLogin } from "./remembered-login"

describe("remembered login", () => {
  afterEach(() => {
    clearRememberedLogin()
  })

  it("round-trips only the saved email", () => {
    // Given
    writeRememberedLogin({
      email: "admin@example.internal",
    })

    // When
    const remembered = readRememberedLogin()

    // Then
    expect(remembered).toEqual({
      email: "admin@example.internal",
    })
    expect(window.localStorage.getItem("tk-mg.remembered-login")).not.toContain("Admin123!Local")
  })

  it("purges a legacy saved password while preserving the email", () => {
    // Given
    window.localStorage.setItem(
      "tk-mg.remembered-login",
      JSON.stringify({ email: "admin@example.internal", password: "Admin123!Local" }),
    )

    // When
    const remembered = readRememberedLogin()

    // Then
    expect(remembered).toEqual({ email: "admin@example.internal" })
    expect(window.localStorage.getItem("tk-mg.remembered-login")).toBe(
      JSON.stringify({ email: "admin@example.internal" }),
    )
  })

  it("returns null after the saved login is cleared", () => {
    // Given
    writeRememberedLogin({
      email: "admin@example.internal",
    })

    // When
    clearRememberedLogin()

    // Then
    expect(readRememberedLogin()).toBeNull()
  })
})
