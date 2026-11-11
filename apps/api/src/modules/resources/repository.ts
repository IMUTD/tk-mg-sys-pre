import type { Sql } from "postgres"
import { z } from "zod"

import type { UserId } from "../../lib/authorization"
import {
  assertNoActiveResourceAllocations,
  assertNoActiveTaskClaims,
} from "../../lib/operation-claim-guard"
import { administratorFor, lockBusinessLabel } from "../business-labels"

import {
  type OperationResource,
  OperationResourceIdSchema,
  OperationResourceStatus,
  OperationResourceStatusSchema,
  type ResourceListFilter,
  type ResourceRepository,
} from "./resource-types"

export * from "./resource-types"

type ResourceRow = {
  readonly category: string
  readonly createdAt: Date
  readonly groupId: string
  readonly id: string
  readonly name: string
  readonly note: string
  readonly assignedCount?: number
  readonly lastAccount?: string
  readonly lastAssignedAt?: Date | null
  readonly status: string
  readonly tags: readonly string[]
  readonly updatedAt: Date
}

type AllocationRow = {
  readonly accountId: string
  readonly allocatedByUserId: string
  readonly createdAt: Date
  readonly id: string
  readonly releasedAt: Date | null
  readonly resourceId: string
}

const toResource = (row: ResourceRow): OperationResource => ({
  category: row.category,
  createdAt: row.createdAt,
  groupId: z.string().uuid().brand<"GroupId">().parse(row.groupId),
  id: OperationResourceIdSchema.parse(row.id),
  assignedCount: row.assignedCount ?? 0,
  lastAccount: row.lastAccount ?? "",
  lastAssignedAt: row.lastAssignedAt ?? null,
  name: row.name,
  note: row.note,
  status: OperationResourceStatusSchema.parse(row.status),
  tags: row.tags,
  updatedAt: row.updatedAt,
})

const resourceColumns = (client: Sql) => client`
  id, group_id as "groupId", name, category, note, tags, status,
  created_at as "createdAt", updated_at as "updatedAt"
`

const matching = (resource: OperationResource, filter: ResourceListFilter): boolean => {
  const normalizedQuery = filter.query?.toLocaleLowerCase("zh-CN")
  return (
    (normalizedQuery === undefined ||
      resource.name.toLocaleLowerCase("zh-CN").includes(normalizedQuery) ||
      resource.category.toLocaleLowerCase("zh-CN").includes(normalizedQuery)) &&
    (filter.status === undefined || resource.status === filter.status) &&
    (filter.tag === undefined || resource.tags.includes(filter.tag))
  )
}

