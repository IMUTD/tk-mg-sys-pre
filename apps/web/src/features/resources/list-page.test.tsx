import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { AntdApp } from "../../app/antd-app"
import type { TextPoolApi } from "./api"
import { ResourcesListPage } from "./list-page"
import type { MytMaterial } from "./myt-material"

const seed = (): MytMaterial[] => [
  {
    assignTime: null,
    assignedCount: 1,
    content: "这个视频太好看了，已关注",
    createTime: "2026-09-17 12:00:00",
    id: "11111111-1111-4111-8111-111111111111",
    remark: "",
    tag: "评论",
  },
  {
    assignTime: null,
    assignedCount: 0,
    content: "感谢关注，合作请留言",
    createTime: "2026-09-17 12:00:00",
    id: "22222222-2222-4222-8222-222222222222",
    remark: "",
    tag: "评论",
  },
  {
    assignTime: null,
    assignedCount: 0,
    content: "更新记得艾特我",
    createTime: "2026-09-17 12:00:00",
    id: "33333333-3333-4333-8333-333333333333",
    remark: "",
    tag: "评论",
  },
]

const memoryApi = (): TextPoolApi => {
  let rows = seed()
  return {
    deleteIds: async (ids) => {
      const idSet = new Set(ids)
      const before = rows.length
      rows = rows.filter((item) => !idSet.has(item.id))
      return before - rows.length
    },
    deleteScope: async (tag) => {
      const before = rows.length
      rows = tag === undefined ? [] : rows.filter((item) => item.tag !== tag)
      return before - rows.length
    },
    importLines: async (tag, contents) => {
      const created = contents.map((content, index) => ({
        assignTime: null,
        assignedCount: 0,
        content,
        createTime: "2026-09-17 12:00:00",
        id: `imported-${rows.length + index}`,
        remark: "",
        tag,
      }))
      rows = [...created, ...rows]
      return created.length
    },
    list: async () => rows,
    update: async (material) => {
      rows = rows.map((item) => (item.id === material.id ? material : item))
      return material
    },
  }
}

const renderPage = (canWrite = true, canDelete = false): void => {
  render(
    <AntdApp>
      <ResourcesListPage api={memoryApi()} canDelete={canDelete} canWrite={canWrite} />
    </AntdApp>,
  )
}

describe("ResourcesListPage", () => {
  it("renders 云大师资源池 filters, columns and seed materials", async () => {
    // Given / When
    renderPage(true, true)

    // Then
    expect(await screen.findByText("这个视频太好看了，已关注")).toBeVisible()
    expect(screen.getByLabelText("标签")).toBeVisible()
    expect(screen.getByRole("button", { name: "搜索" })).toBeVisible()
    expect(screen.getByRole("button", { name: "修改" })).toBeVisible()
    expect(screen.getByRole("button", { name: "统计" })).toBeVisible()
    expect(screen.getByRole("button", { name: "批量删除" })).toBeVisible()
    expect(screen.getByRole("button", { name: "批量导入" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "资源内容" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "已分配次数" })).toBeVisible()
    expect(screen.getByText("感谢关注，合作请留言")).toBeVisible()
  })

  it("keeps statistics and import available for read-only operators", async () => {
    // Given
    renderPage(false)
    await screen.findByText("这个视频太好看了，已关注")

    // Then
    expect(screen.getByRole("button", { name: "统计" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "批量导入" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: "修改" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "批量删除" })).not.toBeInTheDocument()
  })

  it("imports one material per line under the given tag", async () => {
    // Given
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("这个视频太好看了，已关注")

    // When
    await user.click(screen.getByRole("button", { name: "批量导入" }))
    expect(await screen.findByLabelText("导入标签")).toBeInTheDocument()
    await user.type(screen.getByLabelText("导入标签"), "新评论")
    await user.type(screen.getByLabelText("素材内容"), "第一条素材\n第二条素材")
    await user.click(screen.getByRole("button", { name: "确认导入" }))

    // Then
    expect(await screen.findByText("第一条素材")).toBeVisible()
    expect(screen.getByText("第二条素材")).toBeVisible()
    expect(screen.getByText("导入成功！共导入 2 条素材")).toBeVisible()
  })

  it("edits selected material content", async () => {
    // Given
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("更新记得艾特我")

    // When
    await user.click(screen.getByLabelText("选择 更新记得艾特我"))
    await user.click(screen.getByRole("button", { name: "修改" }))
    const dialog = await screen.findByRole("dialog")
    await user.clear(within(dialog).getByLabelText("资源内容"))
    await user.type(within(dialog).getByLabelText("资源内容"), "记得开播通知我")
    await user.click(within(dialog).getByRole("button", { name: "确认" }))

    // Then
    expect(await screen.findByText("记得开播通知我")).toBeVisible()
    expect(screen.getByText("修改成功")).toBeVisible()
  })
}, 30_000)
