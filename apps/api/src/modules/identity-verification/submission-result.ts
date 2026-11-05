import { type Attempt, IdentityError } from "./types"

export const submissionResult = (attempt: Attempt): Attempt => {
  switch (attempt.errorCode) {
    case "rate_limited":
      throw new IdentityError(attempt.errorCode, 429, attempt.id)
    case "identity_provider_timeout":
      throw new IdentityError(attempt.errorCode, 504, attempt.id)
    case "identity_already_bound":
      throw new IdentityError(attempt.errorCode, 409, attempt.id)
    case "unsupported_image":
      throw new IdentityError(attempt.errorCode, 415, attempt.id)
    case "image_too_large":
      throw new IdentityError(attempt.errorCode, 413, attempt.id)
    case "identity_image_unusable":
    case "identity_ocr_failed":
      throw new IdentityError(attempt.errorCode, 400, attempt.id)
    default:
      if (attempt.status === "error")
        throw new IdentityError(
          attempt.errorCode ?? "identity_provider_unavailable",
          503,
          attempt.id,
        )
      return attempt
  }
}
