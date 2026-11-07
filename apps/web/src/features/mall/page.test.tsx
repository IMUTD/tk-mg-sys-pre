import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { createMallApiFixture, mallGroupId } from "./catalog.test-fixtures"
import { MallInvoicesPage } from "./invoices-page"
import { MallOrdersPage } from "./orders-page"
import { MallRecordsPage } from "./records-page"
import { MallRedeemPage } from "./redeem-page"

const wrap = (page: ReactElement): void => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AntdApp>{page}</AntdApp>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("mall pages", () => {
  it("lists point records with recharge and spend", async () => {
    wrap(<MallRecordsPage api={createMallApiFixture()} />)
    expect(await screen.findByText("注册GG")).toBeVisible()
    expect(screen.getByText("积分充值6W")).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "余额变动" })).toBeVisible()
  })

  it("lists orders with paid and unpaid status", async () => {
    wrap(<MallOrdersPage api={createMallApiFixture()} />)
    expect((await screen.findAllByText("全球动态200G30天")).length).toBeGreaterThan(0)
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
    wrap(<MallRedeemPage api={createMallApiFixture()} />)
    expect(screen.getByText("积分余额")).toBeVisible()
    expect(await screen.findByText("59,900")).toBeVisible()
    expect(screen.getByText("购买账号")).toBeVisible()
    expect(screen.getByText("购买代理")).toBeVisible()
    expect(screen.getByText("日本满季度白号")).toBeVisible()
    expect(screen.getByText("全球动态住宅")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "购买日本满季度白号" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "确认购买" }))
    expect(await screen.findByText("购买已提交，等待商家发货")).toBeVisible()
  })

  it("sends trimmed filters to the server and resets to page one", async () => {
    const user = userEvent.setup()
    const ledger = vi.fn(createMallApiFixture().ledger)
    wrap(<MallRecordsPage api={createMallApiFixture({ ledger })} />)
    await screen.findByText("注册GG")
    await user.type(screen.getByLabelText("备注"), "  打款 ")
    await user.click(screen.getByRole("button", { name: "搜索" }))
    await waitFor(() =>
      expect(ledger).toHaveBeenLastCalledWith(mallGroupId, {
        keyword: "打款",
        page: 1,
        pageSize: 20,
      }),
    )
  })

  it("explains a missing group and does not query the ledger", async () => {
    const ledger = vi.fn(createMallApiFixture().ledger)
    wrap(<MallRecordsPage api={createMallApiFixture({ ledger, wallets: async () => [] })} />)
    expect(await screen.findByText("当前账号没有加入任何分组，无法使用积分")).toBeVisible()
    expect(ledger).not.toHaveBeenCalled()
  })

  it("switches between groups and reads the selected balance", async () => {
    const user = userEvent.setup()
    const otherGroup = "22222222-2222-4222-8222-222222222222"
    const ledger = vi.fn(createMallApiFixture().ledger)
    const api = createMallApiFixture({
      ledger,
      wallets: async () => [
        { balance: 10, groupId: mallGroupId, name: "一组" },
        { balance: 20, groupId: otherGroup, name: "二组" },
      ],
    })
    wrap(<MallRecordsPage api={api} />)
    await user.click(await screen.findByRole("combobox", { name: "分组" }))
    await user.click(await screen.findByText("二组"))
    await waitFor(() =>
      expect(ledger).toHaveBeenLastCalledWith(otherGroup, { page: 1, pageSize: 20 }),
    )
  })

  it("reports a failed ledger request instead of showing an empty table", async () => {
    const api = createMallApiFixture({
      ledger: async () => {
        throw new Error("boom")
      },
    })
    wrap(<MallRecordsPage api={api} />)
    expect(await screen.findByText("积分记录加载失败，请稍后重试")).toBeVisible()
  })
})
