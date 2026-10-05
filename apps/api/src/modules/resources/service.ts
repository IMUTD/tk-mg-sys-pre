import { GroupIdSchema, type UserId } from "../../lib/authorization"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import {
  type OperationResource,
  OperationResourceIdSchema,
  type ResourceAllocation,
  type ResourceCreateInput,
  type ResourceListFilter,
  type ResourcePage,
  type ResourceRepository,
  type ResourceUpdateInput,
} from "./repository"

type ResourceServiceDependencies = {
  readonly auditRepository: AuditRepository
  readonly repository: ResourceRepository
}

export interface ResourceService {
  allocate(
    actorId: UserId,
    groupId: string,
    resourceId: string,
    accountId: string,
  ): Promise<ResourceAllocation | null>
  create(
    actorId: UserId,
    groupId: string,
    input: Omit<ResourceCreateInput, "groupId">,
  ): Promise<OperationResource>
  delete(actorId: UserId, groupId: string, ids: readonly string[]): Promise<number>
  history(groupId: string, resourceId: string): Promise<readonly ResourceAllocation[]>
  list(
    filter: Omit<ResourceListFilter, "groupId"> & { readonly groupId: string },
  ): Promise<ResourcePage>
  release(actorId: UserId, groupId: string, resourceId: string): Promise<boolean>
  update(
    actorId: UserId,
    groupId: string,
    resourceId: string,
    input: ResourceUpdateInput,
  ): Promise<OperationResource | null>
}

const audit = async (
  auditRepository: AuditRepository,
  actorId: UserId,
  action: string,
  target: string,
): Promise<void> => {
  await writeAuditEvent(auditRepository, { action, actorId, outcome: "allowed", target })
}

export const createResourceService = (
  dependencies: ResourceServiceDependencies,
): ResourceService => ({
  allocate: async (actorId, rawGroupId, rawResourceId, accountId) => {
    const allocation = await dependencies.repository.allocate(
      GroupIdSchema.parse(rawGroupId),
      OperationResourceIdSchema.parse(rawResourceId),
      accountId,
      actorId,
    )
    if (allocation !== null)
      await audit(
        dependencies.auditRepository,
        actorId,
        "resource.allocate",
        `resource:${rawResourceId}`,
      )
    return allocation
  },
  create: async (actorId, rawGroupId, input) => {
    const resource = await dependencies.repository.create({
      ...input,
      groupId: GroupIdSchema.parse(rawGroupId),
    })
    await audit(dependencies.auditRepository, actorId, "resource.create", `resource:${resource.id}`)
    return resource
  },
  delete: async (actorId, rawGroupId, rawIds) => {
    const count = await dependencies.repository.delete(
      GroupIdSchema.parse(rawGroupId),
      rawIds.map((id) => OperationResourceIdSchema.parse(id)),
    )
    await audit(dependencies.auditRepository, actorId, "resource.delete", `group:${rawGroupId}`)
    return count
  },
  history: async (rawGroupId, rawResourceId) =>
    dependencies.repository.history(
      GroupIdSchema.parse(rawGroupId),
      OperationResourceIdSchema.parse(rawResourceId),
    ),
  list: async (filter) =>
    dependencies.repository.list({ ...filter, groupId: GroupIdSchema.parse(filter.groupId) }),
  release: async (actorId, rawGroupId, rawResourceId) => {
    const released = await dependencies.repository.release(
      GroupIdSchema.parse(rawGroupId),
      OperationResourceIdSchema.parse(rawResourceId),
    )
    if (released)
      await audit(
        dependencies.auditRepository,
        actorId,
        "resource.release",
        `resource:${rawResourceId}`,
      )
    return released
  },
  update: async (actorId, rawGroupId, rawResourceId, input) => {
    const resource = await dependencies.repository.update(
      GroupIdSchema.parse(rawGroupId),
      OperationResourceIdSchema.parse(rawResourceId),
      input,
    )
    if (resource !== null)
      await audit(
        dependencies.auditRepository,
        actorId,
        "resource.update",
        `resource:${resource.id}`,
      )
    return resource
  },
})
