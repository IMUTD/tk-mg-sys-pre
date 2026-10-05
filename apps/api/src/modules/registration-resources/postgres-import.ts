import type { AuditEventInput } from "../audit/service"
import {
  type QueryClient,
  type RegistrationResourceRow,
  resourceColumns,
  toPublicResource,
} from "./postgres-repository"
import type { RegistrationResource, StoredRegistrationResource } from "./repository"

const writeCandidate = async (
  client: QueryClient,
  candidate: StoredRegistrationResource,
): Promise<RegistrationResource | null> => {
  const rows = await client<RegistrationResourceRow[]>`
    insert into registration_resource (
      id, group_id, kind, identifier, encrypted_secret, fingerprint, metadata, note, tags, status,
      created_at, updated_at
    ) values (
      ${candidate.id}, ${candidate.groupId}, ${candidate.kind}, ${candidate.identifier},
      ${candidate.encryptedSecret}, ${candidate.fingerprint}, ${JSON.stringify(candidate.metadata)}::jsonb,
      ${candidate.note}, ${candidate.tags}, ${candidate.status}, ${candidate.createdAt}, ${candidate.updatedAt}
    )
    on conflict (group_id, fingerprint) do nothing
    returning ${resourceColumns(client)}
  `
  const row = rows[0]
  return row === undefined ? null : toPublicResource(row)
}

const appendAudit = async (client: QueryClient, event: AuditEventInput): Promise<void> => {
  await client`
    insert into audit_event (id, actor_id, action, outcome, target, metadata)
    values (
      ${crypto.randomUUID()}, ${event.actorId}, ${event.action}, ${event.outcome}, ${event.target},
      ${JSON.stringify(event.metadata ?? {})}::jsonb
    )
  `
}

export const confirmPostgresImport = async (
  client: import("postgres").Sql,
  candidates: readonly StoredRegistrationResource[],
  auditEvent: AuditEventInput,
): Promise<{ readonly created: readonly RegistrationResource[]; readonly duplicates: number }> => {
  const created = await client.begin(async (transaction) => {
    const inserted: RegistrationResource[] = []
    for (const candidate of candidates) {
      const resource = await writeCandidate(transaction, candidate)
      if (resource !== null) {
        inserted.push(resource)
      }
    }
    await appendAudit(transaction, auditEvent)
    return inserted
  })
  return { created, duplicates: candidates.length - created.length }
}

export const findExistingPostgresFingerprints = async (
  client: import("postgres").Sql,
  groupId: string,
  fingerprints: readonly string[],
): Promise<ReadonlySet<string>> => {
  if (fingerprints.length === 0) {
    return new Set()
  }
  const rows = await client<{ readonly fingerprint: string }[]>`
    select fingerprint from registration_resource
    where group_id = ${groupId} and fingerprint = any(${fingerprints})
  `
  return new Set(rows.map((row) => row.fingerprint))
}
