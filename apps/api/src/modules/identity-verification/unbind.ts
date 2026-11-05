import { createHash } from "node:crypto"
import type { Sql } from "postgres"
import { z } from "zod"
import { actorById, bindingByUser, eligible, requirePlatform, writeAudit } from "./repository"
import { IdentityError, type UnbindInput, type UnbindResult } from "./types"

export const unbindSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine(
      (value) => !/(?:\d[ -]?){15,17}[\dXx]/.test(value),
      "identity data must not be included",
    ),
  operatorPassword: z.string().min(1).max(1000),
})
export const idempotencySchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)
const replayMetadata = z.object({ fingerprint: z.string(), resultVersion: z.number().int() })
export const unbindIdentity = async (
  sql: Sql,
  input: UnbindInput,
  now: Date,
): Promise<UnbindResult> => {
  const parsed = unbindSchema.safeParse(input)
  if (!parsed.success || !idempotencySchema.safeParse(input.idempotencyKey).success)
    throw new IdentityError("invalid_request", 400)
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({ expectedVersion: parsed.data.expectedVersion, reason: parsed.data.reason }),
    )
    .digest("hex")
  const result = await sql.begin(async (tx) => {
    // All paths acquire user rows before the identity row, including user-change triggers.
    await tx`select id from app_user where id in (${input.actorId},${input.userId}) order by id for update`
    const actor = await actorById(tx, input.actorId)
    requirePlatform(actor)
    await tx`delete from identity_password_failure where actor_id=${input.actorId} and attempted_at<=${new Date(now.getTime() - 900000)}`
    const failures = await tx<
      { readonly count: number }[]
    >`select count(*)::int as count from identity_password_failure where actor_id=${input.actorId}`
    if ((failures[0]?.count ?? 0) >= 5) return new IdentityError("password_rate_limited", 429)
    if (!(await Bun.password.verify(parsed.data.operatorPassword, actor.passwordHash))) {
      await tx`insert into identity_password_failure(actor_id,attempted_at) values (${input.actorId},${now})`
      return new IdentityError("invalid_operator_password", 403)
    }
    const previous = await tx<
      { readonly metadata: unknown }[]
    >`select metadata from audit_event where actor_id=${input.actorId} and target=${input.userId} and action='identity.unbind' and metadata->>'idempotencyKey'=${input.idempotencyKey}`
    if (previous[0]) {
      const metadata = replayMetadata.parse(previous[0].metadata)
      if (metadata.fingerprint !== fingerprint) throw new IdentityError("idempotency_conflict", 409)
      return {
        status: "unbound",
        version: metadata.resultVersion,
        replayed: true,
      } satisfies UnbindResult
    }
    if (!eligible(await actorById(tx, input.userId))) throw new IdentityError("forbidden", 403)
    await tx`insert into admin_identity_verification(user_id) values (${input.userId}) on conflict do nothing`
    const binding = await bindingByUser(tx, input.userId, true)
    if (binding.version !== parsed.data.expectedVersion)
      throw new IdentityError("stale_version", 409)
    if (binding.status === "unbound")
      return { status: "unbound", version: binding.version, replayed: false } satisfies UnbindResult
    const version = binding.version + 1
    await tx`update identity_verification_attempt set status='superseded',error_code='identity_unbound',finished_at=${now} where user_id=${input.userId} and status='verifying'`
    await tx`update admin_identity_verification set status='unbound',version=${version},current_attempt_id=null,encrypted_name=null,encrypted_number=null,masked_name=null,masked_number=null,cert_no_hmac=null,hmac_key_version=null,verified_at=null,last_error_code=null,updated_at=${now} where user_id=${input.userId}`
    await tx`update app_session set revoked_at=${now} where user_id=${input.userId} and revoked_at is null`
    await writeAudit(tx, input.actorId, input.userId, "identity.unbind", "success", {
      idempotencyKey: input.idempotencyKey,
      fingerprint,
      resultVersion: version,
      expectedVersion: parsed.data.expectedVersion,
      reason: parsed.data.reason,
    })
    return { status: "unbound", version, replayed: false } satisfies UnbindResult
  })
  if (result instanceof IdentityError) throw result
  return result
}
