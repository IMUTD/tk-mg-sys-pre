import type { Sql, TransactionSql } from "postgres"
import type { IdentityConfig } from "./config"
import { identityProviderAvailable } from "./config"
import {
  type Attempt,
  ConsentVersion,
  IdentityError,
  type IdentityStatus,
  type IdentitySummary,
} from "./types"

export type IdentitySql = Sql | TransactionSql
export type Actor = {
  readonly id: string
  readonly enabled: boolean
  readonly role: string
  readonly provisionedBy: string
  readonly passwordHash: string
  readonly email: string
  readonly displayName: string
}
export type Binding = {
  readonly status: IdentityStatus
  readonly version: number
  readonly currentAttemptId: string | null
  readonly maskedName: string | null
  readonly maskedNumber: string | null
  readonly lastErrorCode: string | null
  readonly verifiedAt: Date | null
}
export const eligible = (actor: Actor): boolean =>
  actor.role === "administrator" && actor.provisionedBy === "init-tool"
export const platform = (actor: Actor): boolean =>
  actor.enabled && actor.role === "administrator" && actor.provisionedBy === "sys"
export const actorById = async (sql: IdentitySql, userId: string, lock = false): Promise<Actor> => {
  const rows = await sql<
    Actor[]
  >`select id, enabled, role, provisioned_by as "provisionedBy", password_hash as "passwordHash", email, display_name as "displayName" from app_user where id=${userId} ${lock ? sql`for update` : sql``}`
  const actor = rows[0]
  if (!actor) throw new IdentityError("not_found", 404)
  return actor
}
export const requireSelf = (actor: Actor): void => {
  if (!actor.enabled || !eligible(actor)) throw new IdentityError("forbidden", 403)
}
export const requirePlatform = (actor: Actor): void => {
  if (!platform(actor)) throw new IdentityError("forbidden", 403)
}
export const bindingByUser = async (
  sql: IdentitySql,
  userId: string,
  lock = false,
): Promise<Binding> => {
  const rows = await sql<
    Binding[]
  >`select status,version,current_attempt_id as "currentAttemptId",masked_name as "maskedName",masked_number as "maskedNumber",last_error_code as "lastErrorCode",verified_at as "verifiedAt" from admin_identity_verification where user_id=${userId} ${lock ? sql`for update` : sql``}`
  return (
    rows[0] ?? {
      status: "unverified",
      version: 0,
      currentAttemptId: null,
      maskedName: null,
      maskedNumber: null,
      lastErrorCode: null,
      verifiedAt: null,
    }
  )
}
export const summary = (
  actor: Actor,
  binding: Binding,
  config: IdentityConfig,
): IdentitySummary => {
  const required = eligible(actor) && config.mode === "enforced"
  return {
    ...binding,
    mode: config.mode,
    required,
    canVerify: actor.enabled && eligible(actor) && config.mode !== "off",
    status: eligible(actor) ? binding.status : "not_required",
    canAccessBusiness: actor.enabled && (!required || binding.status === "verified"),
    isPlatformAdmin: platform(actor),
    providerAvailable: identityProviderAvailable(config),
    consentVersion: ConsentVersion,
  }
}
export const attemptsBy = (sql: IdentitySql, userId: string, attemptId?: string) =>
  sql<
    Attempt[]
  >`select id,user_id as "userId",binding_version as "bindingVersion",status,provider_code as "providerCode",provider_biz_code as "providerBizCode",provider_request_id as "providerRequestId",error_code as "errorCode",consent_version as "consentVersion",started_at as "startedAt",deadline_at as "deadlineAt",finished_at as "finishedAt" from identity_verification_attempt where user_id=${userId} ${attemptId ? sql`and id=${attemptId}` : sql``} order by started_at desc limit 100`
export const attemptById = async (
  sql: IdentitySql,
  userId: string,
  attemptId: string,
): Promise<Attempt> => {
  const rows = await attemptsBy(sql, userId, attemptId)
  if (!rows[0]) throw new IdentityError("not_found", 404)
  return rows[0]
}
export const writeAudit = async (
  sql: IdentitySql,
  actorId: string,
  target: string,
  action: string,
  outcome: string,
  metadata: Record<string, string | number | boolean | null>,
): Promise<void> => {
  await sql`insert into audit_event(id,actor_id,target,action,outcome,metadata) values (${crypto.randomUUID()},${actorId},${target},${action},${outcome},${sql.json(metadata)})`
}
export const expireForUser = async (sql: Sql, userId: string, now: Date): Promise<number> =>
  sql.begin(async (tx) => {
    await actorById(tx, userId, true)
    await bindingByUser(tx, userId, true)
    await tx`update identity_verification_attempt set request_fingerprint=null where user_id=${userId} and request_fingerprint is not null and started_at<=${new Date(now.getTime() - 86400000)}`
    const rows = await tx<
      { readonly id: string }[]
    >`update identity_verification_attempt set status='error',error_code='identity_provider_timeout',finished_at=${now} where user_id=${userId} and status='verifying' and lease_expires_at<=${now} returning id`
    for (const row of rows) {
      await tx`update admin_identity_verification set status='error',last_error_code='identity_provider_timeout',updated_at=${now} where user_id=${userId} and status='verifying' and current_attempt_id=${row.id}`
      await writeAudit(tx, userId, userId, "identity.verify", "error", {
        attemptId: row.id,
        errorCode: "identity_provider_timeout",
      })
    }
    return rows.length
  })
