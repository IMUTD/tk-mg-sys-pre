import ky from "ky"
import { z } from "zod"

import { resolveApiBaseUrl } from "../../lib/api/auth-api"

const RegistrationResourceKindSchema = z.enum([
  "google-email",
  "api-sms",
  "microsoft-oauth",
  "pop3",
])

const RegistrationResourceStatusSchema = z.enum(["unverified", "ready", "failed"])

const PreviewSchema = z.object({
  duplicates: z.number().int(),
  invalid: z.array(z.object({ line: z.number().int(), reason: z.string() })),
  valid: z.array(
    z.object({
      identifier: z.string(),
      kind: RegistrationResourceKindSchema,
      line: z.number().int(),
      metadata: z.record(z.string(), z.string()),
      state: z.enum(["duplicate", "import"]),
    }),
  ),
})

const ResourceSchema = z.object({
  createdAt: z.coerce.date(),
  groupId: z.string().uuid(),
  id: z.string().uuid(),
  identifier: z.string(),
  kind: RegistrationResourceKindSchema,
  metadata: z.record(z.string(), z.string()),
  note: z.string(),
  status: RegistrationResourceStatusSchema,
  tags: z.array(z.string()),
  updatedAt: z.coerce.date(),
})

const ResourcePageSchema = z.object({
  items: z.array(ResourceSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
})

const ImportResultSchema = z.object({
  created: z.array(ResourceSchema),
  duplicates: z.number().int(),
})

const BatchResultSchema = z.object({ affected: z.number().int() })
const StatisticsSchema = z.object({
  tags: z.array(z.object({ count: z.number().int(), tag: z.string() })),
})

export type RegistrationResource = z.infer<typeof ResourceSchema>
export type RegistrationResourceKind = z.infer<typeof RegistrationResourceKindSchema>
export type RegistrationResourceStatus = z.infer<typeof RegistrationResourceStatusSchema>
export type RegistrationResourcePreview = z.infer<typeof PreviewSchema>
export type RegistrationResourcePage = z.infer<typeof ResourcePageSchema>
export type RegistrationResourceTagStatistic = z.infer<typeof StatisticsSchema>["tags"][number]

export type RegistrationResourceImportInput = {
  readonly content: string
  readonly groupId: string
  readonly note: string
  readonly tags: readonly string[]
}

export type RegistrationResourceListInput = {
  readonly groupId: string
  readonly page: number
  readonly pageSize: number
  readonly query?: string
  readonly status?: RegistrationResourceStatus
  readonly tag?: string
}

export interface RegistrationResourcesApi {
  delete(input: {
    readonly groupId: string
    readonly ids: readonly string[]
  }): Promise<{ readonly affected: number }>
  exportMasked(groupId: string): Promise<string>
  import(input: RegistrationResourceImportInput): Promise<z.infer<typeof ImportResultSchema>>
  list(input: RegistrationResourceListInput): Promise<RegistrationResourcePage>
  preview(input: {
    readonly content: string
    readonly groupId: string
  }): Promise<RegistrationResourcePreview>
  reset(input: {
    readonly groupId: string
    readonly ids: readonly string[]
  }): Promise<{ readonly affected: number }>
  tagStatistics(groupId: string): Promise<readonly RegistrationResourceTagStatistic[]>
}

const groupPath = (groupId: string): string =>
  `groups/${encodeURIComponent(groupId)}/registration-resources`

export const createRegistrationResourcesApi = (apiBaseUrl = "/api"): RegistrationResourcesApi => {
  const client = ky.create({
    credentials: "include",
    prefixUrl: resolveApiBaseUrl(apiBaseUrl, window.location.href),
    retry: 0,
    timeout: 7_000,
  })

  return {
    delete: async (input) =>
      BatchResultSchema.parse(
        await client
          .post(`${groupPath(input.groupId)}/batch/delete`, { json: { ids: input.ids } })
          .json(),
      ),
    exportMasked: async (groupId) => client.get(`${groupPath(groupId)}/export`).text(),
    import: async (input) =>
      ImportResultSchema.parse(
        await client
          .post(`${groupPath(input.groupId)}/imports`, {
            json: { content: input.content, note: input.note, tags: input.tags },
          })
          .json(),
      ),
    list: async (input) => {
      const searchParams = new URLSearchParams({
        page: `${input.page}`,
        pageSize: `${input.pageSize}`,
      })
      if (input.query !== undefined && input.query.length > 0) {
        searchParams.set("query", input.query)
      }
      if (input.status !== undefined) {
        searchParams.set("status", input.status)
      }
      if (input.tag !== undefined && input.tag.length > 0) {
        searchParams.set("tag", input.tag)
      }
      return ResourcePageSchema.parse(
        await client.get(groupPath(input.groupId), { searchParams }).json(),
      )
    },
    preview: async (input) =>
      PreviewSchema.parse(
        await client
          .post(`${groupPath(input.groupId)}/import/preview`, { json: { content: input.content } })
          .json(),
      ),
    reset: async (input) =>
      BatchResultSchema.parse(
        await client
          .post(`${groupPath(input.groupId)}/batch/reset`, { json: { ids: input.ids } })
          .json(),
      ),
    tagStatistics: async (groupId) =>
      StatisticsSchema.parse(await client.get(`${groupPath(groupId)}/statistics`).json()).tags,
  }
}
