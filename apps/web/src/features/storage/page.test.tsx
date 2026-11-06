import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AntdApp } from "../../app/antd-app"
import { StoragePage } from "./page"
import * as fixturesSource from "./storage-target"
import { createTestTargets } from "./storage-target.test-fixtures"

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
  it("renders NAS cards and keeps the SQL card list", async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText("暂无 NAS 配置")).toBeVisible()
    expect(screen.getByText("配置NAS")).toBeVisible()
    expect(screen.getByRole("button", { name: "新增" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "新增" }))
    expect(await screen.findByLabelText("地址")).toBeVisible()
    expect(screen.getByLabelText("用户名")).toBeVisible()
    expect(screen.getByLabelText("密码")).toBeVisible()
    expect(screen.queryByLabelText("S3 地址")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "取消" }))

    await user.click(screen.getByText("配置SQL类型数据库"))
    expect(await screen.findByText("运营库")).toBeVisible()
    expect(screen.getByText(/127.0.0.1:5432/)).toBeVisible()
    expect(screen.queryByText("sql-ops-secret")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "新增" })).toBeVisible()
  })

  it("hides write actions when canWrite is false", async () => {
    renderPage(false)
    expect(await screen.findByText("暂无 NAS 配置")).toBeVisible()
    expect(screen.queryByRole("button", { name: "新增" })).not.toBeInTheDocument()

    await userEvent.setup().click(screen.getByText("配置SQL类型数据库"))
    await screen.findByText("运营库")
    expect(screen.queryByRole("button", { name: "新增" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "全量备份" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument()
  })

  it("shows backup progress after 全量备份", async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByText("配置SQL类型数据库"))
    await screen.findByText("运营库")

    const card = screen.getByText("运营库").closest(".storage-card")
    if (!(card instanceof HTMLElement)) throw new Error("missing card")
    await user.click(within(card).getByRole("button", { name: "全量备份" }))

    expect(await screen.findByText("已开始全量备份")).toBeVisible()
    expect(await screen.findByText("备份中")).toBeVisible()
    expect(await screen.findByText("最近备份成功")).toBeVisible()
  })
}, 30_000)

afterEach(() => vi.restoreAllMocks())

beforeEach(() => {
  vi.spyOn(fixturesSource, "createSeedTargets").mockImplementation(createTestTargets)
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })),
  )
})
