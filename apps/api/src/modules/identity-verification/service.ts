import { createHmac } from "node:crypto"
import { completeAttempt } from "./completion"
import { providerFailure } from "./provider"
import { listIdentities, listUnbindings } from "./queries"
import {
  actorById,
  attemptById,
  attemptsBy,
  bindingByUser,
  expireForUser,
  requirePlatform,
  requireSelf,
  summary,
} from "./repository"
import { preflightSubmission, reserveAttempt } from "./reservation"
import { submissionResult } from "./submission-result"
import {
  ConsentVersion,
  type IdentityDependencies,
  IdentityError,
  type IdentityService,
  type ProviderResult,
} from "./types"
import { idempotencySchema, unbindIdentity } from "./unbind"
import { decodeIdentityImage, readIdentityImage } from "./upload"

export const createIdentityService = (dependencies: IdentityDependencies): IdentityService => {
  const { sql, config, provider } = dependencies
  const clock = dependencies.clock ?? (() => new Date())
  const getSummary = async (userId: string) => {
    await expireForUser(sql, userId, clock())
    return summary(await actorById(sql, userId), await bindingByUser(sql, userId), config)
  }
  return {
    getAccess: getSummary,
    getMe: async (userId) => {
      requireSelf(await actorById(sql, userId))
      return getSummary(userId)
    },
    submit: async (input) => {
      if (!input.consentAccepted || input.consentVersion !== ConsentVersion)
        throw new IdentityError("consent_required", 400)
      if (!idempotencySchema.safeParse(input.idempotencyKey).success)
        throw new IdentityError("invalid_request", 400)
      requireSelf(await actorById(sql, input.userId))
      if (config.mode === "off" || !config.hmacKey)
        throw new IdentityError("identity_provider_unavailable", 503)
      const bytes = await readIdentityImage(input.frontImage)
      const fingerprint = createHmac("sha256", config.hmacKey)
        .update(input.userId)
        .update(bytes)
        .update(`\0${input.consentVersion}`)
        .digest("hex")
      await expireForUser(sql, input.userId, clock())
      const existing = await sql.begin((tx) =>
        preflightSubmission(tx, { ...input, fingerprint }, config),
      )
      if (existing) return submissionResult(existing)
      await decodeIdentityImage(bytes, input.frontImage.type)
      const reservation = await sql.begin((tx) =>
        reserveAttempt(tx, { ...input, fingerprint }, config, clock()),
      )
      if (!reservation.fresh) return submissionResult(reservation.attempt)
      let timeout: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<ProviderResult>((resolve) => {
        timeout = setTimeout(
          () => resolve(providerFailure("identity_provider_timeout")),
          Math.max(0, reservation.attempt.deadlineAt.getTime() - clock().getTime()),
        )
      })
      // SDK work may continue after this result deadline; only the winning result is completed.
      const run = Promise.resolve()
        .then(() =>
          clock().getTime() >= reservation.attempt.deadlineAt.getTime()
            ? providerFailure("identity_provider_timeout")
            : provider.verify(bytes),
        )
        .catch((error: unknown) => {
          if (error instanceof Error) return providerFailure("identity_provider_unavailable")
          throw error
        })
      try {
        const result = await Promise.race([run, deadline])
        const attempt = await completeAttempt(dependencies, reservation.attempt, result)
        return submissionResult(attempt)
      } finally {
        clearTimeout(timeout)
      }
    },
    getAttempt: async (userId, attemptId) => {
      requireSelf(await actorById(sql, userId))
      await expireForUser(sql, userId, clock())
      return attemptById(sql, userId, attemptId)
    },
    list: async (actorId, query) => {
      requirePlatform(await actorById(sql, actorId))
      await cleanupExpired()
      return listIdentities(sql, config, actorId, query)
    },
    listAttempts: async (actorId, userId) => {
      requirePlatform(await actorById(sql, actorId))
      await expireForUser(sql, userId, clock())
      return attemptsBy(sql, userId)
    },
    listUnbindings: (actorId, userId) => listUnbindings(sql, actorId, userId),
    unbind: (input) => unbindIdentity(sql, input, clock()),
    cleanupExpired,
  }
  async function cleanupExpired(): Promise<number> {
    const rows = await sql<
      { readonly userId: string }[]
    >`select distinct user_id as "userId" from identity_verification_attempt where (status='verifying' and lease_expires_at<=${clock()}) or (request_fingerprint is not null and started_at<=${new Date(clock().getTime() - 86400000)}) limit 100`
    let count = 0
    for (const row of rows) count += await expireForUser(sql, row.userId, clock())
    return count
  }
}
