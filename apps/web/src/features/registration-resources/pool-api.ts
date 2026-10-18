import ky from "ky"
import { z } from "zod"

import { resolveApiBaseUrl } from "../../lib/api/auth-api"
import type { TkRegResource } from "./tk-reg-resource"

const FlagSchema = z.enum(["0", "1"])
const ItemSchema = z.object({
  assignTime: z.string().nullable(),
  createTime: z.string(),
  data: z.record(z.string(), z.string()),
  email: z.string(),
  id: z.number().int(),
  recycle: FlagSchema,
  remark: z.string(),
  result: FlagSchema,
  status: FlagSchema,
  tag: z.string(),
})
const ItemsSchema = z.object({ items: z.array(ItemSchema) })

const client = () =>
  ky.create({
    credentials: "include",
    prefixUrl: resolveApiBaseUrl("/api", window.location.href),
    retry: 0,
    timeout: 30_000,
  })

const toResource = (item: z.infer<typeof ItemSchema>): TkRegResource => item

export const createRegistrationPoolApi = () => ({
  delete: async (groupId: string, ids: readonly number[]): Promise<void> => {
    await client().post(`groups/${groupId}/registration-pool/delete`, { json: { ids } })
  },
  deleteByTags: async (
    groupId: string,
    tags: readonly string[],
    usedOnly: boolean,
  ): Promise<void> => {
    await client().post(`groups/${groupId}/registration-pool/delete-by-tags`, {
      json: { tags, usedOnly },
    })
  },
  import: async (
    groupId: string,
    items: readonly TkRegResource[],
  ): Promise<readonly TkRegResource[]> => {
    const response = await client().post(`groups/${groupId}/registration-pool/import`, {
      json: {
        items: items.map((item) => ({
          data: item.data,
          email: item.email,
          remark: item.remark,
          tag: item.tag,
        })),
      },
    })
    return ItemsSchema.parse(await response.json()).items.map(toResource)
  },
  list: async (groupId: string): Promise<readonly TkRegResource[]> => {
    const response = await client().get(`groups/${groupId}/registration-pool`)
    return ItemsSchema.parse(await response.json()).items.map(toResource)
  },
  reset: async (groupId: string, ids: readonly number[]): Promise<void> => {
    await client().post(`groups/${groupId}/registration-pool/reset`, { json: { ids } })
  },
  update: async (groupId: string, resource: TkRegResource): Promise<TkRegResource> => {
    const response = await client().patch(`groups/${groupId}/registration-pool/${resource.id}`, {
      json: {
        data: resource.data,
        email: resource.email,
        remark: resource.remark,
        status: resource.status,
        tag: resource.tag,
      },
    })
    return toResource(ItemSchema.parse(await response.json()))
  },
})
