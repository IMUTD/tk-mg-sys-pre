export type VideoWork = {
  caption: string
  comments: number
  cover: string
  group: string
  id: number
  likes: number
  publishedAt: string
  uid: string
  updatedAt: string
  views: number
  workId: string
}

export const createSeedVideos = (): VideoWork[] => []

export type VideoQuery = {
  caption: string
  group: string
  ungrouped: boolean
  workId: string
}

export const emptyVideoQuery = (): VideoQuery => ({
  caption: "",
  group: "",
  ungrouped: false,
  workId: "",
})

export const filterVideos = (rows: readonly VideoWork[], query: VideoQuery): VideoWork[] =>
  rows.filter((item) => {
    if (
      query.workId.length > 0 &&
      !item.workId.includes(query.workId) &&
      !item.uid.includes(query.workId)
    ) {
      return false
    }
    if (query.caption.length > 0 && !item.caption.includes(query.caption)) return false
    if (query.ungrouped ? item.group.trim().length > 0 : query.group.length > 0 && item.group !== query.group)
      return false
    return true
  })
