import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { ResourcesListPage } from "./list-page"

const renderPage = (canWrite = true, canDelete = false): void => {
  render(
    <AntdApp>
      <ResourcesListPage canDelete={canDelete} canWrite={canWrite} />
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
