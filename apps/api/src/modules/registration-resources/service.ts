import { createHash } from "node:crypto"

import { type GroupId, GroupIdSchema } from "../../lib/authorization"
import type { SecretCipher } from "../../lib/crypto"
import type { AuditEventInput, AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import {
  type InvalidRegistrationRow,
  type ParsedRegistrationRow,
  parseRegistrationRows,
  type RegistrationResourceKind,
} from "./parser"
import {
  type RegistrationResource,
  type RegistrationResourceId,
  RegistrationResourceIdSchema,
  type RegistrationResourceListFilter,
  type RegistrationResourcePage,
  type RegistrationResourceRepository,
  RegistrationResourceStatus,
  type RegistrationResourceTagStatistic,
  type StoredRegistrationResource,
} from "./repository"

export type ImportRegistrationResourcesInput = {
  readonly actorId: string
  readonly content: string
  readonly groupId: string
  readonly note: string
  readonly tags: readonly string[]
}

export type RegistrationResourceImportResult = {
  readonly created: readonly RegistrationResource[]
  readonly duplicates: number
}

export type RegistrationResourcePreview = {
  readonly duplicates: number
  readonly invalid: readonly { readonly line: number; readonly reason: string }[]
  readonly valid: readonly {
    readonly identifier: string
    readonly kind: RegistrationResourceKind
    readonly line: number
    readonly metadata: Readonly<Record<string, string>>
    readonly state: "duplicate" | "import"
  }[]
}

export type RegistrationResourceBatchInput = {
  readonly actorId: string
  readonly groupId: string
  readonly ids: readonly string[]
}

export type RegistrationResourceService = {
  confirmImport(input: ImportRegistrationResourcesInput): Promise<RegistrationResourceImportResult>
  delete(input: RegistrationResourceBatchInput): Promise<{ readonly affected: number }>
  exportMasked(groupId: string): AsyncIterable<string>
  list(
    filter: Omit<RegistrationResourceListFilter, "groupId"> & { readonly groupId: string },
  ): Promise<RegistrationResourcePage>
  preview(input: {
    readonly content: string
    readonly groupId: string
  }): Promise<RegistrationResourcePreview>
  reset(input: RegistrationResourceBatchInput): Promise<{ readonly affected: number }>
  tagStatistics(groupId: string): Promise<readonly RegistrationResourceTagStatistic[]>
}

type RegistrationResourceServiceDependencies = {
  readonly auditRepository: AuditRepository
  readonly cipher: SecretCipher
  readonly repository: RegistrationResourceRepository
}

const fingerprint = (row: ParsedRegistrationRow): string =>
  createHash("sha256")
    .update(`${row.kind}\u0000${row.identifier}\u0000${JSON.stringify(row.metadata)}`)
    .digest("hex")

const createCandidate = (
  row: ParsedRegistrationRow,
  groupId: GroupId,
  note: string,
  tags: readonly string[],
  cipher: SecretCipher,
): StoredRegistrationResource => {
  const now = new Date()
  return {
    createdAt: now,
    encryptedSecret: cipher.encrypt(row.secret),
    fingerprint: fingerprint(row),
    groupId,
    id: RegistrationResourceIdSchema.parse(crypto.randomUUID()),
    identifier: row.identifier,
    kind: row.kind,
    metadata: row.metadata,
    note,
    status: RegistrationResourceStatus.Unverified,
    tags,
    updatedAt: now,
  }
}

const parseIds = (ids: readonly string[]): readonly RegistrationResourceId[] =>
  ids.map((id) => RegistrationResourceIdSchema.parse(id))

const redactInvalidRow = (
  row: InvalidRegistrationRow,
): { readonly line: number; readonly reason: string } => ({
  line: row.line,
  reason: row.reason,
})

const redactedPreview = async (
  repository: RegistrationResourceRepository,
  groupId: GroupId,
  content: string,
): Promise<RegistrationResourcePreview> => {
  const parsed = parseRegistrationRows(content)
  const fingerprints = parsed.valid.map(fingerprint)
  const existing = await repository.existingFingerprints(groupId, fingerprints)
  const persistedDuplicates = parsed.valid.filter((row) => existing.has(fingerprint(row))).length
  const inlineDuplicates = parsed.invalid.filter(
    (row) => row.reason === "duplicate resource",
  ).length
  return {
    duplicates: persistedDuplicates + inlineDuplicates,
    invalid: parsed.invalid.map(redactInvalidRow),
    valid: parsed.valid.map((row) => ({
      identifier: row.identifier,
      kind: row.kind,
      line: row.line,
      metadata: row.metadata,
      state: existing.has(fingerprint(row)) ? "duplicate" : "import",
    })),
  }
}

const maskIdentifier = (identifier: string): string => {
  const at = identifier.indexOf("@")
  if (at <= 1) {
    return "***"
  }
  return `${identifier.slice(0, 1)}***${identifier.slice(at)}`
}

const csvValue = (value: string): string => `"${value.replaceAll('"', '""')}"`

const pageLimit = 10_000

const normalizeListFilter = (
  filter: Omit<RegistrationResourceListFilter, "groupId"> & { readonly groupId: string },
): RegistrationResourceListFilter => ({
  ...filter,
  groupId: GroupIdSchema.parse(filter.groupId),
  page: Math.max(1, filter.page),
  pageSize: Math.min(Math.max(1, filter.pageSize), pageLimit),
})

const auditEvent = (
  actorId: string,
  action: string,
  groupId: GroupId,
  metadata: Readonly<Record<string, string>>,
): AuditEventInput => ({
  action,
  actorId,
  metadata,
  outcome: "allowed",
  target: `group:${groupId}`,
})

const audit = async (
  repository: AuditRepository,
  actorId: string,
  action: string,
  groupId: GroupId,
  metadata: Readonly<Record<string, string>>,
): Promise<void> => {
  await writeAuditEvent(repository, auditEvent(actorId, action, groupId, metadata))
}

export const createRegistrationResourceService = (
  dependencies: RegistrationResourceServiceDependencies,
): RegistrationResourceService => ({
  confirmImport: async (input) => {
    const groupId = GroupIdSchema.parse(input.groupId)
    const parsed = parseRegistrationRows(input.content)
    const candidates = parsed.valid.map((row) =>
      createCandidate(row, groupId, input.note, input.tags, dependencies.cipher),
    )
    const result = await dependencies.repository.confirmImport(
      candidates,
      auditEvent(input.actorId, "registration-resource.import", groupId, {
        invalid: `${parsed.invalid.length}`,
        requested: `${candidates.length}`,
      }),
    )
    return result
  },
  delete: async (input) => {
    const groupId = GroupIdSchema.parse(input.groupId)
    const affected = await dependencies.repository.delete(groupId, parseIds(input.ids))
    await audit(
      dependencies.auditRepository,
      input.actorId,
      "registration-resource.delete",
      groupId,
      {
        affected: `${affected}`,
      },
    )
    return { affected }
  },
  exportMasked: async function* (groupId) {
    const parsedGroupId = GroupIdSchema.parse(groupId)
    yield "id,identifier,kind,status,tags,note\n"
    for await (const resource of dependencies.repository.iterate(parsedGroupId)) {
      yield [
        resource.id,
        maskIdentifier(resource.identifier),
        resource.kind,
        resource.status,
        resource.tags.join("|"),
        resource.note,
      ]
        .map(csvValue)
        .join(",")
      yield "\n"
    }
  },
  list: async (filter) => dependencies.repository.list(normalizeListFilter(filter)),
  preview: async (input) =>
    redactedPreview(dependencies.repository, GroupIdSchema.parse(input.groupId), input.content),
  reset: async (input) => {
    const groupId = GroupIdSchema.parse(input.groupId)
    const affected = await dependencies.repository.reset(groupId, parseIds(input.ids))
    await audit(
      dependencies.auditRepository,
      input.actorId,
      "registration-resource.reset",
      groupId,
      {
        affected: `${affected}`,
      },
    )
    return { affected }
  },
  tagStatistics: async (groupId) =>
    dependencies.repository.tagStatistics(GroupIdSchema.parse(groupId)),
})
