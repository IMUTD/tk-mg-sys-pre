import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createContext, type ReactNode, useContext, useEffect, useRef } from "react"
import {
  ApiAccessEvent,
  advanceApiSession,
  apiSessionGeneration,
} from "../../lib/api/access-events"
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
  const queryClient = useQueryClient()
  useEffect(() => {
    const recover = async (event: Event) => {
      if (!(event instanceof ApiAccessEvent)) return
      const generation = apiSessionGeneration()
      await queryClient.cancelQueries({ queryKey: ["auth", "session"] })
      if (generation !== apiSessionGeneration()) return
      if (event.kind === "unauthenticated") {
        advanceApiSession()
        queryClient.setQueryData(["auth", "session"], { kind: "unauthenticated" })
        queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" })
      } else {
        queryClient.setQueryData<SessionState>(["auth", "session"], (previous) => {
          if (previous?.kind !== "authenticated" || previous.user.identity === undefined)
            return previous
          return {
            ...previous,
            user: {
              ...previous.user,
              identity: { ...previous.user.identity, canAccessBusiness: false },
            },
          }
        })
        void queryClient.invalidateQueries({ queryKey: ["auth", "session"] })
      }
    }
    const listener = (event: Event) => {
      void recover(event)
    }
    window.addEventListener("tk-mg:api-access", listener)
    return () => window.removeEventListener("tk-mg:api-access", listener)
  }, [queryClient])
  const sessionQuery = useQuery({
    queryFn: () => api.session(),
    queryKey: ["auth", "session"],
    throwOnError: true,
  })
  const session =
    sessionQuery.isPending || sessionQuery.data === undefined
      ? { kind: "loading" as const }
      : sessionQuery.data
  const previousAccount = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (session.kind === "loading" || session.kind === "unavailable") return
    const account = session.kind === "authenticated" ? session.user.userId : ""
    if (previousAccount.current !== undefined && previousAccount.current !== account)
      advanceApiSession()
    previousAccount.current = account
  }, [session])

  return <AuthContext.Provider value={{ api, session }}>{children}</AuthContext.Provider>
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext)
  if (context === null) {
    throw new MissingAuthProviderError()
  }
  return context
}
