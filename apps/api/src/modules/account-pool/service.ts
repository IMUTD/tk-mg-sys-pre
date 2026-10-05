import { z } from "zod"
import { GroupIdSchema, type UserId } from "../../lib/authorization"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import type { AccountLease, AccountPoolItem, AccountPoolRepository } from "./repository"

type Dependencies = {
  readonly auditRepository?: AuditRepository
  readonly repository: AccountPoolRepository
}
export type LeaseResult =
  | { readonly kind: "conflict" }
  | { readonly kind: "leased"; readonly lease: AccountLease }
export interface AccountPoolService {
  lease(input: {
    readonly accountId: string
    readonly expiresAt?: Date | undefined
    readonly groupId: string
    readonly operatorId: UserId | string
  }): Promise<LeaseResult>
  list(groupId: string): Promise<readonly AccountPoolItem[]>
  release(input: {
    readonly accountId: string
    readonly allowReclaim: boolean
    readonly groupId: string
    readonly operatorId: UserId | string
  }): Promise<boolean>
}
const audit = async (
  repo: AuditRepository | undefined,
  actorId: UserId,
  action: string,
  target: string,
): Promise<void> => {
  if (repo !== undefined)
    await writeAuditEvent(repo, { action, actorId, outcome: "allowed", target })
}
export const createAccountPoolService = (
  dependencies: Dependencies | AccountPoolRepository,
): AccountPoolService => {
  const resolved = "repository" in dependencies ? dependencies : { repository: dependencies }
  return {
    lease: async (input) => {
      const actorId = z.string().uuid().brand<"UserId">().parse(input.operatorId)
      const lease = await resolved.repository.lease(
        GroupIdSchema.parse(input.groupId),
        input.accountId,
        actorId,
        input.expiresAt ?? null,
      )
      if (lease === null) return { kind: "conflict" }
      await audit(resolved.auditRepository, actorId, "account.lease", `account:${input.accountId}`)
      return { kind: "leased", lease }
    },
    list: async (groupId) => resolved.repository.list(GroupIdSchema.parse(groupId)),
    release: async (input) => {
      const actorId = z.string().uuid().brand<"UserId">().parse(input.operatorId)
      const released = await resolved.repository.release(
        GroupIdSchema.parse(input.groupId),
        input.accountId,
        actorId,
        input.allowReclaim,
      )
      if (released)
        await audit(
          resolved.auditRepository,
          actorId,
          input.allowReclaim ? "account.lease.reclaim" : "account.lease.release",
          `account:${input.accountId}`,
        )
      return released
    },
  }
}
