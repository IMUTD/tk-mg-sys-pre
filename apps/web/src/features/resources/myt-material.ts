export type MytMaterial = {
  assignTime: string | null
  assignedCount: number
  content: string
  createTime: string
  id: string
  remark: string
  tag: string
}

export type MaterialQuery = {
  tags: readonly string[]
  untagged: boolean
}

export type MaterialTagStatistic = {
  count: number
  tag: string
}

export const emptyMaterialQuery = (): MaterialQuery => ({ tags: [], untagged: false })

const pad2 = (value: number): string => value.toString().padStart(2, "0")

export const nowText = (): string => {
  const date = new Date()
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export const uniqueTags = (materials: readonly MytMaterial[]): string[] =>
  [...new Set(materials.map((item) => item.tag).filter((tag) => tag.length > 0))].sort(
    (left, right) => left.localeCompare(right, "zh-CN"),
  )

export const filterMaterials = (
  materials: readonly MytMaterial[],
  query: MaterialQuery,
): MytMaterial[] =>
  materials.filter((item) => {
    if (query.untagged) return item.tag.trim().length === 0
    if (query.tags.length > 0) return query.tags.includes(item.tag.trim())
    return true
  })

export const materialStatistics = (materials: readonly MytMaterial[]): MaterialTagStatistic[] => {
  const grouped = new Map<string, number>()
  for (const item of materials) {
    const tag = item.tag.length === 0 ? "未分组" : item.tag
    grouped.set(tag, (grouped.get(tag) ?? 0) + 1)
  }
  return [...grouped.entries()].map(([tag, count]) => ({ count, tag }))
}

export const importMaterials = (
  raw: string,
  tag: string,
  startId: number,
  createTime: string,
): MytMaterial[] =>
  raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((content, index) => ({
      assignTime: null,
      assignedCount: 0,
      content,
      createTime,
      id: String(startId + index),
      remark: "",
      tag,
    }))

export const createSeedMaterials = (): MytMaterial[] => []
