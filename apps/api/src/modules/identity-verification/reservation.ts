import type { IdentityConfig } from "./config"
import { identityProviderAvailable } from "./config"
import { actorById, attemptById, bindingByUser, type IdentitySql, requireSelf } from "./repository"
import { type Attempt, IdentityError } from "./types"

export type Reservation = { readonly fresh: boolean; readonly attempt: Attempt }
export const preflightSubmission = async (
  tx: IdentitySql,
  input: {
    readonly userId: string
    readonly idempotencyKey: string
    readonly fingerprint: string
    readonly consentVersion: string
  },
  config: IdentityConfig,
): Promise<Attempt | null> => {
  const actor = await actorById(tx, input.userId, true)
  requireSelf(actor)
  if (config.mode === "off") throw new IdentityError("identity_provider_unavailable", 503)
  const binding = await bindingByUser(tx, input.userId, true)
  const previous = await tx<
    { readonly id: string; readonly fingerprint: string | null }[]
  >`select id,request_fingerprint as fingerprint from identity_verification_attempt where user_id=${input.userId} and idempotency_key=${input.idempotencyKey}`
  if (previous[0]) {
    if (previous[0].fingerprint === null) throw new IdentityError("idempotency_expired", 409)
    if (previous[0].fingerprint !== input.fingerprint)
      throw new IdentityError("idempotency_conflict", 409)
    return attemptById(tx, input.userId, previous[0].id)
  }
  if (binding.status === "verifying" && binding.currentAttemptId)
    return attemptById(tx, input.userId, binding.currentAttemptId)
  if (binding.status === "verified") throw new IdentityError("already_verified", 409)
  return null
}
export const reserveAttempt = async (
  tx: IdentitySql,
  input: {
    readonly userId: string
    readonly idempotencyKey: string
    readonly fingerprint: string
    readonly consentVersion: string
  },
  config: IdentityConfig,
  now: Date,
): Promise<Reservation> => {
  const existing = await preflightSubmission(tx, input, config)
  if (existing) return { fresh: false, attempt: existing }
  await tx`insert into admin_identity_verification(user_id) values (${input.userId}) on conflict do nothing`
  const binding = await bindingByUser(tx, input.userId, true)
  if (!identityProviderAvailable(config))
    throw new IdentityError("identity_provider_unavailable", 503)
  const shifted = new Date(now.getTime() + 8 * 3600000)
  const dayStart = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 8 * 3600000,
  )
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600000)
  await tx`select pg_advisory_xact_lock(817203, ${Math.floor(dayStart.getTime() / 86400000)})`
  const counts = await tx<
    { readonly total: number; readonly own: number; readonly recent: number }[]
  >`select count(*)::int as total,count(*) filter(where user_id=${input.userId})::int as own,count(*) filter(where user_id=${input.userId} and started_at>${new Date(now.getTime() - 60000)})::int as recent from identity_verification_attempt where started_at>=${dayStart} and started_at<${dayEnd}`
  const count = counts[0]
  // The minute window crosses midnight, independently of the daily quota.
  const recent = await tx<
    { readonly count: number }[]
  >`select count(*)::int as count from identity_verification_attempt where user_id=${input.userId} and started_at>${new Date(now.getTime() - 60000)}`
  if (
    !count ||
    count.total >= config.dailyLimit ||
    count.own >= config.userDailyLimit ||
    (recent[0]?.count ?? 0) > 0
  )
    throw new IdentityError("rate_limited", 429)
  const id = crypto.randomUUID()
  const version = binding.version + 1
  await tx`insert into identity_verification_attempt(id,user_id,binding_version,idempotency_key,request_fingerprint,status,consent_version,consented_at,started_at,deadline_at,lease_expires_at) values (${id},${input.userId},${version},${input.idempotencyKey},${input.fingerprint},'verifying',${input.consentVersion},${now},${now},${new Date(now.getTime() + 30000)},${new Date(now.getTime() + 90000)})`
  await tx`update admin_identity_verification set status='verifying',version=${version},current_attempt_id=${id},last_error_code=null,updated_at=${now} where user_id=${input.userId}`
  return { fresh: true, attempt: await attemptById(tx, input.userId, id) }
}
