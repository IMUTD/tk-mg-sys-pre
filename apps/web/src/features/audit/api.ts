import ky from "ky"
import { z } from "zod"

import { resolveApiBaseUrl } from "../../lib/api/auth-api"

const AuditEventSchema = z.object({
  action: z.string(),
  actorId: z.string().uuid(),
  createdAt: z.coerce.date(),
  id: z.string().uuid(),
  metadata: z.record(z.string(), z.string()).default({}),
  outcome: z.enum(["allowed", "denied", "failed"]),
  target: z.string(),
})
export type AuditEvent = z.infer<typeof AuditEventSchema>
const AuditPageSchema = z.object({
  items: z.array(AuditEventSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
})
export type AuditPage = z.infer<typeof AuditPageSchema>
export type AuditFilter = {
  readonly action?: string
  readonly actorId?: string
  readonly createdAfter?: string
  readonly createdBefore?: string
  readonly groupId?: string
  readonly page: number
  readonly pageSize: number
  readonly target?: string
}

export interface AuditApi {
  list(filter: AuditFilter): Promise<AuditPage>
}

export const createAuditApi = (apiBaseUrl = "/api"): AuditApi => {
  const client = ky.create({
    credentials: "include",
    prefixUrl: resolveApiBaseUrl(apiBaseUrl, window.location.href),
    retry: 0,
    timeout: 7_000,
  })
  return {
    list: async (filter) => {
      const searchParams = new URLSearchParams({
        page: `${filter.page}`,
        pageSize: `${filter.pageSize}`,
      })
      if (filter.action !== undefined && filter.action.length > 0)
        searchParams.set("action", filter.action)
      if (filter.actorId !== undefined && filter.actorId.length > 0)
        searchParams.set("actorId", filter.actorId)
      if (filter.createdAfter !== undefined && filter.createdAfter.length > 0)
        searchParams.set("createdAfter", filter.createdAfter)
      if (filter.createdBefore !== undefined && filter.createdBefore.length > 0)
        searchParams.set("createdBefore", filter.createdBefore)
      if (filter.groupId !== undefined && filter.groupId.length > 0)
        searchParams.set("groupId", filter.groupId)
      if (filter.target !== undefined && filter.target.length > 0)
        searchParams.set("target", filter.target)
      return AuditPageSchema.parse(await client.get("audit", { searchParams }).json())
    },
  }
}
