export class UnexpectedVariantError extends Error {
  readonly name = "UnexpectedVariantError"

  constructor() {
    super("A value did not match an expected variant")
  }
}

export const assertNever = (value: never): never => {
  void value
  throw new UnexpectedVariantError()
}
