import { z } from "zod"

import type { GroupId } from "../../lib/authorization"
import type { AuditEventInput, AuditRepository } from "../audit/service"
import type { RegistrationResourceKind } from "./parser"

export const RegistrationResourceStatus = {
  Failed: "failed",
  Ready: "ready",
  Unverified: "unverified",
} as const

export type RegistrationResourceStatus =
  (typeof RegistrationResourceStatus)[keyof typeof RegistrationResourceStatus]

export const RegistrationResourceStatusSchema = z.enum([
  RegistrationResourceStatus.Unverified,
  RegistrationResourceStatus.Ready,
  RegistrationResourceStatus.Failed,
])

export const RegistrationResourceIdSchema = z.string().uuid().brand<"RegistrationResourceId">()

export type RegistrationResourceId = z.infer<typeof RegistrationResourceIdSchema>

export type RegistrationResource = {
  readonly createdAt: Date
  readonly groupId: GroupId
  readonly id: RegistrationResourceId
  readonly identifier: string
  readonly kind: RegistrationResourceKind
  readonly metadata: Readonly<Record<string, string>>
  readonly note: string
  readonly status: RegistrationResourceStatus
  readonly tags: readonly string[]
  readonly updatedAt: Date
}

export type StoredRegistrationResource = RegistrationResource & {
  readonly encryptedSecret: string
  readonly fingerprint: string
}

export type RegistrationResourceListFilter = {
  readonly groupId: GroupId
  readonly page: number
  readonly pageSize: number
  readonly query?: string
  readonly status?: RegistrationResourceStatus
  readonly tag?: string
}

export type RegistrationResourcePage = {
  readonly items: readonly RegistrationResource[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

export type RegistrationResourceTagStatistic = {
  readonly count: number
  readonly tag: string
}

export interface RegistrationResourceRepository {
  confirmImport(
    candidates: readonly StoredRegistrationResource[],
    auditEvent: AuditEventInput,
  ): Promise<{ readonly created: readonly RegistrationResource[]; readonly duplicates: number }>
  delete(groupId: GroupId, ids: readonly RegistrationResourceId[]): Promise<number>
  existingFingerprints(
    groupId: GroupId,
    fingerprints: readonly string[],
  ): Promise<ReadonlySet<string>>
  iterate(groupId: GroupId): AsyncIterable<RegistrationResource>
  list(filter: RegistrationResourceListFilter): Promise<RegistrationResourcePage>
  reset(groupId: GroupId, ids: readonly RegistrationResourceId[]): Promise<number>
  tagStatistics(groupId: GroupId): Promise<readonly RegistrationResourceTagStatistic[]>
}

export const matchesRegistrationResource = (
  resource: RegistrationResource,
  filter: RegistrationResourceListFilter,
): boolean => {
  const query = filter.query?.trim().toLowerCase()
  const matchingQuery =
    query === undefined ||
    query.length === 0 ||
    resource.identifier.toLowerCase().includes(query) ||
    resource.note.toLowerCase().includes(query) ||
    resource.tags.some((tag) => tag.toLowerCase().includes(query))
  const matchingStatus = filter.status === undefined || resource.status === filter.status
  const matchingTag = filter.tag === undefined || resource.tags.includes(filter.tag)
  return resource.groupId === filter.groupId && matchingQuery && matchingStatus && matchingTag
}

export const createInMemoryRegistrationResourceRepository = (
  auditRepository: AuditRepository,
): RegistrationResourceRepository & {
  readonly all: () => readonly StoredRegistrationResource[]
} => {
  let resources: readonly StoredRegistrationResource[] = []

  return {
    all: () => resources,
    confirmImport: async (candidates, auditEvent) => {
      const created: RegistrationResource[] = []
      let duplicates = 0
      let nextResources = resources
      for (const candidate of candidates) {
        const exists = nextResources.some(
          (resource) =>
            resource.groupId === candidate.groupId &&
            resource.fingerprint === candidate.fingerprint,
        )
        if (exists) {
          duplicates += 1
          continue
        }
        nextResources = [...nextResources, candidate]
        created.push(candidate)
      }
      await auditRepository.append(auditEvent)
      resources = nextResources
      return { created, duplicates }
    },
    delete: async (groupId, ids) => {
      const selected = new Set(ids)
      const previous = resources.length
      resources = resources.filter(
        (resource) => !(resource.groupId === groupId && selected.has(resource.id)),
      )
      return previous - resources.length
    },
    existingFingerprints: async (groupId, fingerprints) => {
      const requested = new Set(fingerprints)
      return new Set(
        resources
          .filter((resource) => resource.groupId === groupId && requested.has(resource.fingerprint))
          .map((resource) => resource.fingerprint),
      )
    },
    iterate: async function* (groupId) {
      for (const resource of resources) {
        if (resource.groupId === groupId) {
          yield resource
        }
      }
    },
    list: async (filter) => {
      const matching = resources.filter((resource) => matchesRegistrationResource(resource, filter))
      const offset = (filter.page - 1) * filter.pageSize
      return {
        items: matching.slice(offset, offset + filter.pageSize),
        page: filter.page,
        pageSize: filter.pageSize,
        total: matching.length,
      }
    },
    reset: async (groupId, ids) => {
      const selected = new Set(ids)
      let affected = 0
      resources = resources.map((resource) => {
        if (resource.groupId !== groupId || !selected.has(resource.id)) {
          return resource
        }
        affected += 1
        return { ...resource, status: RegistrationResourceStatus.Unverified, updatedAt: new Date() }
      })
      return affected
    },
    tagStatistics: async (groupId) => {
      const totals = new Map<string, number>()
      for (const resource of resources) {
        if (resource.groupId !== groupId) {
          continue
        }
        for (const tag of resource.tags) {
          totals.set(tag, (totals.get(tag) ?? 0) + 1)
        }
      }
      return [...totals.entries()]
        .map(([tag, count]) => ({ count, tag }))
        .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
    },
  }
}
