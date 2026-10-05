import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { StoragePage } from "./page"

const renderPage = (canWrite = true): void => {
  render(
    <MemoryRouter>
      <AntdApp>
        <StoragePage canWrite={canWrite} />
      </AntdApp>
    </MemoryRouter>,
  )
}

describe("StoragePage", () => {
  it("renders NAS and SQL pages as selectable card lists without secrets", async () => {
    renderPage()

    expect(await screen.findByText("主 NAS")).toBeVisible()
    expect(screen.getByText("配置NAS")).toBeVisible()
    expect(screen.getByText("配置SQL类型数据库")).toBeVisible()
    expect(screen.getByRole("button", { name: "新增" })).toBeVisible()
    expect(screen.getAllByRole("button", { name: "全量备份" }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole("button", { name: "定时备份" }).length).toBeGreaterThan(0)
    expect(screen.getByText(/nas.internal:445/)).toBeVisible()
    expect(screen.queryByText("nas-secret")).not.toBeInTheDocument()
    expect(screen.queryByText("私有云储存尚未配置")).not.toBeInTheDocument()

    await userEvent.setup().click(screen.getByText("配置SQL类型数据库"))
    expect(await screen.findByText("运营库")).toBeVisible()
    expect(screen.getByText(/127.0.0.1:5432/)).toBeVisible()
    expect(screen.queryByText("sql-ops-secret")).not.toBeInTheDocument()
    expect(screen.queryByText("主 NAS")).not.toBeInTheDocument()
  })

  it("hides write actions when canWrite is false", async () => {
    renderPage(false)
    await screen.findByText("主 NAS")

    expect(screen.queryByRole("button", { name: "新增" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "全量备份" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument()
  })

  it("creates a NAS target after a successful connection test", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("主 NAS")

    await user.click(screen.getByRole("button", { name: "新增" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("名称"), "热备 NAS")
    await user.type(within(dialog).getByLabelText("主机"), "nas-hot.internal")
    await user.clear(within(dialog).getByLabelText("根目录"))
    await user.type(within(dialog).getByLabelText("根目录"), "/hot")
    await user.type(within(dialog).getByLabelText("密码"), "hot-nas-secret")
    await user.click(within(dialog).getByRole("button", { name: "测试连接" }))
    expect(await screen.findByText("连接成功")).toBeVisible()
    await user.click(within(dialog).getByRole("button", { name: "确认" }))

    expect(await screen.findByText("新增成功")).toBeVisible()
    expect(screen.getByText("热备 NAS")).toBeVisible()
    expect(screen.queryByText("hot-nas-secret")).not.toBeInTheDocument()
  })

  it("shows backup progress after 全量备份", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("主 NAS")

    const card = screen.getByText("主 NAS").closest(".storage-card")
    if (!(card instanceof HTMLElement)) throw new Error("missing card")
    await user.click(within(card).getByRole("button", { name: "全量备份" }))

    expect(await screen.findByText("已开始全量备份")).toBeVisible()
    expect(await screen.findByText("备份中")).toBeVisible()
    expect(await screen.findByText("最近备份成功")).toBeVisible()
  })
}, 30_000)