export const createPostgresResourceRepository = (client: Sql): ResourceRepository => ({
  allocate: async (groupId, resourceId, accountId, actorId) =>
    client.begin(async (transaction) => {
      const account = await transaction<{ readonly id: string }[]>`
        select id from operation_account where id = ${accountId} and group_id = ${groupId} for key share
      `
      const resource = await transaction<{ readonly id: string }[]>`
        select id from operation_resource where id = ${resourceId} and group_id = ${groupId}
          and status = ${OperationResourceStatus.Available} for update
      `
      if (account[0] === undefined || resource[0] === undefined) {
        return null
      }
      const existing = await transaction<{ readonly id: string }[]>`
        select id from operation_resource_allocation where resource_id = ${resourceId} and released_at is null for update
      `
      if (existing[0] !== undefined) {
        return null
      }
      const rows = await transaction<AllocationRow[]>`
        insert into operation_resource_allocation (resource_id, account_id, group_id, allocated_by_user_id)
        values (${resourceId}, ${accountId}, ${groupId}, ${actorId})
        returning id, resource_id as "resourceId", account_id as "accountId",
          allocated_by_user_id as "allocatedByUserId", created_at as "createdAt", released_at as "releasedAt"
      `
      await transaction`
        update operation_resource set status = ${OperationResourceStatus.Allocated}, updated_at = now()
        where id = ${resourceId}
      `
      const row = rows[0]
      return row === undefined
        ? null
        : { ...row, resourceId: OperationResourceIdSchema.parse(row.resourceId) }
    }),
  create: async (input) => {
    if (input.status === OperationResourceStatus.Allocated) throw new ResourceStatusConflictError()
    const rows = await client<ResourceRow[]>`
      insert into operation_resource (group_id, name, category, note, tags, status)
      values (${input.groupId}, ${input.name}, ${input.category}, ${input.note}, ${input.tags}, ${input.status})
      returning ${resourceColumns(client)}
    `
    const row = rows[0]
    if (row === undefined) {
      throw new ResourcePersistenceError()
    }
    return toResource(row)
  },
  assignTags: async (groupId, ids, tags, actorId: UserId) => {
    if (ids.length === 0) return 0
    const incoming = [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))]
    return client.begin(async (transaction) => {
      if (incoming.length === 0) {
        const rows = await transaction<{ readonly id: string }[]>`
          update operation_resource set tags = '{}'::text[], category = '', updated_at = now()
          where group_id = ${groupId} and id = any(${ids})
          returning id
        `
        return rows.length
      }
      const administratorId = await administratorFor(transaction, actorId)
      if (administratorId !== null) {
        for (const name of incoming) {
          await lockBusinessLabel(transaction, administratorId, "resource", "group", name)
          await transaction`
            insert into business_label (administrator_id, scope, kind, name)
            values (${administratorId}::uuid, 'resource', 'group', ${name})
            on conflict (administrator_id, scope, kind, name) do nothing
          `
        }
      }
      const current = await transaction<
        { readonly id: string; readonly tags: readonly string[] }[]
      >`
        select id, tags from operation_resource
        where group_id = ${groupId} and id = any(${ids})
        for update
      `
      let affected = 0
      for (const row of current) {
        const seen = new Set<string>()
        const merged: string[] = []
        for (const raw of [...row.tags, ...incoming]) {
          const name = raw.trim()
          if (name.length === 0 || seen.has(name)) continue
          seen.add(name)
          merged.push(name)
        }
        if (merged.length > 20) throw new ResourceTagLimitError()
        await transaction`
          update operation_resource set tags = ${merged}, updated_at = now()
          where id = ${row.id}
        `
        affected += 1
      }
      return affected
    })
  },
  delete: async (groupId, ids) => {
    if (ids.length === 0) return 0
    return client.begin(async (transaction) => {
      const locked = await transaction<{ readonly id: string }[]>`
        select id from operation_resource where group_id = ${groupId} and id = any(${ids}) for update
      `
      const entityIds = locked.map((row) => row.id)
      await assertNoActiveTaskClaims(transaction, groupId, "resource", entityIds)
      await assertNoActiveResourceAllocations(transaction, groupId, entityIds)
      const rows = await transaction<{ readonly id: string }[]>`
        delete from operation_resource where group_id = ${groupId} and id = any(${entityIds}) returning id
      `
      return rows.length
    })
  },
  deleteScope: async (groupId, tag) => {
    const rows = await client<{ readonly id: string }[]>`
      select id from operation_resource
      where group_id = ${groupId}
        and (${tag}::text is null or category = ${tag} or ${tag} = any(tags))
    `
    const ids = rows.flatMap((row) => {
      const parsed = OperationResourceIdSchema.safeParse(row.id)
      return parsed.success ? [parsed.data] : []
    })
    if (ids.length === 0) return 0
    return client.begin(async (transaction) => {
      const locked = await transaction<{ readonly id: string }[]>`
        select id from operation_resource where group_id = ${groupId} and id = any(${ids}) for update
      `
      const entityIds = locked.map((row) => row.id)
      await assertNoActiveTaskClaims(transaction, groupId, "resource", entityIds)
      await assertNoActiveResourceAllocations(transaction, groupId, entityIds)
      const removed = await transaction<{ readonly id: string }[]>`
        delete from operation_resource where group_id = ${groupId} and id = any(${entityIds}) returning id
      `
      return removed.length
    })
  },
  importTexts: async (input) =>
    client.begin(async (transaction) => {
      const created: OperationResource[] = []
      for (const content of input.contents) {
        const rows = await transaction<ResourceRow[]>`
          insert into operation_resource (group_id, name, category, note, tags, status)
          values (
            ${input.groupId}, ${content}, ${input.tag}, '', ${[input.tag]}, ${OperationResourceStatus.Available}
          )
          returning ${resourceColumns(client)}
        `
        const row = rows[0]
        if (row !== undefined) created.push(toResource(row))
      }
      return created
    }),
  find: async (groupId, resourceId) => {
    const rows = await client<ResourceRow[]>`
      select ${resourceColumns(client)} from operation_resource where group_id = ${groupId} and id = ${resourceId}
    `
    const row = rows[0]
    return row === undefined ? null : toResource(row)
  },
  history: async (groupId, resourceId) => {
    const rows = await client<AllocationRow[]>`
      select id, resource_id as "resourceId", account_id as "accountId", allocated_by_user_id as "allocatedByUserId",
        created_at as "createdAt", released_at as "releasedAt"
      from operation_resource_allocation where group_id = ${groupId} and resource_id = ${resourceId}
      order by created_at desc, id desc
    `
    return rows.map((row) => ({
      ...row,
      resourceId: OperationResourceIdSchema.parse(row.resourceId),
    }))
  },
  list: async (filter) => {
    const rows = await client<ResourceRow[]>`
      select operation_resource.id, operation_resource.group_id as "groupId", operation_resource.name,
        operation_resource.category, operation_resource.note, operation_resource.tags,
        operation_resource.status, operation_resource.created_at as "createdAt",
        operation_resource.updated_at as "updatedAt",
        coalesce(account.identifier, '') as "lastAccount",
        coalesce((
          select count(*)::int from operation_resource_allocation allocation
          where allocation.resource_id = operation_resource.id
        ), 0) as "assignedCount",
        (
          select max(allocation.created_at) from operation_resource_allocation allocation
          where allocation.resource_id = operation_resource.id
        ) as "lastAssignedAt"
      from operation_resource
      left join operation_account account
        on account.id = operation_resource.last_account_id and account.deleted = false
      where operation_resource.group_id = ${filter.groupId}
      order by operation_resource.created_at desc, operation_resource.id desc
    `
    const all = rows.map(toResource).filter((resource) => matching(resource, filter))
    const offset = (filter.page - 1) * filter.pageSize
    return {
      items: all.slice(offset, offset + filter.pageSize),
      page: filter.page,
      pageSize: filter.pageSize,
      total: all.length,
    }
  },
  release: async (groupId, resourceId) =>
    client.begin(async (transaction) => {
      const rows = await transaction<{ readonly id: string }[]>`
        update operation_resource_allocation set released_at = now()
        where group_id = ${groupId} and resource_id = ${resourceId} and released_at is null returning id
      `
      if (rows.length !== 1) return false
      await transaction`
        update operation_resource set status = ${OperationResourceStatus.Available}, updated_at = now()
        where group_id = ${groupId} and id = ${resourceId}
      `
      return true
    }),
  update: async (groupId, resourceId, input) =>
    client.begin(async (transaction) => {
      const currentRows = await transaction<ResourceRow[]>`
        select ${resourceColumns(client)} from operation_resource
        where group_id = ${groupId} and id = ${resourceId} for update
      `
      const current = currentRows[0]
      if (current === undefined) return null
      const activeAllocation = await transaction<{ readonly id: string }[]>`
        select id from operation_resource_allocation
        where resource_id = ${resourceId} and released_at is null for key share
      `
      if (
        input.status === OperationResourceStatus.Allocated ||
        (activeAllocation[0] !== undefined && input.status !== undefined)
      )
        throw new ResourceStatusConflictError()
      const stored = toResource(current)
      const next = {
        category: input.category ?? stored.category,
        name: input.name ?? stored.name,
        note: input.note ?? stored.note,
        status: input.status ?? stored.status,
        tags: input.tags ?? stored.tags,
      }
      const rows = await transaction<ResourceRow[]>`
        update operation_resource set name = ${next.name}, category = ${next.category}, note = ${next.note},
          tags = ${next.tags}, status = ${next.status}, updated_at = now()
        where group_id = ${groupId} and id = ${resourceId} returning ${resourceColumns(client)}
      `
      const row = rows[0]
      return row === undefined ? null : toResource(row)
    }),
})

export class ResourceTagLimitError extends Error {
  public constructor() {
    super("A text row cannot carry more than 20 tags")
    this.name = "ResourceTagLimitError"
  }
}

export class ResourceStatusConflictError extends Error {
  public constructor() {
    super("Resource status is controlled by allocation lifecycle")
    this.name = "ResourceStatusConflictError"
  }
}

class ResourcePersistenceError extends Error {
  public constructor() {
    super("Operation resource insert did not return a record")
    this.name = "ResourcePersistenceError"
  }
}
