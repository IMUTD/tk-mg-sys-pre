import { createHmac } from "node:crypto"
import postgres from "postgres"
import { providerFailure } from "./provider"
import { actorById, attemptById, bindingByUser, eligible, writeAudit } from "./repository"
import {
  type Attempt,
  type IdentityDependencies,
  IdentityError,
  type ProviderResult,
} from "./types"

export const completeAttempt = async (
  dependencies: IdentityDependencies,
  attempt: Attempt,
  outcome: ProviderResult,
): Promise<Attempt> => {
  const { sql, cipher, config } = dependencies
  const finish = async (result: ProviderResult): Promise<Attempt> =>
    sql.begin(async (tx) => {
      const actor = await actorById(tx, attempt.userId, true)
      const binding = await bindingByUser(tx, attempt.userId, true)
      const current = await attemptById(tx, attempt.userId, attempt.id)
      const now = (dependencies.clock ?? (() => new Date()))()
      if (current.status !== "verifying") return current
      if (
        !actor.enabled ||
        !eligible(actor) ||
        binding.version !== attempt.bindingVersion ||
        binding.currentAttemptId !== attempt.id ||
        binding.status !== "verifying"
      ) {
        await tx`update identity_verification_attempt set status='superseded',error_code='identity_attempt_superseded',finished_at=${now} where id=${attempt.id}`
        return attemptById(tx, attempt.userId, attempt.id)
      }
      const effective =
        now.getTime() >= attempt.deadlineAt.getTime()
          ? providerFailure("identity_provider_timeout")
          : result
      switch (effective.status) {
        case "verified": {
          if (!config.hmacKey)
            throw new IdentityError("identity_provider_unavailable", 503, attempt.id)
          const hash = createHmac("sha256", config.hmacKey).update(effective.number).digest("hex")
          const maskedName = `${effective.name.slice(0, 1)}${"*".repeat(Math.min(effective.name.length - 1, 5))}`
          const maskedNumber = `${effective.number.slice(0, 3)}***********${effective.number.slice(-4)}`
          await tx`update admin_identity_verification set status='verified',encrypted_name=${cipher.encrypt(effective.name)},encrypted_number=${cipher.encrypt(effective.number)},masked_name=${maskedName},masked_number=${maskedNumber},cert_no_hmac=${hash},hmac_key_version=${config.hmacKeyVersion},verified_at=${now},last_error_code=null,updated_at=${now} where user_id=${attempt.userId}`
          break
        }
        case "rejected":
        case "error":
          await tx`update admin_identity_verification set status=${effective.status},last_error_code=${effective.errorCode},updated_at=${now} where user_id=${attempt.userId}`
          break
        default: {
          const exhaustive: never = effective
          return exhaustive
        }
      }
      const errorCode = effective.status === "verified" ? null : effective.errorCode
      await tx`update identity_verification_attempt set status=${effective.status},provider_code=${effective.code},provider_biz_code=${effective.bizCode},provider_request_id=${effective.requestId},error_code=${errorCode},finished_at=${now} where id=${attempt.id}`
      await writeAudit(tx, attempt.userId, attempt.userId, "identity.verify", effective.status, {
        attemptId: attempt.id,
        version: attempt.bindingVersion,
        errorCode,
      })
      return attemptById(tx, attempt.userId, attempt.id)
    })
  try {
    return await finish(outcome)
  } catch (error) {
    if (
      error instanceof postgres.PostgresError &&
      error.code === "23505" &&
      error.constraint_name === "admin_identity_verified_hmac_unique"
    )
      return finish({
        status: "rejected",
        errorCode: "identity_already_bound",
        code: outcome.code,
        bizCode: outcome.bizCode,
        requestId: outcome.requestId,
      })
    throw error
  }
}
