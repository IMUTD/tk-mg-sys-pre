import { describe, expect, it } from "vitest"

import {
  emptyMaterialQuery,
  filterMaterials,
  filterTextPool,
  importMaterials,
  materialStatistics,
  type MytMaterial,
} from "./myt-material"

describe("importMaterials", () => {
  it("creates one record per non-empty line", () => {
    // Given
    const raw = "第一行\n\n第二行 \n"

    // When
    const imported = importMaterials(raw, "评论", 10, "2026-09-17 12:00:00")

    // Then
    expect(imported).toEqual([
      {
        assignTime: null,
        assignedCount: 0,
        content: "第一行",
        createTime: "2026-09-17 12:00:00",
        id: "10",
        remark: "",
        tag: "评论",
      },
      {
        assignTime: null,
        assignedCount: 0,
        content: "第二行",
        createTime: "2026-09-17 12:00:00",
        id: "11",
        remark: "",
        tag: "评论",
      },
    ])
  })
})

describe("materialStatistics", () => {
  it("counts materials by tag", () => {
    // Given
    const imported = importMaterials("a\nb\nc", "评论", 1, "2026-09-17 12:00:00")

    // When
    const rows = materialStatistics(imported)

    // Then
    expect(rows).toEqual([{ count: 3, tag: "评论" }])
  })
})

describe("filterMaterials", () => {
  it("keeps a row when any selected tag matches", () => {
    const materials = [
      ...importMaterials("甲", "评论", 1, "2026-09-17 12:00:00"),
      ...importMaterials("乙", "私信", 2, "2026-09-17 12:00:00"),
      { ...importMaterials("丙", "", 3, "2026-09-17 12:00:00")[0]!, tag: "" },
    ]
    expect(
      filterMaterials(materials, { ...emptyMaterialQuery(), tags: ["评论", "私信"] }).map((item) => item.content),
    ).toEqual(["甲", "乙"])
    expect(filterMaterials(materials, { ...emptyMaterialQuery(), untagged: true }).map((item) => item.content)).toEqual([
      "丙",
    ])
    expect(
      filterMaterials(materials, { tags: ["评论"], untagged: true }).map((item) => item.content),
    ).toEqual(["甲", "丙"])
  })
})

const sample = (content: string, tag: string, remark = ""): MytMaterial => ({
  assignTime: null,
  assignedCount: 0,
  content,
  createTime: "2026-09-17 12:00:00",
  id: content,
  remark,
  tag,
})

describe("filterTextPool", () => {
  const rows = [sample("早上好", "评论"), sample("晚上好", "评论"), sample("未打标签的一句", "")]

  it("treats each selected tag as its own condition", () => {
    const rowsWithBoth = [...rows, { ...sample("问候早上", "评论"), tags: ["问候"] }]
    expect(filterTextPool(rows, { keyword: "", mode: "and", tags: ["评论"], untagged: false }).map((item) => item.content)).toEqual([
      "早上好",
      "晚上好",
    ])
    expect(filterTextPool(rows, { keyword: "", mode: "and", tags: ["评论"], untagged: true }).map((item) => item.content)).toEqual([])
    expect(filterTextPool(rows, { keyword: "", mode: "or", tags: ["评论"], untagged: true }).map((item) => item.content)).toEqual([
      "早上好",
      "晚上好",
      "未打标签的一句",
    ])
    expect(
      filterTextPool(rowsWithBoth, { keyword: "", mode: "and", tags: ["评论", "问候"], untagged: false }).map(
        (item) => item.content,
      ),
    ).toEqual(["问候早上"])
  })

  it("intersects or unions the tag choice with the search text", () => {
    expect(
      filterTextPool(rows, { keyword: "早上", mode: "and", tags: ["评论"], untagged: false }).map((item) => item.content),
    ).toEqual(["早上好"])
    expect(
      filterTextPool(rows, { keyword: "早上", mode: "or", tags: [], untagged: true }).map((item) => item.content),
    ).toEqual(["早上好", "未打标签的一句"])
  })

  it("keeps every loaded row when neither tag nor search is set", () => {
    expect(filterTextPool(rows, { keyword: "  ", mode: "and", tags: [], untagged: false })).toEqual(rows)
  })

  it("matches the note as well as the tag and content", () => {
    const noted = [sample("正文", "评论", "合作说明")]
    expect(filterTextPool(noted, { keyword: "合作", mode: "and", tags: [], untagged: false }).map((item) => item.content)).toEqual([
      "正文",
    ])
  })
})
