import { describe, expect, it } from "bun:test"

import { createSecretCipher } from "./crypto"

describe("createSecretCipher", () => {
  it("round trips a secret without returning its plaintext in the ciphertext", () => {
    // Given
    const cipher = createSecretCipher("0123456789abcdef0123456789abcdef")
    const plaintext = "proxy-password"

    // When
    const encrypted = cipher.encrypt(plaintext)
    const decrypted = cipher.decrypt(encrypted)

    // Then
    expect(encrypted).not.toContain(plaintext)
    expect(decrypted).toBe(plaintext)
  })
})
