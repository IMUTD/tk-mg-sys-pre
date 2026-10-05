import type { TransactionSql } from "postgres"

export class OperationDeleteConflictError extends Error {
  public constructor() {
    super("Operation entity is in active use")
    this.name = "OperationDeleteConflictError"
  }
}

export const assertNoActiveTaskClaims = async (
  transaction: TransactionSql,
  groupId: string,
  claimKind: string,
  entityIds: readonly string[],
): Promise<void> => {
  if (entityIds.length === 0) return
  const claims = await transaction<{ readonly id: string }[]>`
    select id from operation_task_claim
    where group_id = ${groupId} and claim_kind = ${claimKind} and entity_id = any(${entityIds}) and released_at is null
    for key share
  `
  if (claims[0] !== undefined) throw new OperationDeleteConflictError()
}

export const assertNoActiveExecutionLeases = async (
  transaction: TransactionSql,
  groupId: string,
  deviceId: string,
  instanceId?: string,
): Promise<void> => {
  const leases = await transaction<{ readonly id: string }[]>`
    select id from execution_task_device_lease
    where group_id = ${groupId} and device_id = ${deviceId}
      and released_at is null
      and (${instanceId ?? null}::uuid is null or instance_id is null or instance_id = ${instanceId ?? null}::uuid)
    for key share
  `
  if (leases[0] !== undefined) throw new OperationDeleteConflictError()
}

export const assertNoActiveResourceAllocations = async (
  transaction: TransactionSql,
  groupId: string,
  resourceIds: readonly string[],
): Promise<void> => {
  if (resourceIds.length === 0) return
  const allocations = await transaction<{ readonly id: string }[]>`
    select id from operation_resource_allocation
    where group_id = ${groupId} and resource_id = any(${resourceIds}) and released_at is null
    for key share
  `
  if (allocations[0] !== undefined) throw new OperationDeleteConflictError()
}

export const assertNoActiveAccountLeases = async (
  transaction: TransactionSql,
  groupId: string,
  accountIds: readonly string[],
): Promise<void> => {
  if (accountIds.length === 0) return
  const leases = await transaction<{ readonly id: string }[]>`
    select id from operation_account_lease
    where group_id = ${groupId} and account_id = any(${accountIds}) and released_at is null and (expires_at is null or expires_at > now())
    for key share
  `
  if (leases[0] !== undefined) throw new OperationDeleteConflictError()
}

export const assertNoActiveAccountResourceAllocations = async (
  transaction: TransactionSql,
  groupId: string,
  accountIds: readonly string[],
): Promise<void> => {
  if (accountIds.length === 0) return
  const allocations = await transaction<{ readonly id: string }[]>`
    select id from operation_resource_allocation
    where group_id = ${groupId} and account_id = any(${accountIds}) and released_at is null
    for key share
  `
  if (allocations[0] !== undefined) throw new OperationDeleteConflictError()
}
