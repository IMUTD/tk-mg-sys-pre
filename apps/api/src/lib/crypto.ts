import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

class InvalidEncryptionKeyError extends Error {
  public constructor() {
    super("Encryption keys must be exactly 32 UTF-8 bytes")
    this.name = "InvalidEncryptionKeyError"
  }
}

class InvalidCiphertextError extends Error {
  public constructor() {
    super("Ciphertext is not a supported encrypted secret")
    this.name = "InvalidCiphertextError"
  }
}

const CiphertextVersion = "v1"
const AesGcmIvLength = 12

export type SecretCipher = {
  readonly decrypt: (ciphertext: string) => string
  readonly encrypt: (plaintext: string) => string
}

const toEncryptionKey = (key: string): Buffer => {
  const encoded = Buffer.from(key, "utf8")
  if (encoded.length !== 32) {
    throw new InvalidEncryptionKeyError()
  }
  return encoded
}

export const createSecretCipher = (key: string): SecretCipher => {
  const encryptionKey = toEncryptionKey(key)

  return {
    decrypt: (ciphertext) => {
      const parts = ciphertext.split(".")
      const [version, encodedIv, encodedTag, encodedEncrypted] = parts

      if (
        parts.length !== 4 ||
        version !== CiphertextVersion ||
        encodedIv === undefined ||
        encodedTag === undefined ||
        encodedEncrypted === undefined
      ) {
        throw new InvalidCiphertextError()
      }

      const iv = Buffer.from(encodedIv, "base64url")
      const tag = Buffer.from(encodedTag, "base64url")
      const encrypted = Buffer.from(encodedEncrypted, "base64url")
      if (iv.length !== AesGcmIvLength || tag.length !== 16 || encrypted.length === 0) {
        throw new InvalidCiphertextError()
      }

      try {
        const decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv)
        decipher.setAuthTag(tag)
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
      } catch (error) {
        if (error instanceof Error) {
          throw new InvalidCiphertextError()
        }
        throw error
      }
    },
    encrypt: (plaintext) => {
      const iv = randomBytes(AesGcmIvLength)
      const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv)
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
      const tag = cipher.getAuthTag()
      return [
        CiphertextVersion,
        iv.toString("base64url"),
        tag.toString("base64url"),
        encrypted.toString("base64url"),
      ].join(".")
    },
  }
}
