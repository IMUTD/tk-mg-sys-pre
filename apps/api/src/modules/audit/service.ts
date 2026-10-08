import type { Sql } from "postgres"

export const AuditOutcome = {
  Allowed: "allowed",
  Denied: "denied",
  Failed: "failed",
} as const

export type AuditOutcome = (typeof AuditOutcome)[keyof typeof AuditOutcome]

export type AuditEventInput = {
  readonly action: string
  readonly actorId: string
  readonly metadata?: Readonly<Record<string, string>>
  readonly outcome: AuditOutcome
  readonly target: string
}

export type AuditEvent = AuditEventInput & {
  readonly createdAt: Date
  readonly id: string
}

export type AuditFilter = {
  readonly allowedGroupIds?: readonly string[]
  readonly action?: string | undefined
  readonly actorId?: string | undefined
  readonly createdAfter?: Date | undefined
  readonly createdBefore?: Date | undefined
  readonly groupId?: string | undefined
  readonly page: number
  readonly pageSize: number
  readonly target?: string | undefined
}

export type AuditPage = {
  readonly items: readonly AuditEvent[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

export interface AuditRepository {
  append(input: AuditEventInput): Promise<AuditEvent>
}

export interface AuditExplorerRepository {
  list(filter: AuditFilter): Promise<AuditPage>
}

export const writeAuditEvent = async (
  repository: AuditRepository,
  input: AuditEventInput,
): Promise<AuditEvent> => repository.append(input)

const groupIdFromMetadata = (
  metadata: Readonly<Record<string, string>> | undefined,
): string | undefined => {
  const value = Object.getOwnPropertyDescriptor(metadata ?? {}, "groupId")?.value
  return typeof value === "string" ? value : undefined
}

export const createInMemoryAuditRepository = (): AuditRepository &
  AuditExplorerRepository & {
    readonly all: () => readonly AuditEvent[]
  } => {
  const events: AuditEvent[] = []

  return {
    all: () => events,
    append: async (input) => {
      const event: AuditEvent = {
        ...input,
        createdAt: new Date(),
        id: crypto.randomUUID(),
      }
      events.push(event)
      return event
    },
    list: async (filter) => {
      const filtered = events.filter((event) => {
        const eventGroupId = groupIdFromMetadata(event.metadata)
        return (
          (filter.action === undefined || event.action === filter.action) &&
          (filter.actorId === undefined || event.actorId === filter.actorId) &&
          (filter.createdAfter === undefined || event.createdAt >= filter.createdAfter) &&
          (filter.createdBefore === undefined || event.createdAt <= filter.createdBefore) &&
          (filter.groupId === undefined || eventGroupId === filter.groupId) &&
          (filter.allowedGroupIds === undefined ||
            (eventGroupId !== undefined && filter.allowedGroupIds.includes(eventGroupId))) &&
          (filter.target === undefined || event.target === filter.target)
        )
      })
      const offset = (filter.page - 1) * filter.pageSize
      return {
        items: filtered.slice(offset, offset + filter.pageSize),
        page: filter.page,
        pageSize: filter.pageSize,
        total: filtered.length,
      }
    },
  }
}

type AuditEventRow = {
  readonly action: string
  readonly actorId: string
  readonly createdAt: Date
  readonly id: string
  readonly outcome: AuditOutcome
  readonly target: string
  readonly metadata: Readonly<Record<string, string>>
}

type AuditCountRow = { readonly total: number }

const toAuditEvent = (row: AuditEventRow): AuditEvent => ({
  action: row.action,
  actorId: row.actorId,
  createdAt: row.createdAt,
  id: row.id,
  metadata: row.metadata,
  outcome: row.outcome,
  target: row.target,
})

export const createPostgresAuditRepository = (
  client: Sql,
): AuditRepository & AuditExplorerRepository => ({
  append: async (input) => {
    const rows = await client<AuditEventRow[]>`
      insert into audit_event (id, actor_id, action, outcome, target, metadata)
      values (
        ${crypto.randomUUID()},
        ${input.actorId},
        ${input.action},
        ${input.outcome},
        ${input.target},
        ${client.json(input.metadata ?? {})}
      )
      returning id, actor_id as "actorId", action, outcome, target, metadata, created_at as "createdAt"
    `
    const row = rows[0]
    if (row === undefined) {
      throw new AuditPersistenceError()
    }
    return toAuditEvent(row)
  },
  list: async (filter) => {
    const action = filter.action ?? null
    const actorId = filter.actorId ?? null
    const createdAfter = filter.createdAfter ?? null
    const createdBefore = filter.createdBefore ?? null
    const groupId = filter.groupId ?? null
    const target = filter.target ?? null
    const allowedGroups = filter.allowedGroupIds ?? []
    const scoped = filter.allowedGroupIds !== undefined
    const offset = (filter.page - 1) * filter.pageSize
    const rows = await client<AuditEventRow[]>`
      select id, actor_id as "actorId", action, outcome, target, metadata, created_at as "createdAt"
      from audit_event
      where (${action}::text is null or action = ${action})
        and (${actorId}::uuid is null or actor_id = ${actorId}::uuid)
        and (${createdAfter}::timestamptz is null or created_at >= ${createdAfter}::timestamptz)
        and (${createdBefore}::timestamptz is null or created_at <= ${createdBefore}::timestamptz)
        and (${groupId}::text is null or metadata ->> 'groupId' = ${groupId})
        and (${target}::text is null or target = ${target})
        and (not ${scoped} or metadata ->> 'groupId' = any(${allowedGroups}::text[]))
      order by created_at desc, id desc
      limit ${filter.pageSize}
      offset ${offset}
    `
    const counts = await client<AuditCountRow[]>`
      select count(*)::integer as total
      from audit_event
      where (${action}::text is null or action = ${action})
        and (${actorId}::uuid is null or actor_id = ${actorId}::uuid)
        and (${createdAfter}::timestamptz is null or created_at >= ${createdAfter}::timestamptz)
        and (${createdBefore}::timestamptz is null or created_at <= ${createdBefore}::timestamptz)
        and (${groupId}::text is null or metadata ->> 'groupId' = ${groupId})
        and (${target}::text is null or target = ${target})
        and (not ${scoped} or metadata ->> 'groupId' = any(${allowedGroups}::text[]))
    `
    return {
      items: rows.map(toAuditEvent),
      page: filter.page,
      pageSize: filter.pageSize,
      total: counts[0]?.total ?? 0,
    }
  },
})

class AuditPersistenceError extends Error {
  public constructor() {
    super("Audit event insert did not return a record")
    this.name = "AuditPersistenceError"
  }
}
