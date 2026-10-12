import { describe, expect, it } from "vitest"

import { importMaterials, materialStatistics } from "./myt-material"

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
