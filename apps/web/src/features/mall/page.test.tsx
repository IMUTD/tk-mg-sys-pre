import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { MallInvoicesPage } from "./invoices-page"
import { MallOrdersPage } from "./orders-page"
import { MallRecordsPage } from "./records-page"
import { MallRedeemPage } from "./redeem-page"

const wrap = (page: ReactElement): void => {
  render(
    <MemoryRouter>
      <AntdApp>{page}</AntdApp>
    </MemoryRouter>,
  )
}

describe("mall pages", () => {
  it("lists point records with recharge and spend", () => {
    wrap(<MallRecordsPage />)
    expect(screen.getByText("注册GG")).toBeVisible()
    expect(screen.getByText("积分充值6W")).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "余额变动" })).toBeVisible()
  })

  it("lists orders with paid and unpaid status", () => {
    wrap(<MallOrdersPage />)
    expect(screen.getAllByText("全球动态200G30天").length).toBeGreaterThan(0)
    expect(screen.getAllByText("积分充值6W").length).toBeGreaterThan(0)
    expect(screen.getByText("待支付")).toBeVisible()
  })

  it("opens invoice create with title, type and amount only", async () => {
    const user = userEvent.setup()
    wrap(<MallInvoicesPage />)
    expect(screen.getByText("暂无数据")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "新增" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByLabelText("发票抬头")).toBeInTheDocument()
    expect(within(dialog).getByLabelText("申请余额")).toBeInTheDocument()
    expect(within(dialog).getByLabelText("发票类型")).toBeInTheDocument()
    expect(within(dialog).queryByLabelText("税号")).not.toBeInTheDocument()
  })

  it("shows redeem products grouped by tag", async () => {
    const user = userEvent.setup()
    wrap(<MallRedeemPage />)
    expect(screen.getByText("积分余额")).toBeVisible()
    expect(screen.getByText("日本满季度白号100个")).toBeVisible()
    const redeem = screen.getAllByRole("button", { name: "立即兑换" })[0]
    if (redeem === undefined) throw new Error("missing redeem")
    await user.click(redeem)
    expect(await screen.findByText("兑换成功")).toBeVisible()
  })
})
