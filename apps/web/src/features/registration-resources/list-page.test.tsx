import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { RegistrationResourceListPage } from "./list-page"

const renderPage = (canWrite = true): void => {
  render(
    <AntdApp>
      <RegistrationResourceListPage canWrite={canWrite} />
    </AntdApp>,
  )
}

describe("RegistrationResourceListPage", () => {
  it("renders 云大师注册资源 filters, columns and seed resources", async () => {
    // Given / When
    renderPage()

    // Then
    expect(await screen.findByRole("cell", { name: "xxx12143@gmail.com" })).toBeVisible()
    expect(screen.getByLabelText("搜索")).toBeVisible()
    expect(screen.getByLabelText("备注筛选")).toBeVisible()
    expect(screen.getByLabelText("账号分组")).toBeVisible()
    expect(screen.getByLabelText("状态")).toBeVisible()
    expect(screen.getByLabelText("结果")).toBeVisible()
    expect(screen.queryByRole("button", { name: "搜索" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "导入资源" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "智能导入" })).toBeVisible()
    expect(screen.getByRole("button", { name: "批量分配（0）" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "重置状态" })).toBeVisible()
    expect(screen.getByRole("button", { name: "统计" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "智能解析" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "分配状态" })).toBeVisible()
    expect(screen.getByRole("cell", { name: "31123456" })).toBeVisible()
    expect(screen.getByRole("cell", { name: "email1001@tkyds.com" })).toBeVisible()
  })

  it("keeps smart import available while hiding statistics for read-only operators", async () => {
    // Given
    renderPage(false)
    await screen.findByRole("cell", { name: "xxx12143@gmail.com" })

    // Then
    expect(screen.getByRole("button", { name: "智能导入" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: "统计" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "批量分配（0）" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "导入资源" })).not.toBeInTheDocument()
  })

  it("parses smart import data and writes resources after confirming a group tag", async () => {
    // Given
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole("cell", { name: "xxx12143@gmail.com" })

    // When
    await user.click(screen.getByRole("button", { name: "智能导入" }))
    expect(await screen.findByText("智能导入 [使用前请先联系客服获取使用说明]")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "解析数据" })).toBeDisabled()
    await user.click(screen.getByLabelText("原始数据"))
    await user.paste("newmail@gmail.com----new-pass----help@outlook.com")
    await user.click(screen.getByRole("button", { name: "解析数据" }))
    expect(await screen.findByText("检测到 1 行数据，每行 3 个字段")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "执行导入" }))
    await user.click(await screen.findByLabelText("分组名称"))
    await user.paste("batch01")
    await user.click(screen.getByRole("button", { name: "确认导入" }))

    // Then
    expect(await screen.findByRole("cell", { name: "newmail@gmail.com" })).toBeVisible()
    expect(screen.getByText("智能导入成功，共导入1条数据")).toBeVisible()
  }, 60_000)

  it("filters by search and resets selected status", async () => {
    // Given
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole("cell", { name: "xxx12143@gmail.com" })

    // When
    await user.type(screen.getByLabelText("搜索"), "31123456")
    expect(await screen.findByRole("cell", { name: "31123456" })).toBeVisible()
    expect(screen.queryByRole("cell", { name: "xxx12143@gmail.com" })).not.toBeInTheDocument()
    await user.click(screen.getByLabelText("选择 31123456"))
    await user.click(screen.getByRole("button", { name: "重置状态(1)" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "确定" }))

    // Then
    expect(await screen.findByText("重置成功,共重置1个账号")).toBeVisible()
  })
}, 30_000)
