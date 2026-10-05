import { describe, expect, it } from "bun:test"
import { GroupIdSchema } from "../../lib/authorization"
import { ProxyIdSchema, type ProxyRepository, type StoredProxy } from "./repository"
import { createProxyService } from "./service"

describe("proxy service", () => {
  it("masks encrypted credentials from list records", async () => {
    // Given
    const repository: ProxyRepository = {
      create: async (input): Promise<StoredProxy> => ({
        ...input,
        createdAt: new Date("2026-09-12T00:00:00.000Z"),
        credentialState: "configured",
        id: ProxyIdSchema.parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        updatedAt: new Date("2026-09-12T00:00:00.000Z"),
      }),
      delete: async () => 0,
      list: async () => ({
        items: [
          {
            createdAt: new Date("2026-09-12T00:00:00.000Z"),
            credentialState: "configured",
            endpoint: "10.0.0.5:8080",
            groupId: GroupIdSchema.parse("11111111-1111-4111-8111-111111111111"),
            id: ProxyIdSchema.parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
            name: "深圳代理",
            note: "",
            status: "ready",
            tags: [],
            updatedAt: new Date("2026-09-12T00:00:00.000Z"),
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      }),
      update: async () => null,
    }
    const service = createProxyService({
      cipher: {
        decrypt: () => "user:secret",
        encrypt: (value: string) => `cipher:${value}`,
      },
      repository,
    })

    // When
    const page = await service.list({
      groupId: "11111111-1111-4111-8111-111111111111",
      page: 1,
      pageSize: 20,
    })

    // Then
    expect(JSON.stringify(page)).not.toContain("secret")
    expect(page.items[0]).toEqual(expect.objectContaining({ credentialState: "configured" }))
  })
})
