import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { AccountMarketPage } from "./account-market"
import { MarketingDashboard } from "./dashboard"
import { NodeMarketPage } from "./node-market"
import { OpsPage } from "./ops-page"
import { SalesPage } from "./sales-page"

const renderPage = (page: ReactElement): void => {
  render(
    <MemoryRouter>
      <AntdApp>{page}</AntdApp>
    </MemoryRouter>,
  )
}

describe("marketing pages", () => {
  it("shows sales kpis, remaining inventory and a trend chart", () => {
    renderPage(<MarketingDashboard />)

    expect(screen.getByText("账号销售额")).toBeVisible()
    expect(screen.getByText("节点销售额")).toBeVisible()
    expect(screen.getByText("系统销售额")).toBeVisible()
    expect(screen.getByText("剩余开窗账号数")).toBeVisible()
    expect(screen.getByText("剩余满月白数")).toBeVisible()
    expect(screen.getByText("剩余白号数")).toBeVisible()
    expect(screen.getByText("剩余千粉号数")).toBeVisible()
    expect(screen.getByText("¥92,600")).toBeVisible()
    expect(screen.getByLabelText("销售折线图")).toBeVisible()
    expect(screen.getByText("白号库存偏低")).toBeVisible()
    expect(screen.getByText("千粉号库存偏低")).toBeVisible()
  })

  it("lists market accounts and filters by type", async () => {
    const user = userEvent.setup()
    renderPage(<AccountMarketPage />)

    expect(await screen.findByText("ACC-W-001")).toBeVisible()
    expect(screen.getByText("ACC-K-077")).toBeVisible()
    expect(screen.getAllByText("林小满").length).toBeGreaterThan(0)
    expect(screen.getAllByText("已开窗").length).toBeGreaterThan(0)
    expect(screen.getByRole("columnheader", { name: "粉丝量" })).toBeVisible()
    expect(screen.getAllByRole("button", { name: "更新" }).length).toBe(6)

    await user.click(screen.getByLabelText("类型"))
    await user.click(
      await screen.findByText("白号", { selector: ".ant-select-item-option-content" }),
    )
    expect(screen.getByText("ACC-W-001")).toBeVisible()
    expect(screen.queryByText("ACC-K-077")).not.toBeInTheDocument()
  })

  it("updates an account listing windowed, price and status only", async () => {
    const user = userEvent.setup()
    renderPage(<AccountMarketPage />)
    const row = screen.getByText("ACC-W-001").closest("tr")
    if (row === null) throw new Error("missing row")
    await user.click(within(row).getByRole("button", { name: "更新" }))

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByLabelText("开窗")).toBeInTheDocument()
    expect(within(dialog).getByLabelText("价格")).toBeInTheDocument()
    expect(within(dialog).getByLabelText("状态")).toBeInTheDocument()
    expect(within(dialog).queryByLabelText("粉丝量")).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText("运营员")).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText("地区")).not.toBeInTheDocument()

    await user.click(within(dialog).getByLabelText("开窗"))
    await user.click(
      await screen.findByText("已开窗", { selector: ".ant-select-item-option-content" }),
    )
    await user.click(within(dialog).getByLabelText("状态"))
    await user.click(
      await screen.findByText("预留", { selector: ".ant-select-item-option-content" }),
    )
    await user.click(within(dialog).getByRole("button", { name: "确认" }))

    expect(await screen.findByText("更新成功")).toBeVisible()
    const updated = screen.getByText("ACC-W-001").closest("tr")
    if (updated === null) throw new Error("missing updated row")
    expect(within(updated).getByText("已开窗")).toBeVisible()
    expect(within(updated).getByText("预留")).toBeVisible()
    expect(within(updated).getByText("林小满")).toBeVisible()
    expect(within(updated).getByText("0")).toBeVisible()
  })

  it("lists nodes with region, bandwidth and stock", () => {
    renderPage(<NodeMarketPage />)
    expect(screen.getByText("美东住宅 A")).toBeVisible()
    expect(screen.getByText("伦敦移动")).toBeVisible()
    expect(screen.getByText("售罄")).toBeVisible()
    expect(screen.getAllByRole("button", { name: "更新" }).length).toBe(4)
  })

  it("updates a node listing price and status only", async () => {
    const user = userEvent.setup()
    renderPage(<NodeMarketPage />)
    const row = screen.getByText("伦敦移动").closest("tr")
    if (row === null) throw new Error("missing row")
    await user.click(within(row).getByRole("button", { name: "更新" }))

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByLabelText("价格")).toBeInTheDocument()
    expect(within(dialog).getByLabelText("状态")).toBeInTheDocument()
    expect(within(dialog).queryByLabelText("开窗")).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText("带宽")).not.toBeInTheDocument()

    await user.click(within(dialog).getByLabelText("状态"))
    await user.click(
      await screen.findByText("在售", { selector: ".ant-select-item-option-content" }),
    )
    await user.click(within(dialog).getByRole("button", { name: "确认" }))

    expect(await screen.findByText("更新成功")).toBeVisible()
    const updated = screen.getByText("伦敦移动").closest("tr")
    if (updated === null) throw new Error("missing updated row")
    expect(within(updated).getByText("在售")).toBeVisible()
    expect(within(updated).getByText("50Mbps")).toBeVisible()
  })

  it("lists salesperson results including node, account and system", () => {
    renderPage(<SalesPage />)
    expect(screen.getByText("林小满")).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "账号销售额" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "净销售" })).toBeVisible()
  })

  it("lists operator inventory and sold rate", () => {
    renderPage(<OpsPage />)
    expect(screen.getByRole("columnheader", { name: "剩余成品" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "售出率" })).toBeVisible()
    expect(screen.getByText("周启")).toBeVisible()
  })
})
