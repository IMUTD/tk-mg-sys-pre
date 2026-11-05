import type { UserId } from "../../lib/authorization"
import type { AuthService, SessionPrincipal } from "./service"

export type IdentityAccess = {
  readonly mode: "off" | "optional" | "enforced"
  readonly required: boolean
  readonly canVerify: boolean
  readonly status:
    | "unverified"
    | "verifying"
    | "verified"
    | "rejected"
    | "error"
    | "unbound"
    | "not_required"
  readonly canAccessBusiness: boolean
  readonly version: number
  readonly isPlatformAdmin: boolean
}

export class IdentityAccessUnavailableError extends Error {
  constructor() {
    super("Identity access is unavailable")
    this.name = "IdentityAccessUnavailableError"
  }
}

export const withIdentityAccess = (
  auth: AuthService,
  resolve: (userId: UserId) => Promise<IdentityAccess>,
): AuthService => {
  const decorate = async (principal: SessionPrincipal): Promise<SessionPrincipal> => {
    try {
      const identity = await resolve(principal.userId)
      return { ...principal, identity, isPlatformAdmin: identity.isPlatformAdmin }
    } catch (error) {
      if (error instanceof Error) throw new IdentityAccessUnavailableError()
      throw error
    }
  }
  return {
    login: async (input) => {
      const result = await auth.login(input)
      if (result.kind === "invalid_credentials") return result
      return { ...result, principal: await decorate(result.principal) }
    },
    logout: (token) => auth.logout(token),
    session: async (token) => {
      const principal = await auth.session(token)
      return principal === null ? null : decorate(principal)
    },
  }
}
