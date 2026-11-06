import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import {
  createOrderFixtures,
  createPointFixtures,
  createProductFixtures,
} from "./catalog.test-fixtures"
import { MallInvoicesPage } from "./invoices-page"
import { MallOrdersPage } from "./orders-page"
import { MallRecordsPage } from "./records-page"
import { MallRedeemPage } from "./redeem-page"

vi.mock(import("./catalog"), async (importOriginal) => ({
  ...(await importOriginal()),
  createSeedOrders: () => createOrderFixtures(),
  createSeedPoints: () => createPointFixtures(),
  createSeedProducts: () => createProductFixtures(),
}))

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

  it("offers account and proxy purchases", async () => {
    const user = userEvent.setup()
    wrap(<MallRedeemPage />)
    expect(screen.getByText("积分余额")).toBeVisible()
    expect(screen.getByText("购买账号")).toBeVisible()
    expect(screen.getByText("购买代理")).toBeVisible()
    expect(screen.getByText("日本满季度白号")).toBeVisible()
    expect(screen.getByText("全球动态住宅")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "购买日本满季度白号" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "确认购买" }))
    expect(await screen.findByText("购买已提交，等待商家发货")).toBeVisible()
  })
})
