import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { AccountPoolListPage } from "./list-page"

const renderPage = (canWrite = true): void => {
  render(
    <MemoryRouter>
      <AntdApp>
        <AccountPoolListPage canWrite={canWrite} />
      </AntdApp>
    </MemoryRouter>,
  )
}

const rowByText = (text: string): HTMLElement => {
  const row = screen.getAllByRole("row").find((item) => item.textContent?.includes(text))
  if (row === undefined) throw new Error(`missing row ${text}`)
  return row
}

describe("AccountPoolListPage", () => {
  it("renders 云大师账号池 filters, columns and seed packs", async () => {
    renderPage()

    expect(await screen.findByText("1107发布")).toBeVisible()
    expect(screen.getByLabelText("ID")).toBeVisible()
    expect(screen.getByLabelText("编码")).toBeVisible()
    expect(screen.getByLabelText("备注")).toBeVisible()
    expect(screen.getByRole("button", { name: "搜索" })).toBeVisible()
    expect(screen.getByRole("button", { name: "新增" })).toBeVisible()
    expect(screen.getByRole("button", { name: "创建账号池" })).toBeVisible()
    expect(screen.getByRole("button", { name: "什么是账号池?" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "备份方式" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "绑定设备" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "分析" })).toBeVisible()
    expect(screen.getByText("1107养号")).toBeVisible()
    expect(screen.getByText("gen-1108测试")).toBeVisible()
    expect(screen.getByText("发布任务池")).toBeVisible()
    expect(within(rowByText("1107发布")).getByRole("button", { name: "复制" })).toBeVisible()
    expect(
      within(rowByText("gen-1108测试")).queryByRole("button", { name: "复制" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "租用" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "归还" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "新建账号池" })).not.toBeInTheDocument()
    expect(screen.queryByText("Acc#SeedAlpha")).not.toBeInTheDocument()
  })

  it("hides write actions when canWrite is false", async () => {
    renderPage(false)
    await screen.findByText("1107发布")

    expect(screen.queryByRole("button", { name: "新增" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "创建账号池" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "什么是账号池?" })).toBeVisible()
    expect(screen.getAllByRole("button", { name: "数据统计" }).length).toBeGreaterThan(0)
  })

  it("creates a pool from 新增 without showing secrets", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("1107发布")

    await user.click(screen.getByRole("button", { name: "新增" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("新增账号池")).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText("账号池名"), "1109矩阵")
    await user.click(within(dialog).getByLabelText("设备"))
    await user.click(await screen.findByRole("option", { name: "192.168.76.130-270-亮18" }))
    await user.click(within(dialog).getByLabelText("账号分组"))
    await user.click(await screen.findByRole("option", { name: /亮2/ }))
    await user.click(within(dialog).getByRole("button", { name: "确认" }))

    expect(await screen.findByText("新增成功")).toBeVisible()
    expect(screen.getByText("1109矩阵")).toBeVisible()
    expect(screen.queryByText("Acc#SeedAlpha")).not.toBeInTheDocument()
  })

  it("creates a pool from selected seed accounts", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("1107发布")

    await user.click(screen.getByRole("button", { name: "创建账号池" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("创建账号池")).toBeInTheDocument()
    await user.click(within(dialog).getByLabelText("创建设备"))
    await user.click(await screen.findByRole("option", { name: "192.168.76.130-270-亮18" }))
    await user.click(within(dialog).getByLabelText("选择账号 184992211"))
    await user.click(within(dialog).getByRole("button", { name: /新建选中/ }))

    expect(await screen.findByText("新建成功")).toBeVisible()
    expect(screen.getByText("池-104")).toBeVisible()
  })

  it("filters by encoding without rendering passwords", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("1107养号")

    await user.type(screen.getByLabelText("编码"), "养号")
    await user.click(screen.getByRole("button", { name: "搜索" }))

    expect(screen.getByText("1107养号")).toBeVisible()
    expect(screen.queryByText("1107发布")).not.toBeInTheDocument()
    expect(screen.queryByText("Acc#SeedTravel")).not.toBeInTheDocument()
  })

  it("opens help and account list dialogs from the seed row", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("1107发布")

    await user.click(screen.getByRole("button", { name: "什么是账号池?" }))
    const help = await screen.findByRole("dialog")
    expect(within(help).getByText("1. 简单介绍")).toBeInTheDocument()
    await user.keyboard("{Escape}")
    expect(screen.queryByText("1. 简单介绍")).not.toBeInTheDocument()

    await user.click(within(rowByText("1107发布")).getByRole("button", { name: "账号列表" }))
    const list = await screen.findByRole("dialog")
    expect(within(list).getByText("账号列表")).toBeInTheDocument()
    expect(within(list).getByText("user.alpha")).toBeInTheDocument()
    expect(within(list).queryByText("Acc#SeedAlpha")).not.toBeInTheDocument()
  })
}, 30_000)
