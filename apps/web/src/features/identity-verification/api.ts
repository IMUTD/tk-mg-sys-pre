import { z } from "zod"
import { apiFetch } from "../../lib/api/api-fetch"
import { IdentityAccessSchema } from "../../lib/api/auth-api"

export const IdentitySummarySchema = IdentityAccessSchema.extend({
  currentAttemptId: z.string().nullable(),
  maskedName: z.string().nullable(),
  maskedNumber: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  providerAvailable: z.boolean(),
  consentVersion: z.string(),
})
export type IdentitySummary = z.infer<typeof IdentitySummarySchema>
const AttemptSchema = z.object({
  id: z.string(),
  status: z.enum(["verifying", "verified", "rejected", "error", "superseded"]),
  errorCode: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
})
export type IdentityAttempt = z.infer<typeof AttemptSchema>
const PlatformIdentitySchema = IdentitySummarySchema.extend({
  userId: z.string(),
  email: z.string(),
  displayName: z.string(),
  enabled: z.boolean(),
})
export type PlatformIdentity = z.infer<typeof PlatformIdentitySchema>
const ListSchema = z.object({
  items: z.array(PlatformIdentitySchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
})
export class IdentityRequestError extends Error {
  constructor(
    readonly code: string,
    readonly attemptId?: string,
  ) {
    super(code)
    this.name = "IdentityRequestError"
  }
}

const request = async (
  path: string,
  options: Parameters<typeof apiFetch>[1] = {},
): Promise<unknown> => {
  const response = await apiFetch(`/api/${path}`, {
    credentials: "include",
    ...options,
    retry: 0,
    timeout: 45_000,
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    const error = z.object({ error: z.string(), attemptId: z.string().optional() }).safeParse(body)
    throw new IdentityRequestError(
      error.success ? error.data.error : "request_failed",
      error.success ? error.data.attemptId : undefined,
    )
  }
  return body
}
export const identityApi = {
  me: async (): Promise<IdentitySummary> =>
    IdentitySummarySchema.parse(await request("identity-verification/me")),
  submit: async (image: File, consentVersion: string, key: string): Promise<IdentityAttempt> => {
    const form = new FormData()
    form.append("frontImage", image)
    form.append("consentVersion", consentVersion)
    form.append("consentAccepted", "true")
    const result = await request("identity-verification/attempts", {
      method: "POST",
      body: form,
      headers: { "Idempotency-Key": key },
    })
    return z.object({ attempt: AttemptSchema }).parse(result).attempt
  },
  list: async (params: URLSearchParams) =>
    ListSchema.parse(await request(`platform/identity-verifications?${params}`)),
  history: async (userId: string) =>
    z
      .object({
        attempts: z.array(AttemptSchema),
        unbindings: z.array(
          z.object({
            id: z.string(),
            createdAt: z.string(),
            reason: z.string(),
            actorId: z.string(),
          }),
        ),
      })
      .parse(
        await request(`platform/identity-verifications/${encodeURIComponent(userId)}/attempts`),
      ),
  unbind: async (
    userId: string,
    input: {
      readonly expectedVersion: number
      readonly reason: string
      readonly operatorPassword: string
    },
    key: string,
  ) => {
    const result = await request(
      `platform/identity-verifications/${encodeURIComponent(userId)}/unbind`,
      {
        method: "POST",
        json: input,
        headers: { "Idempotency-Key": key },
      },
    )
    return z
      .object({ status: z.literal("unbound"), version: z.number(), replayed: z.boolean() })
      .parse(result)
  },
}
export type IdentityApi = typeof identityApi
