import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { HTTPError } from "ky"
import { describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import type { MerchantApi } from "./api"
import { MerchantRechargePage } from "./recharge-page"

const groupId = "11111111-1111-4111-8111-111111111111"

const createApi = (overrides: Partial<MerchantApi> = {}): MerchantApi => ({
  adjust: vi.fn(async () => ({ balance: 95 })),
  cancelOrder: vi.fn(async () => undefined),
  createProduct: vi.fn(async () => {
    throw new Error("not used")
  }),
  orders: vi.fn(async () => ({ items: [], total: 0 })),
  products: vi.fn(async () => ({ items: [], total: 0 })),
  updateProduct: vi.fn(async () => {
    throw new Error("not used")
  }),
  ledger: vi.fn(async () => ({
    items: [
      {
        actorName: "平台人员",
        balance: 100,
        createdAt: "2026-11-07T00:00:00.000Z",
        delta: 100,
        groupId,
        groupName: "一组",
        id: "33333333-3333-4333-8333-333333333333",
        orderNo: "P20261107AAAA",
        remark: "银行流水 001",
        type: "recharge" as const,
      },
    ],
    total: 1,
  })),
  shipOrder: vi.fn(async () => ({ moved: 0, replayed: false })),
  transfer: vi.fn(async () => ({ moved: 0, replayed: false })),
  transferable: vi.fn(async () => ({ items: [], total: 0 })),
  transfers: vi.fn(async () => ({ items: [], total: 0 })),
  invoiceFileUrl: vi.fn(() => "/api/file"),
  invoices: vi.fn(async () => ({ items: [], total: 0 })),
  issueInvoice: vi.fn(async () => {
    throw new Error("not used")
  }),
  refundOrder: vi.fn(async () => ({ points: 0, reclaimed: 0 })),
  rejectInvoice: vi.fn(async () => {
    throw new Error("not used")
  }),
  recharge: vi.fn(async () => ({ balance: 60100, points: 60000 })),
  wallets: vi.fn(async () => ({
    items: [{ balance: 100, groupId, name: "一组" }],
    total: 1,
  })),
  ...overrides,
})

const renderPage = (api: MerchantApi): void => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AntdApp>
        <MerchantRechargePage api={api} />
      </AntdApp>
    </QueryClientProvider>,
  )
}

const conflict = (code: string): HTTPError =>
  new HTTPError(
    Response.json({ error: code }, { status: 409 }),
    new Request("http://localhost/api"),
    {} as never,
  )

const openRecharge = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: "充值一组" }))
  return screen.findByRole("dialog")
}

describe("merchant recharge page", () => {
  it("lists balances and the ledger with its operator", async () => {
    renderPage(createApi())
    expect(await screen.findByRole("button", { name: "充值一组" })).toBeVisible()
    expect(await screen.findByText("银行流水 001")).toBeVisible()
    expect(screen.getByText("平台人员")).toBeVisible()
    expect(screen.getByText("+100")).toBeVisible()
  })

  it("previews points and sends the amount as an exact string", async () => {
    const user = userEvent.setup()
    const api = createApi()
    renderPage(api)
    const dialog = within(await openRecharge(user))
    const submit = dialog.getByRole("button", { name: "确认充值" })
    expect(submit).toBeDisabled()

    await user.type(dialog.getByLabelText("收款金额"), "600.5")
    await user.tab()
    expect(await dialog.findByText("60,050")).toBeVisible()
    expect(submit).toBeDisabled()

    await user.type(dialog.getByLabelText("备注"), " 银行流水 002 ")
    await user.click(submit)

    await waitFor(() => expect(api.recharge).toHaveBeenCalledTimes(1))
    expect(api.recharge).toHaveBeenCalledWith({
      amountYuan: "600.5",
      groupId,
      idempotencyKey: expect.any(String),
      remark: "银行流水 002",
    })
    expect(await screen.findByText("已到账 60,000 积分，当前余额 60,100")).toBeVisible()
    await waitFor(() => expect(api.wallets).toHaveBeenCalledTimes(2))
  })

  it("keeps the dialog and reuses the idempotency key when a retry follows a failure", async () => {
    const user = userEvent.setup()
    const recharge = vi
      .fn<MerchantApi["recharge"]>()
      .mockRejectedValueOnce(new Error("网络错误"))
      .mockResolvedValueOnce({ balance: 200, points: 100 })
    renderPage(createApi({ recharge }))
    const dialog = within(await openRecharge(user))
    await user.type(dialog.getByLabelText("收款金额"), "1")
    await user.tab()
    await user.type(dialog.getByLabelText("备注"), "凭证")
    const submit = dialog.getByRole("button", { name: "确认充值" })

    await user.click(submit)
    expect(await screen.findByText("网络错误")).toBeVisible()
    expect(screen.getByRole("dialog")).toBeVisible()

    await user.click(submit)
    await waitFor(() => expect(recharge).toHaveBeenCalledTimes(2))
    expect(recharge.mock.calls[1]?.[0].idempotencyKey).toBe(
      recharge.mock.calls[0]?.[0].idempotencyKey,
    )
  })

  it("uses a new idempotency key for each opened dialog", async () => {
    const user = userEvent.setup()
    const api = createApi()
    renderPage(api)
    for (const remark of ["一", "二"]) {
      const dialog = within(await openRecharge(user))
      await user.type(dialog.getByLabelText("收款金额"), "1")
      await user.tab()
      await user.type(dialog.getByLabelText("备注"), remark)
      await user.click(dialog.getByRole("button", { name: "确认充值" }))
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    }
    const calls = vi.mocked(api.recharge).mock.calls
    expect(calls[0]?.[0].idempotencyKey).not.toBe(calls[1]?.[0].idempotencyKey)
  }, 60_000)

  it("explains why an adjustment was refused", async () => {
    const user = userEvent.setup()
    const adjust = vi
      .fn<MerchantApi["adjust"]>()
      .mockRejectedValue(conflict("insufficient_balance"))
    renderPage(createApi({ adjust }))
    await user.click(await screen.findByRole("button", { name: "调账一组" }))
    const dialog = within(await screen.findByRole("dialog"))
    await user.type(dialog.getByLabelText("积分变动"), "-500")
    await user.tab()
    await user.type(dialog.getByLabelText("备注"), "冲正")
    await user.click(dialog.getByRole("button", { name: "确认调账" }))

    expect(await screen.findByText("积分余额不足")).toBeVisible()
    expect(adjust).toHaveBeenCalledWith(expect.objectContaining({ delta: -500 }))
    expect(screen.getByRole("dialog")).toBeVisible()
  })

  it("filters the ledger by the chosen group and can return to all", async () => {
    const user = userEvent.setup()
    const api = createApi()
    renderPage(api)
    await user.click(await screen.findByRole("button", { name: "查看一组流水" }))
    expect(await screen.findByText("一组的积分流水")).toBeVisible()
    expect(api.ledger).toHaveBeenLastCalledWith({ groupId, page: 1, pageSize: 20 })

    await user.click(screen.getByRole("button", { name: "查看全部" }))
    expect(await screen.findByText("全部积分流水")).toBeVisible()
  })

  it("reports a failed balance request", async () => {
    renderPage(
      createApi({
        wallets: async () => {
          throw new Error("boom")
        },
      }),
    )
    expect(await screen.findByText("分组余额加载失败，请稍后重试")).toBeVisible()
  })
})
