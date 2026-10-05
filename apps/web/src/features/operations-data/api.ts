import ky from "ky"
import { z } from "zod"

import { resolveApiBaseUrl } from "../../lib/api/auth-api"

const RecordSchema = z.object({
  category: z.string().optional(),
  credentialState: z.enum(["configured", "none"]).optional(),
  endpoint: z.string().optional(),
  groupId: z.string().uuid(),
  id: z.string().uuid(),
  identifier: z.string().optional(),
  name: z.string(),
  note: z.string(),
  status: z.string(),
  tags: z.array(z.string()),
  updatedAt: z.coerce.date(),
})
const PageSchema = z.object({
  items: z.array(RecordSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
})
export type ManagedRecord = z.infer<typeof RecordSchema>
export type ManagedPage = z.infer<typeof PageSchema>
export type ManagedListInput = {
  readonly groupId: string
  readonly page: number
  readonly pageSize: number
  readonly query?: string
  readonly status?: string
  readonly tag?: string
}
export type ManagedCreateInput = Readonly<Record<string, string | readonly string[]>>
export interface OperationsDataApi {
  create(groupId: string, input: ManagedCreateInput): Promise<ManagedRecord>
  delete(groupId: string, ids: readonly string[]): Promise<number>
  list(input: ManagedListInput): Promise<ManagedPage>
  update(groupId: string, id: string, input: ManagedCreateInput): Promise<ManagedRecord>
}
const basePath = (groupId: string, segment: string): string =>
  `groups/${encodeURIComponent(groupId)}/operations/${segment}`
export const createOperationsDataApi = (
  segment: "accounts" | "proxies" | "resources",
  apiBaseUrl = "/api",
): OperationsDataApi => {
  const client = ky.create({
    credentials: "include",
    prefixUrl: resolveApiBaseUrl(apiBaseUrl, window.location.href),
    retry: 0,
    timeout: 7_000,
  })
  return {
    create: async (groupId, input) =>
      RecordSchema.parse(await client.post(basePath(groupId, segment), { json: input }).json()),
    delete: async (groupId, ids) =>
      z
        .object({ affected: z.number().int() })
        .parse(
          await client.post(`${basePath(groupId, segment)}/batch/delete`, { json: { ids } }).json(),
        ).affected,
    list: async (input) => {
      const searchParams = new URLSearchParams({
        page: `${input.page}`,
        pageSize: `${input.pageSize}`,
      })
      if (input.query !== undefined && input.query.length > 0)
        searchParams.set("query", input.query)
      if (input.status !== undefined && input.status.length > 0)
        searchParams.set("status", input.status)
      if (input.tag !== undefined && input.tag.length > 0) searchParams.set("tag", input.tag)
      return PageSchema.parse(
        await client.get(basePath(input.groupId, segment), { searchParams }).json(),
      )
    },
    update: async (groupId, id, input) =>
      RecordSchema.parse(
        await client
          .patch(`${basePath(groupId, segment)}/${encodeURIComponent(id)}`, { json: input })
          .json(),
      ),
  }
}
