import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AntdApp } from "../../app/antd-app"
import { mockLabelCatalog } from "../labels/catalog.test-fixtures"
import { AccountsListPage } from "./list-page"
import * as fixturesSource from "./myt-account"
import {
  createTestAccountDevices,
  createTestAccountProxies,
  createTestAccounts,
} from "./myt-account.test-fixtures"

afterEach(() => vi.restoreAllMocks())

const renderPage = (canWrite = true, canDelete = false): void => {
  render(
    <MemoryRouter>
      <AntdApp>
        <AccountsListPage canDelete={canDelete} canWrite={canWrite} />
      </AntdApp>
    </MemoryRouter>,
  )
}

describe("AccountsListPage", () => {
  it("renders 云大师账号管理 filters, columns and seed accounts", async () => {
    renderPage()

    expect(await screen.findByText("user.alpha")).toBeVisible()
    expect(screen.getByLabelText("账号分组")).toBeVisible()
    expect(screen.getByLabelText("账号状态")).toBeVisible()
    expect(screen.getByLabelText("APP类型")).toBeVisible()
    expect(screen.getByLabelText("备份方式")).toBeVisible()
    expect(screen.getByText("搜索")).toBeVisible()
    expect(screen.getByLabelText("绑定设备")).toBeVisible()
    expect(screen.getByLabelText("绑定代理")).toBeVisible()
    expect(screen.queryByText("绑定设备：")).not.toBeInTheDocument()
    expect(screen.queryByText("绑定代理：")).not.toBeInTheDocument()
    expect(screen.getByLabelText("账号标签")).toBeVisible()
    expect(screen.getByLabelText("用户备注")).toBeVisible()
    expect(screen.getByLabelText("归属地")).toBeVisible()
    expect(screen.getByLabelText("用户名 / UID")).toBeVisible()
    expect(screen.queryByRole("button", { name: "搜索" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "回收站" })).toBeVisible()
    expect(screen.getByRole("button", { name: "统计" })).toBeVisible()
    expect(screen.getByRole("button", { name: "转移码" })).toBeVisible()
    expect(screen.getByRole("button", { name: "手动备份" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "UID/账号/密码" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "标签组" })).toBeVisible()
    expect(screen.getAllByText("复制密码").length).toBeGreaterThan(0)
    expect(screen.getAllByText("无密码").length).toBeGreaterThan(0)
    expect(screen.queryByText("Acc#SeedAlpha")).not.toBeInTheDocument()
    expect(screen.queryByText("recycled.one")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "新建账号" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument()
  })

  it("keeps recycle and statistics for read-only operators", async () => {
    renderPage(false)
    await screen.findByText("user.alpha")

    expect(screen.getByRole("button", { name: "回收站" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "统计" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "转移码" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: "修改" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "手动备份" })).not.toBeInTheDocument()
  })

  it("moves a selected account into the recycle bin and restores it", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-09-17T12:00:00").getTime())
    const user = userEvent.setup()
    renderPage(true, true)
    await screen.findByText("user.bravo")

    await user.click(screen.getByLabelText("选择 user.bravo"))
    const toolbar = document.querySelector(".resource-crud-toolbar")
    if (!(toolbar instanceof HTMLElement)) throw new Error("missing toolbar")
    await user.click(within(toolbar).getByRole("button", { name: "删除" }))
    const deleteDialog = await screen.findByRole("dialog")
    await user.click(within(deleteDialog).getByRole("button", { name: "确定" }))
    expect(await screen.findByText("删除成功")).toBeVisible()
    expect(screen.queryByText("user.bravo")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "回收站" }))
    const recycle = await screen.findByRole("dialog")
    await waitFor(() => expect(within(recycle).getByText("user.bravo")).toBeVisible())
    expect(within(recycle).getByText("recycled.one")).toBeVisible()
    await user.click(within(recycle).getByLabelText("选择 user.bravo"))
    await user.click(within(recycle).getByRole("button", { name: "批量恢复" }))
    const restoreDialog = (await screen.findAllByRole("dialog")).at(-1)
    if (restoreDialog === undefined) throw new Error("missing restore confirm")
    expect(within(restoreDialog).getByText("确认恢复选中的 1 个账号吗？")).toBeInTheDocument()
    await user.click(within(restoreDialog).getByRole("button", { name: "确定" }))
    expect(await screen.findByText("已恢复 1 个账号")).toBeVisible()
  })

  it("edits the selected account username", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("studio.north")

    await user.click(screen.getByLabelText("选择 studio.north"))
    await user.click(screen.getByRole("button", { name: "修改" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("编辑账号")).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText("账号"))
    await user.type(within(dialog).getByLabelText("账号"), "studio.renamed")
    await user.click(within(dialog).getByRole("button", { name: "确认" }))

    expect(await screen.findByText("studio.renamed")).toBeVisible()
    expect(screen.getByText("修改成功")).toBeVisible()
  })

  it("opens tag statistics from the toolbar", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("user.alpha")

    await user.click(screen.getByRole("button", { name: "统计" }))
    expect(await screen.findByText("今日剩余检测次数: 128")).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "封号率" })).toBeInTheDocument()
  })
}, 30_000)

beforeEach(() => {
  vi.spyOn(fixturesSource, "createSeedAccounts").mockImplementation(createTestAccounts)
  vi.spyOn(fixturesSource, "createSeedAccountDevices").mockImplementation(createTestAccountDevices)
  vi.spyOn(fixturesSource, "createSeedAccountProxies").mockImplementation(createTestAccountProxies)
})

beforeEach(mockLabelCatalog)
