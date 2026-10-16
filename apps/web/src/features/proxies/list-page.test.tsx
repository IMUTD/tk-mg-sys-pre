import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { ProxiesListPage } from "./list-page"

const renderPage = (canWrite = true): void => {
  render(
    <AntdApp>
      <ProxiesListPage canWrite={canWrite} />
    </AntdApp>,
  )
}

describe("ProxiesListPage", () => {
  it("renders 云大师代理管理 filters, columns and seed proxies", async () => {
    renderPage()

    expect(await screen.findByText("华东代理")).toBeVisible()
    expect(screen.getByLabelText("搜索")).toBeVisible()
    expect(screen.getByLabelText("分组")).toBeVisible()
    expect(screen.getByLabelText("类型")).toBeVisible()
    expect(screen.getByLabelText("节流")).toBeVisible()
    expect(screen.getByLabelText("TUN模式")).toBeVisible()
    expect(screen.getByLabelText("加速节点")).toBeVisible()
    expect(screen.queryByRole("button", { name: "搜索" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "新增" })).toBeVisible()
    expect(screen.getByRole("button", { name: "批量导入" })).toBeVisible()
    expect(screen.getByRole("button", { name: "购买代理" })).toBeVisible()
    expect(screen.getByRole("button", { name: "常见问题" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "IP端口" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "检测结果" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "绑定数量" })).toBeVisible()
    expect(screen.getByText("10.0.0.5:8080")).toBeVisible()
    expect(screen.getByText("备用线路")).toBeVisible()
    expect(screen.getByText("剩余动态流量：12.60 GB")).toBeVisible()
    expect(screen.queryByText("proxy-east-secret")).not.toBeInTheDocument()
    expect(screen.queryByText("proxy-backup-secret")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "新建代理" })).not.toBeInTheDocument()
  })

  it("keeps FAQ and purchase for read-only operators", async () => {
    renderPage(false)
    await screen.findByText("华东代理")

    expect(screen.getByRole("button", { name: "常见问题" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "购买代理" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: "新增" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "修改" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "批量导入" })).not.toBeInTheDocument()
  })

  it("imports SOCKS lines without rendering passwords", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("华东代理")

    await user.click(screen.getByRole("button", { name: "批量导入" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("代理内容"), "10.0.0.9|9090|imp-user|imp-pass")
    await user.click(within(dialog).getByRole("button", { name: "确认导入" }))

    expect(await screen.findByText("导入成功！共导入 1 条代理")).toBeVisible()
    expect(screen.getByText("10.0.0.9:9090")).toBeVisible()
    expect(screen.queryByText("imp-pass")).not.toBeInTheDocument()
  })

  it("edits the selected proxy remark", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("备用线路")

    await user.click(screen.getByLabelText("选择 备用线路"))
    await user.click(screen.getByRole("button", { name: "修改" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("修改代理")).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText("备注"))
    await user.type(within(dialog).getByLabelText("备注"), "备用线路-改")
    await user.click(within(dialog).getByRole("button", { name: "确认" }))

    expect(await screen.findByText("备用线路-改")).toBeVisible()
    expect(screen.getByText("修改成功")).toBeVisible()
  })

  it("opens FAQ and locally detects a seed proxy", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("华东代理")

    await user.click(screen.getByRole("button", { name: "常见问题" }))
    expect(await screen.findByText("如何导入代理？")).toBeInTheDocument()
    const faq = await screen.findByRole("dialog")
    const closeButtons = within(faq).getAllByRole("button", { name: "关闭" })
    const closeButton = closeButtons.at(-1)
    if (closeButton === undefined) throw new Error("missing FAQ close button")
    await user.click(closeButton)

    const rows = screen.getAllByRole("row")
    const backupRow = rows.find((row) => row.textContent?.includes("备用线路"))
    if (backupRow === undefined) throw new Error("missing backup row")
    await user.click(within(backupRow).getByRole("button", { name: "检测" }))
    expect(screen.queryByText("检测选项")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "查看" })).not.toBeInTheDocument()
  })
}, 30_000)
