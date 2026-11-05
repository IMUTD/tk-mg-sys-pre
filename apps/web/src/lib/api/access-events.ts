export class ApiAccessEvent extends Event {
  constructor(readonly kind: "unauthenticated" | "identity_required") {
    super("tk-mg:api-access")
  }
}

export const observeApiAccess = async (
  request: Request,
  response: Response,
  requestGeneration = generation,
): Promise<void> => {
  if (requestGeneration !== generation) return
  const url = new URL(request.url)
  if (
    url.origin !== window.location.origin ||
    !url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/api/auth/")
  )
    return
  if (response.status === 401) {
    window.dispatchEvent(new ApiAccessEvent("unauthenticated"))
    return
  }
  if (response.status !== 403) return
  try {
    const body: unknown = await response.clone().json()
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      body.error === "identity_verification_required" &&
      requestGeneration === generation
    )
      window.dispatchEvent(new ApiAccessEvent("identity_required"))
  } catch (error) {
    if (error instanceof SyntaxError) return
    throw error
  }
}
let generation = 0
export const apiSessionGeneration = (): number => generation
export const advanceApiSession = (): void => {
  generation += 1
}
