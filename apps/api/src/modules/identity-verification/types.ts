import type { Sql } from "postgres"
import type { UserId } from "../../lib/authorization"
import type { SecretCipher } from "../../lib/crypto"
import type { IdentityConfig } from "./config"

export const ConsentVersion = "2026-11-05-v1"
export const statuses = [
  "unverified",
  "verifying",
  "verified",
  "rejected",
  "error",
  "unbound",
] as const
export type IdentityStatus = (typeof statuses)[number]
export type IdentityAccess = {
  readonly mode: IdentityConfig["mode"]
  readonly required: boolean
  readonly canVerify: boolean
  readonly status: IdentityStatus | "not_required"
  readonly canAccessBusiness: boolean
  readonly version: number
  readonly isPlatformAdmin: boolean
}
export type IdentitySummary = IdentityAccess & {
  readonly currentAttemptId: string | null
  readonly maskedName: string | null
  readonly maskedNumber: string | null
  readonly lastErrorCode: string | null
  readonly verifiedAt: Date | null
  readonly providerAvailable: boolean
  readonly consentVersion: string
}
export type Attempt = {
  readonly id: string
  readonly userId: string
  readonly bindingVersion: number
  readonly status: "verifying" | "verified" | "rejected" | "error" | "superseded"
  readonly providerCode: string | null
  readonly providerBizCode: string | null
  readonly providerRequestId: string | null
  readonly errorCode: string | null
  readonly consentVersion: string
  readonly startedAt: Date
  readonly deadlineAt: Date
  readonly finishedAt: Date | null
}
export type ProviderMetadata = {
  readonly code: string | null
  readonly bizCode: string | null
  readonly requestId: string | null
}
export type ProviderResult = ProviderMetadata &
  (
    | { readonly status: "verified"; readonly name: string; readonly number: string }
    | { readonly status: "rejected" | "error"; readonly errorCode: string }
  )
export interface IdentityProvider {
  verify(image: Buffer): Promise<ProviderResult>
}
export type IdentityDependencies = {
  readonly sql: Sql
  readonly cipher: SecretCipher
  readonly config: IdentityConfig
  readonly provider: IdentityProvider
  readonly clock?: () => Date
}
export type SubmitInput = {
  readonly userId: UserId
  readonly idempotencyKey: string
  readonly frontImage: File
  readonly consentVersion: string
  readonly consentAccepted: boolean
}
export type UnbindInput = {
  readonly actorId: UserId
  readonly userId: UserId
  readonly idempotencyKey: string
  readonly expectedVersion: number
  readonly reason: string
  readonly operatorPassword: string
}
export type UnbindResult = {
  readonly status: "unbound"
  readonly version: number
  readonly replayed: boolean
}
export type ListQuery = {
  readonly page: number
  readonly pageSize: number
  readonly q?: string | undefined
  readonly status?: IdentityStatus | undefined
  readonly from?: Date | undefined
  readonly to?: Date | undefined
}
export type PlatformIdentity = IdentitySummary & {
  readonly userId: string
  readonly email: string
  readonly displayName: string
  readonly enabled: boolean
}
export type IdentityUnbinding = {
  readonly id: string
  readonly createdAt: Date
  readonly actorId: string
  readonly reason: string
}
export interface IdentityService {
  getAccess(userId: UserId): Promise<IdentityAccess>
  getMe(userId: UserId): Promise<IdentitySummary>
  submit(input: SubmitInput): Promise<Attempt>
  getAttempt(userId: UserId, attemptId: string): Promise<Attempt>
  list(
    actorId: UserId,
    query: ListQuery,
  ): Promise<{
    readonly items: readonly PlatformIdentity[]
    readonly total: number
    readonly page: number
    readonly pageSize: number
  }>
  listAttempts(actorId: UserId, userId: UserId): Promise<readonly Attempt[]>
  listUnbindings(actorId: UserId, userId: UserId): Promise<readonly IdentityUnbinding[]>
  unbind(input: UnbindInput): Promise<UnbindResult>
  cleanupExpired(): Promise<number>
}
export class IdentityError extends Error {
  public constructor(
    readonly code: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 503 | 504,
    readonly attemptId?: string,
  ) {
    super(code)
    this.name = "IdentityError"
  }
}
