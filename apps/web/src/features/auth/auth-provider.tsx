import { useQuery } from "@tanstack/react-query"
import { createContext, type ReactNode, useContext } from "react"

import type { AuthApi, SessionState } from "../../lib/api/auth-api"

type AuthContextValue = {
  readonly api: AuthApi
  readonly session: SessionState | { readonly kind: "loading" }
}

export class MissingAuthProviderError extends Error {
  readonly name = "MissingAuthProviderError"

  constructor() {
    super("AuthProvider is required before using authentication state")
  }
}

const AuthContext = createContext<AuthContextValue | null>(null)

type AuthProviderProps = {
  readonly api: AuthApi
  readonly children: ReactNode
}

export const AuthProvider = ({ api, children }: AuthProviderProps): ReactNode => {
  const sessionQuery = useQuery({
    queryFn: () => api.session(),
    queryKey: ["auth", "session"],
    throwOnError: true,
  })
  const session =
    sessionQuery.isPending || sessionQuery.data === undefined
      ? { kind: "loading" as const }
      : sessionQuery.data

  return <AuthContext.Provider value={{ api, session }}>{children}</AuthContext.Provider>
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext)
  if (context === null) {
    throw new MissingAuthProviderError()
  }
  return context
}
