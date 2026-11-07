import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { HTTPError } from "ky"
import type { ReactElement } from "react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import type { MallApi } from "./api"
import type { ShopOrder } from "./catalog"
import {
  createMallApiFixture,
  createOrderFixtures,
  createProductFixtures,
  mallGroupId,
} from "./catalog.test-fixtures"
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

  it("offers account and proxy purchases", async () => {
    const user = userEvent.setup()
    const purchase = vi.fn(createMallApiFixture().purchase)
    wrap(<MallRedeemPage api={createMallApiFixture({ purchase })} />)
    expect(screen.getByText("积分余额")).toBeVisible()
    expect(await screen.findByText("59,900")).toBeVisible()
    expect(screen.getByText("购买账号")).toBeVisible()
    expect(screen.getByText("购买代理")).toBeVisible()
    expect(await screen.findByText("日本满季度白号")).toBeVisible()
    expect(screen.getByText("全球动态住宅")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "购买日本满季度白号" }))
    const dialog = await screen.findByRole("dialog")
    await waitFor(() => expect(within(dialog).getByText("10,000 积分")).toBeVisible())
    await user.click(within(dialog).getByRole("button", { name: "确认购买" }))
    expect(await screen.findByText("购买已提交，等待商家发货")).toBeVisible()
    expect(purchase).toHaveBeenCalledWith(mallGroupId, {
      expectedUnitPoints: 5000,
      idempotencyKey: expect.any(String),
      productId: "aaaaaaaa-0000-4000-8000-000000000001",
      quantity: 2,
    })
  })

  it("blocks a purchase the balance cannot cover and disables sold-out products", async () => {
    const user = userEvent.setup()
    const purchase = vi.fn(createMallApiFixture().purchase)
    const api = createMallApiFixture({
      purchase,
      wallets: async () => [{ balance: 100, groupId: mallGroupId, name: "一组" }],
    })
    wrap(<MallRedeemPage api={api} />)
    expect(await screen.findByRole("button", { name: "购买售罄代理" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "购买全球动态住宅" }))
    const dialog = within(await screen.findByRole("dialog"))
    await waitFor(() => expect(dialog.getByText("积分余额不足")).toBeVisible())
    expect(dialog.getByRole("button", { name: "确认购买" })).toBeDisabled()
    expect(purchase).not.toHaveBeenCalled()
  })

  it("keeps the idempotency key on retry and shows the new price after a change", async () => {
    const user = userEvent.setup()
    const repriced = createProductFixtures().map((item) =>
      item.name === "全球动态住宅" ? { ...item, pricePoints: 30000 } : item,
    )
    const products = vi
      .fn<MallApi["products"]>()
      .mockResolvedValueOnce(createProductFixtures())
      .mockResolvedValue(repriced)
    const purchase = vi
      .fn<MallApi["purchase"]>()
      .mockRejectedValueOnce(
        new HTTPError(
          Response.json({ error: "price_changed" }, { status: 409 }),
          new Request("http://localhost/api"),
          {} as never,
        ),
      )
      .mockResolvedValueOnce({ balance: 29900, orderNo: "M2", points: 30000 })
    wrap(<MallRedeemPage api={createMallApiFixture({ products, purchase })} />)
    await user.click(await screen.findByRole("button", { name: "购买全球动态住宅" }))
    const dialog = within(await screen.findByRole("dialog"))
    await user.click(dialog.getByRole("button", { name: "确认购买" }))

    expect(await screen.findByText("商品价格已变化，请确认新价格后再购买")).toBeVisible()
    expect((await dialog.findAllByText("30,000 积分")).length).toBeGreaterThan(0)

    await user.click(dialog.getByRole("button", { name: "确认购买" }))
    await waitFor(() => expect(purchase).toHaveBeenCalledTimes(2))
    expect(purchase.mock.calls[1]?.[1].expectedUnitPoints).toBe(30000)
    expect(purchase.mock.calls[1]?.[1].idempotencyKey).toBe(
      purchase.mock.calls[0]?.[1].idempotencyKey,
    )
  })

  it("shows the state of a points order", async () => {
    const api = createMallApiFixture({
      orders: async () => ({
        items: [
          {
            ...createOrderFixtures()[0],
            deduction: "1,000 积分",
            delivery: "已取消，积分已退回：缺货",
            id: "order-3",
            orderNo: "M3",
            status: "cancelled" as const,
          } as ShopOrder,
        ],
        total: 1,
      }),
    })
    wrap(<MallOrdersPage api={api} />)
    expect(await screen.findByText("已取消，积分已退回：缺货")).toBeVisible()
    expect(screen.getByText("已取消")).toBeVisible()
  })

  it("lets the buyer see what a shipped order delivered", async () => {
    const user = userEvent.setup()
    const orderItems = vi.fn<MallApi["orderItems"]>(async () => [
      { id: "dddddddd-0000-4000-8000-000000000001", kind: "account", name: "jp_white_001" },
    ])
    const api = createMallApiFixture({
      orderItems,
      orders: async () => ({
        items: [
          {
            ...createOrderFixtures()[0],
            delivery: "已发货 1 个",
            id: "order-4",
            orderNo: "M4",
            status: "shipped" as const,
          } as ShopOrder,
        ],
        total: 1,
      }),
    })
    wrap(<MallOrdersPage api={api} />)
    await user.click(await screen.findByRole("button", { name: "查看明细M4" }))
    const dialog = within(await screen.findByRole("dialog"))
    await waitFor(() => expect(dialog.getByText("jp_white_001")).toBeVisible())
    expect(orderItems).toHaveBeenCalledWith(expect.any(String), "order-4")
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
