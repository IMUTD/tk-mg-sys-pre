import { GroupIdSchema, UserIdSchema } from "../../lib/authorization"
import {
  DeskCreateSchema,
  PoolConsumeSchema,
  PoolIdSchema,
  PoolListSchema,
  PoolSourceFilterSchema,
  PoolWriteSchema,
} from "./pool-model"
import type { PoolRepository } from "./pool-repository"

export type PoolService = PoolRepository

export const createPoolService = (repository: PoolRepository): PoolService => ({
  list: (groupId, input) =>
    repository.list(GroupIdSchema.parse(groupId), PoolListSchema.parse(input)),
  devices: (groupId) => repository.devices(GroupIdSchema.parse(groupId)),
  sources: (groupId, filter, page, pageSize) =>
    repository.sources(
      GroupIdSchema.parse(groupId),
      PoolSourceFilterSchema.parse(filter),
      page,
      pageSize,
    ),
  create: (groupId, actorId, input) =>
    repository.create(
      GroupIdSchema.parse(groupId),
      UserIdSchema.parse(actorId),
      PoolWriteSchema.parse(input),
    ),
  createDesk: (groupId, actorId, input) =>
    repository.createDesk(
      GroupIdSchema.parse(groupId),
      UserIdSchema.parse(actorId),
      DeskCreateSchema.parse(input),
    ),
  details: (groupId, poolId) =>
    repository.details(GroupIdSchema.parse(groupId), PoolIdSchema.parse(poolId)),
  remove: (groupId, actorId, ids) =>
    repository.remove(
      GroupIdSchema.parse(groupId),
      UserIdSchema.parse(actorId),
      ids.map((id) => PoolIdSchema.parse(id)),
    ),
  consume: (groupId, actorId, poolId, input) =>
    repository.consume(
      GroupIdSchema.parse(groupId),
      UserIdSchema.parse(actorId),
      PoolIdSchema.parse(poolId),
      PoolConsumeSchema.parse(input),
    ),
})
