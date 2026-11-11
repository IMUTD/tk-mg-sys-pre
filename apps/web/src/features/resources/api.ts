import { type MytMaterial, nowText } from "./myt-material"

type StoredResource = {
  readonly assignedCount?: number
  readonly category: string
  readonly createdAt: string
  readonly id: string
  readonly lastAccount?: string
  readonly lastAssignedAt?: string | null
  readonly name: string
  readonly note: string
  readonly tags?: readonly string[]
}

type ResourcePage = {
  readonly items: readonly StoredResource[]
  readonly total: number
}

export type TextPoolApi = {
  assignTags(ids: readonly string[], tags: readonly string[]): Promise<number>
  setLabels(
    id: string,
    input: { readonly category?: string; readonly tags?: readonly string[] },
  ): Promise<void>
  deleteIds(ids: readonly string[]): Promise<number>
  deleteScope(tag?: string): Promise<number>
  importLines(tag: string, contents: readonly string[]): Promise<number>
  list(): Promise<readonly MytMaterial[]>
  update(material: MytMaterial): Promise<MytMaterial>
}

const pad2 = (value: number): string => value.toString().padStart(2, "0")

const formatTime = (value: string | null | undefined): string | null => {
  if (value == null || value.length === 0) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.replace("T", " ").slice(0, 19)
  const day = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  return `${day} ${clock}`
}

const toMaterial = (item: StoredResource): MytMaterial => ({
  assignTime: formatTime(item.lastAssignedAt),
  assignedCount: item.assignedCount ?? 0,
  content: item.name,
  createTime: formatTime(item.createdAt) ?? nowText(),
  id: item.id,
  lastAccount: item.lastAccount ?? "",
  remark: item.note,
  tag: item.category,
  tags: item.tags ?? [],
})

const readError = async (response: Response): Promise<string> => {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  switch (body?.error) {
    case "operation_entity_active":
      return "有素材正在使用，无法删除"
    case "invalid_resource_request":
    case "invalid_batch_request":
      return "内容不符合要求"
    case "authentication_required":
      return "请先登录"
    case "permission_denied":
      return "没有权限"
    default:
      return "保存失败"
  }
}

const request = async (path: string, init?: RequestInit): Promise<Response> => {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init?.headers },
  })
  if (!response.ok) throw new Error(await readError(response))
  return response
}

export const createTextPoolApi = (groupId: string): TextPoolApi => {
  const root = `/api/groups/${groupId}/operations/resources`
  return {
    assignTags: async (ids, tags) => {
      const response = await request(`${root}/batch/assign`, {
        body: JSON.stringify({ ids, tags }),
        method: "POST",
      })
      const body = (await response.json()) as { affected: number }
      return body.affected
    },
    deleteIds: async (ids) => {
      const response = await request(`${root}/batch/delete`, {
        body: JSON.stringify({ ids }),
        method: "POST",
      })
      const body = (await response.json()) as { affected: number }
      return body.affected
    },
    deleteScope: async (tag) => {
      const response = await request(`${root}/batch/delete-scope`, {
        body: JSON.stringify(tag === undefined ? {} : { tag }),
        method: "POST",
      })
      const body = (await response.json()) as { affected: number }
      return body.affected
    },
    importLines: async (tag, contents) => {
      let imported = 0
      for (let index = 0; index < contents.length; index += 1000) {
        const response = await request(`${root}/import`, {
          body: JSON.stringify({ contents: contents.slice(index, index + 1000), tag }),
          method: "POST",
        })
        const body = (await response.json()) as { imported: number }
        imported += body.imported
      }
      return imported
    },
    setLabels: async (id, input) => {
      const body: { category?: string; tags?: readonly string[] } = {}
      if (input.category !== undefined) body.category = input.category
      if (input.tags !== undefined) body.tags = input.tags
      await request(`${root}/${id}`, {
        body: JSON.stringify(body),
        method: "PATCH",
      })
    },
    list: async () => {
      const materials: MytMaterial[] = []
      let page = 1
      let total = 0
      do {
        const response = await request(`${root}?page=${page}&pageSize=100`)
        const body = (await response.json()) as ResourcePage
        if (body.items.length === 0) break
        materials.push(...body.items.map(toMaterial))
        total = body.total
        page += 1
      } while (materials.length < total && page < 100)
      return materials
    },
    update: async (material) => {
      const response = await request(`${root}/${material.id}`, {
        body: JSON.stringify({
          category: material.tag,
          name: material.content,
          note: material.remark,
          tags: material.tags ?? [],
        }),
        method: "PATCH",
      })
      return toMaterial((await response.json()) as StoredResource)
    },
  }
}
