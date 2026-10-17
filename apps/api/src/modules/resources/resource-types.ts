import { z } from "zod"

import type { GroupId, UserId } from "../../lib/authorization"

export const OperationResourceIdSchema = z.string().uuid().brand<"OperationResourceId">()
export type OperationResourceId = z.infer<typeof OperationResourceIdSchema>
export const OperationResourceStatus = {
  Allocated: "allocated",
  Available: "available",
  Inactive: "inactive",
} as const
export type OperationResourceStatus =
  (typeof OperationResourceStatus)[keyof typeof OperationResourceStatus]
export const OperationResourceStatusSchema = z.enum([
  OperationResourceStatus.Allocated,
  OperationResourceStatus.Available,
  OperationResourceStatus.Inactive,
])
export type OperationResource = {
  readonly category: string
  readonly createdAt: Date
  readonly groupId: GroupId
  readonly id: OperationResourceId
  readonly name: string
  readonly note: string
  readonly assignedCount?: number
  readonly lastAssignedAt?: Date | null
  readonly status: OperationResourceStatus
  readonly tags: readonly string[]
  readonly updatedAt: Date
}
export type ResourceAllocation = {
  readonly accountId: string
  readonly allocatedByUserId: string
  readonly createdAt: Date
  readonly id: string
  readonly releasedAt: Date | null
  readonly resourceId: OperationResourceId
}
export type ResourceListFilter = {
  readonly groupId: GroupId
  readonly page: number
  readonly pageSize: number
  readonly query?: string | undefined
  readonly status?: OperationResourceStatus | undefined
  readonly tag?: string | undefined
}
export type ResourcePage = {
  readonly items: readonly OperationResource[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}
export type ResourceCreateInput = {
  readonly category: string
  readonly groupId: GroupId
  readonly name: string
  readonly note: string
  readonly status: OperationResourceStatus
  readonly tags: readonly string[]
}
export type ResourceUpdateInput = {
  readonly category?: string | undefined
  readonly name?: string | undefined
  readonly note?: string | undefined
  readonly status?: OperationResourceStatus | undefined
  readonly tags?: readonly string[] | undefined
}
export interface ResourceRepository {
  allocate(
    groupId: GroupId,
    resourceId: OperationResourceId,
    accountId: string,
    actorId: UserId,
  ): Promise<ResourceAllocation | null>
  create(input: ResourceCreateInput): Promise<OperationResource>
  assignTags(
    groupId: GroupId,
    ids: readonly OperationResourceId[],
    tags: readonly string[],
    actorId: UserId,
  ): Promise<number>
  delete(groupId: GroupId, ids: readonly OperationResourceId[]): Promise<number>
  deleteScope(groupId: GroupId, tag: string | null): Promise<number>
  importTexts(input: {
    readonly contents: readonly string[]
    readonly groupId: GroupId
    readonly tag: string
  }): Promise<readonly OperationResource[]>
  find(groupId: GroupId, resourceId: OperationResourceId): Promise<OperationResource | null>
  history(groupId: GroupId, resourceId: OperationResourceId): Promise<readonly ResourceAllocation[]>
  list(filter: ResourceListFilter): Promise<ResourcePage>
  release(groupId: GroupId, resourceId: OperationResourceId): Promise<boolean>
  update(
    groupId: GroupId,
    resourceId: OperationResourceId,
    input: ResourceUpdateInput,
  ): Promise<OperationResource | null>
}
