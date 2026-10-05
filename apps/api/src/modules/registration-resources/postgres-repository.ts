import type { Sql, TransactionSql } from "postgres"
import { z } from "zod"

import { GroupIdSchema } from "../../lib/authorization"
import { RegistrationResourceKindSchema } from "./parser"
import { confirmPostgresImport, findExistingPostgresFingerprints } from "./postgres-import"
import {
  matchesRegistrationResource,
  type RegistrationResource,
  type RegistrationResourceId,
  RegistrationResourceIdSchema,
  type RegistrationResourcePage,
  type RegistrationResourceRepository,
  RegistrationResourceStatus,
  RegistrationResourceStatusSchema,
  type RegistrationResourceTagStatistic,
  type StoredRegistrationResource,
} from "./repository"

export type RegistrationResourceRow = {
  readonly createdAt: Date
  readonly encryptedSecret: string
  readonly fingerprint: string
  readonly groupId: string
  readonly id: string
  readonly identifier: string
  readonly kind: string
  readonly metadata: unknown
  readonly note: string
  readonly status: string
  readonly tags: unknown
  readonly updatedAt: Date
}

const MetadataSchema = z.record(z.string(), z.string())
const TagsSchema = z.array(z.string())

const parseMetadata = (metadata: unknown): Readonly<Record<string, string>> => {
  if (typeof metadata === "string") {
    return MetadataSchema.parse(JSON.parse(metadata))
  }
  return MetadataSchema.parse(metadata)
}

export type QueryClient = Sql | TransactionSql

export const resourceColumns = (client: QueryClient) => client`
  id,
  group_id as "groupId",
  kind,
  identifier,
  encrypted_secret as "encryptedSecret",
  fingerprint,
  metadata,
  note,
  tags,
  status,
  created_at as "createdAt",
  updated_at as "updatedAt"
`

const toStoredResource = (row: RegistrationResourceRow): StoredRegistrationResource => ({
  createdAt: row.createdAt,
  encryptedSecret: row.encryptedSecret,
  fingerprint: row.fingerprint,
  groupId: GroupIdSchema.parse(row.groupId),
  id: RegistrationResourceIdSchema.parse(row.id),
  identifier: row.identifier,
  kind: RegistrationResourceKindSchema.parse(row.kind),
  metadata: parseMetadata(row.metadata),
  note: row.note,
  status: RegistrationResourceStatusSchema.parse(row.status),
  tags: TagsSchema.parse(row.tags),
  updatedAt: row.updatedAt,
})

export const toPublicResource = (row: RegistrationResourceRow): RegistrationResource => {
  const stored = toStoredResource(row)
  return {
    createdAt: stored.createdAt,
    groupId: stored.groupId,
    id: stored.id,
    identifier: stored.identifier,
    kind: stored.kind,
    metadata: stored.metadata,
    note: stored.note,
    status: stored.status,
    tags: stored.tags,
    updatedAt: stored.updatedAt,
  }
}

const selectedRows = async (
  client: QueryClient,
  groupId: string,
): Promise<readonly RegistrationResource[]> => {
  const rows = await client<RegistrationResourceRow[]>`
    select ${resourceColumns(client)}
    from registration_resource
    where group_id = ${groupId}
    order by created_at desc, id desc
  `
  return rows.map(toPublicResource)
}

const updateStatus = async (
  client: QueryClient,
  groupId: string,
  ids: readonly RegistrationResourceId[],
): Promise<number> => {
  if (ids.length === 0) {
    return 0
  }
  const rows = await client<{ readonly id: string }[]>`
    update registration_resource
    set status = ${RegistrationResourceStatus.Unverified}, updated_at = now()
    where group_id = ${groupId} and id = any(${ids})
    returning id
  `
  return rows.length
}

const removeRows = async (
  client: QueryClient,
  groupId: string,
  ids: readonly RegistrationResourceId[],
): Promise<number> => {
  if (ids.length === 0) {
    return 0
  }
  const rows = await client<{ readonly id: string }[]>`
    delete from registration_resource
    where group_id = ${groupId} and id = any(${ids})
    returning id
  `
  return rows.length
}

export const createPostgresRegistrationResourceRepository = (
  client: Sql,
): RegistrationResourceRepository => ({
  confirmImport: async (candidates, auditEvent) =>
    confirmPostgresImport(client, candidates, auditEvent),
  delete: async (groupId, ids) => removeRows(client, groupId, ids),
  existingFingerprints: async (groupId, fingerprints) =>
    findExistingPostgresFingerprints(client, groupId, fingerprints),
  iterate: async function* (groupId) {
    const cursor = client<RegistrationResourceRow[]>`
      select ${resourceColumns(client)}
      from registration_resource
      where group_id = ${groupId}
      order by created_at asc, id asc
    `.cursor(500)
    for await (const rows of cursor) {
      for (const row of rows) {
        yield toPublicResource(row)
      }
    }
  },
  list: async (filter): Promise<RegistrationResourcePage> => {
    const resources = await selectedRows(client, filter.groupId)
    const matching = resources.filter((resource) => matchesRegistrationResource(resource, filter))
    const offset = (filter.page - 1) * filter.pageSize
    return {
      items: matching.slice(offset, offset + filter.pageSize),
      page: filter.page,
      pageSize: filter.pageSize,
      total: matching.length,
    }
  },
  reset: async (groupId, ids) => updateStatus(client, groupId, ids),
  tagStatistics: async (groupId): Promise<readonly RegistrationResourceTagStatistic[]> => {
    const rows = await client<{ readonly count: number; readonly tag: string }[]>`
      select tag, count(*)::int as count
      from registration_resource, unnest(tags) as tag
      where group_id = ${groupId}
      group by tag
      order by count(*) desc, tag asc
    `
    return rows
  },
})
