import { describe, expect, it } from "bun:test"

import { GroupIdSchema } from "../../lib/authorization"
import { createSecretCipher } from "../../lib/crypto"
import { createInMemoryAuditRepository } from "../audit/service"
import {
  createInMemoryRegistrationResourceRepository,
  RegistrationResourceIdSchema,
  type RegistrationResourceRepository,
} from "./repository"
import { createRegistrationResourceService } from "./service"

const groupId = "11111111-1111-4111-8111-111111111111"
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const cipher = createSecretCipher("12345678901234567890123456789012")

describe("registration resource service", () => {
  it("returns a redacted preview without serializing the imported credential", async () => {
    // Given
    const auditRepository = createInMemoryAuditRepository()
    const service = createRegistrationResourceService({
      auditRepository,
      cipher,
      repository: createInMemoryRegistrationResourceRepository(auditRepository),
    })

    // When
    const preview = await service.preview({
      content: "person@gmail.com----plain-password",
      groupId,
    })

    // Then
    expect(JSON.stringify(preview)).not.toContain("plain-password")
  })

  it("encrypts credential fields and records a confirmed import audit event", async () => {
    // Given
    const auditRepository = createInMemoryAuditRepository()
    const repository = createInMemoryRegistrationResourceRepository(auditRepository)
    const service = createRegistrationResourceService({ auditRepository, cipher, repository })

    // When
    const result = await service.confirmImport({
      actorId,
      content: "person@gmail.com----plain-password",
      groupId,
      note: "first batch",
      tags: ["gmail", "new"],
    })

    // Then
    expect(result.created).toHaveLength(1)
    expect(repository.all()[0]?.encryptedSecret).not.toContain("plain-password")
    expect(auditRepository.all()).toContainEqual(
      expect.objectContaining({ action: "registration-resource.import", outcome: "allowed" }),
    )
  })

  it("does not create an already persisted resource when an import is confirmed twice", async () => {
    // Given
    const auditRepository = createInMemoryAuditRepository()
    const repository = createInMemoryRegistrationResourceRepository(auditRepository)
    const service = createRegistrationResourceService({
      auditRepository,
      cipher,
      repository,
    })
    const input = {
      actorId,
      content: "person@gmail.com----plain-password",
      groupId,
      note: "",
      tags: [],
    }
    await service.confirmImport(input)

    // When
    const repeated = await service.confirmImport(input)

    // Then
    expect(repeated.created).toHaveLength(0)
    expect(repeated.duplicates).toBe(1)
    expect(repository.all()).toHaveLength(1)
  })

  it("marks resources that already exist in persisted storage before import confirmation", async () => {
    // Given
    const auditRepository = createInMemoryAuditRepository()
    const repository = createInMemoryRegistrationResourceRepository(auditRepository)
    const service = createRegistrationResourceService({ auditRepository, cipher, repository })
    const content = "person@gmail.com----plain-password"
    await service.confirmImport({ actorId, content, groupId, note: "", tags: [] })

    // When
    const preview = await service.preview({ content, groupId })

    // Then
    expect(preview.duplicates).toBe(1)
    expect(preview.valid).toEqual([expect.objectContaining({ state: "duplicate" })])
  })

  it("exports every authorized resource without a fixed page-size cutoff", async () => {
    // Given
    const auditRepository = createInMemoryAuditRepository()
    const repository: RegistrationResourceRepository = {
      confirmImport: async () => ({ created: [], duplicates: 0 }),
      delete: async () => 0,
      existingFingerprints: async () => new Set(),
      iterate: async function* () {
        for (let index = 0; index <= 10_000; index += 1) {
          yield {
            createdAt: new Date(0),
            groupId: GroupIdSchema.parse(groupId),
            id: RegistrationResourceIdSchema.parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
            identifier: `person-${index}@gmail.com`,
            kind: "google-email",
            metadata: {},
            note: "",
            status: "unverified",
            tags: [],
            updatedAt: new Date(0),
          }
        }
      },
      list: async () => ({ items: [], page: 1, pageSize: 1, total: 0 }),
      reset: async () => 0,
      tagStatistics: async () => [],
    }
    const service = createRegistrationResourceService({ auditRepository, cipher, repository })

    // When
    let csv = ""
    for await (const chunk of service.exportMasked(groupId)) {
      csv += chunk
    }

    // Then
    expect(csv.trim().split("\n")).toHaveLength(10_002)
  })

  it("resets and deletes only selected resources within the group", async () => {
    // Given
    const auditRepository = createInMemoryAuditRepository()
    const repository = createInMemoryRegistrationResourceRepository(auditRepository)
    const service = createRegistrationResourceService({
      auditRepository,
      cipher,
      repository,
    })
    const imported = await service.confirmImport({
      actorId,
      content: "first@gmail.com----one\nsecond@gmail.com----two",
      groupId,
      note: "",
      tags: [],
    })
    const firstId = imported.created[0]?.id
    const secondId = imported.created[1]?.id
    if (firstId === undefined || secondId === undefined) {
      throw new Error("test setup did not create resources")
    }

    // When
    const reset = await service.reset({ actorId, groupId, ids: [firstId] })
    const deleted = await service.delete({ actorId, groupId, ids: [secondId] })

    // Then
    expect(reset.affected).toBe(1)
    expect(deleted.affected).toBe(1)
    expect(repository.all()).toHaveLength(1)
  })
})
