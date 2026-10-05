import ky, { HTTPError, TimeoutError } from "ky"
import { ZodError, z } from "zod"

export const RoleSchema = z.enum([
  "administrator",
  "operations_director",
  "operator",
  "sales_director",
  "salesperson",
  "engineering_director",
  "engineer",
])
export type Role = z.infer<typeof RoleSchema>

const PageAccessSchema = z.object({
  canDelete: z.boolean(),
  canView: z.boolean(),
  key: z.string(),
})

const ScopeSchema = z.object({
  groupIds: z.array(z.string().uuid()),
  pages: z.array(PageAccessSchema),
  permissions: z.array(z.string()),
  role: RoleSchema,
})

export const SessionUserSchema = z.object({
  displayName: z.string().min(1).optional(),
  email: z.string().email(),
  scope: ScopeSchema,
  userId: z.string().uuid(),
})
export type SessionUser = z.infer<typeof SessionUserSchema>

export const memberDisplayName = (user: SessionUser): string => {
  const name = user.displayName?.trim()
  return name !== undefined && name.length > 0 ? name : user.email
}

const SessionResponseSchema = z.object({ user: SessionUserSchema })
const LoginResponseSchema = SessionResponseSchema

export const LoginInputSchema = z.object({
  email: z.string().email("请输入有效邮箱"),
  password: z.string().min(1, "请输入密码"),
})
export type LoginInput = z.infer<typeof LoginInputSchema>

export type SessionState =
  | { readonly kind: "authenticated"; readonly user: SessionUser }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "unavailable" }

export interface AuthApi {
  login(input: LoginInput): Promise<SessionState>
  logout(): Promise<void>
  session(): Promise<SessionState>
}

const isAuthenticationFailure = (error: HTTPError): boolean => error.response.status === 401

const unavailable = (): SessionState => ({ kind: "unavailable" })

export const resolveApiBaseUrl = (apiBaseUrl: string, currentLocation: string): string => {
  const rootRelativePath = apiBaseUrl.startsWith("/") ? apiBaseUrl : `/${apiBaseUrl}`
  return new URL(rootRelativePath, currentLocation).toString()
}

const parseSession = (payload: unknown): SessionState => ({
  kind: "authenticated",
  user: SessionResponseSchema.parse(payload).user,
})

const recoverSessionFailure = (error: unknown): SessionState | null => {
  if (error instanceof HTTPError) {
    return isAuthenticationFailure(error) ? { kind: "unauthenticated" } : unavailable()
  }
  if (error instanceof TimeoutError || error instanceof TypeError || error instanceof ZodError) {
    return unavailable()
  }
  return null
}

export const createAuthApi = (apiBaseUrl = "/api"): AuthApi => {
  const client = ky.create({
    credentials: "include",
    prefixUrl: resolveApiBaseUrl(apiBaseUrl, window.location.href),
    retry: 0,
    timeout: 7_000,
  })

  return {
    login: async (input) => {
      try {
        const payload: unknown = await client.post("auth/login", { json: input }).json()
        return {
          kind: "authenticated",
          user: LoginResponseSchema.parse(payload).user,
        }
      } catch (error) {
        const recovered = recoverSessionFailure(error)
        if (recovered !== null) {
          return recovered
        }
        throw error
      }
    },
    logout: async () => {
      try {
        await client.post("auth/logout")
      } catch (error) {
        if (
          error instanceof HTTPError ||
          error instanceof TimeoutError ||
          error instanceof TypeError
        ) {
          return
        }
        throw error
      }
    },
    session: async () => {
      try {
        const payload: unknown = await client.get("auth/session").json()
        return parseSession(payload)
      } catch (error) {
        const recovered = recoverSessionFailure(error)
        if (recovered !== null) {
          return recovered
        }
        throw error
      }
    },
  }
}
