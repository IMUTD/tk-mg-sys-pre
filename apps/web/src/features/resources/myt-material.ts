import { combineChecks, type FilterMode } from "../../components/tables/operation-controls"

export type MytMaterial = {
  assignTime: string | null
  assignedCount: number
  content: string
  createTime: string
  id: string
  remark: string
  tag: string
  tags?: readonly string[]
}

export const materialLabelSet = (item: MytMaterial): string[] => {
  const seen = new Set<string>()
  const names: string[] = []
  for (const raw of [item.tag, ...(item.tags ?? [])]) {
    const name = raw.trim()
    if (name.length === 0 || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
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
  [...new Set(materials.flatMap((item) => materialLabelSet(item)))].sort((left, right) =>
    left.localeCompare(right, "zh-CN"),
  )

export const matchesMaterialTags = (item: MytMaterial, query: MaterialQuery): boolean | null => {
  if (query.tags.length === 0 && !query.untagged) return null
  const tag = item.tag.trim()
  return query.tags.includes(tag) || (query.untagged && tag.length === 0)
}

export const filterMaterials = (
  materials: readonly MytMaterial[],
  query: MaterialQuery,
): MytMaterial[] => materials.filter((item) => matchesMaterialTags(item, query) !== false)

export type TextPoolFilter = MaterialQuery & {
  keyword: string
  mode: FilterMode
}

const matchesKeyword = (item: MytMaterial, keyword: string): boolean | null => {
  const needle = keyword.trim().toLocaleLowerCase()
  if (needle.length === 0) return null
  return [...materialLabelSet(item), item.content, item.remark].some((value) =>
    value.toLocaleLowerCase().includes(needle),
  )
}

export const filterTextPool = (
  materials: readonly MytMaterial[],
  filter: TextPoolFilter,
): MytMaterial[] =>
  materials.filter((item) => {
    const labels = materialLabelSet(item)
    return combineChecks(filter.mode, [
      ...filter.tags.map((tag) => labels.includes(tag)),
      filter.untagged ? labels.length === 0 : null,
      matchesKeyword(item, filter.keyword),
    ])
  })

export const materialStatistics = (materials: readonly MytMaterial[]): MaterialTagStatistic[] => {
  const grouped = new Map<string, number>()
  for (const item of materials) {
    const labels = materialLabelSet(item)
    for (const tag of labels.length === 0 ? ["未标签"] : labels) {
      grouped.set(tag, (grouped.get(tag) ?? 0) + 1)
    }
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
