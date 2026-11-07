import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { HTTPError } from "ky"
import type { ReactElement } from "react"
import { describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import type { MallOrderRecord } from "../mall/api"
import { AccountTransferPage } from "./accounts-page"
import type { MerchantApi, TransferableResource } from "./api"
import { MerchantOrdersPage } from "./orders-page"

const buyerGroup = "11111111-1111-4111-8111-111111111111"
const stockGroup = "33333333-3333-4333-8333-333333333333"

const wallets = [
  { balance: 0, groupId: buyerGroup, name: "买家一" },
  { balance: 0, groupId: stockGroup, name: "平台库存" },
]

const account = (
  index: number,
  patch: Partial<TransferableResource> = {},
): TransferableResource => ({
  blockedBy: null,
  detail: `jp_00${index}`,
  id: `aaaaaaaa-0000-4000-8000-00000000000${index}`,
  kind: "account",
  name: `账号${index}`,
  shippable: true,
  status: "ready",
  tags: ["内部标签"],
  ...patch,
})

const order: MallOrderRecord = {
  amountCents: 0,
  buyerName: "一组管理员",
  cancelReason: "",
  cancelledAt: null,
  createdAt: "2026-11-07T00:00:00.000Z",
  description: "",
  groupId: buyerGroup,
  groupName: "买家一",
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  orderNo: "M1",
  paidAt: "2026-11-07T00:00:00.000Z",
  points: 200,
  product: "日本白号",
  productKind: "account",
  quantity: 2,
  refundedAt: null,
  shippedAt: null,
  status: "pending_ship",
  title: "资源购买",
  type: "resource",
  unitPoints: 100,
}

const createApi = (overrides: Partial<MerchantApi> = {}): MerchantApi => ({
  adjust: vi.fn(async () => ({ balance: 0 })),
  cancelOrder: vi.fn(async () => undefined),
  createProduct: vi.fn(async () => {
    throw new Error("not used")
  }),
  ledger: vi.fn(async () => ({ items: [], total: 0 })),
  orders: vi.fn(async () => ({ items: [order], total: 1 })),
  products: vi.fn(async () => ({ items: [], total: 0 })),
  invoiceFileUrl: vi.fn(() => "/api/file"),
  invoices: vi.fn(async () => ({ items: [], total: 0 })),
  issueInvoice: vi.fn(async () => {
    throw new Error("not used")
  }),
  refundOrder: vi.fn(async () => ({ points: 0, reclaimed: 0 })),
  rejectInvoice: vi.fn(async () => {
    throw new Error("not used")
  }),
  recharge: vi.fn(async () => ({ balance: 0, points: 0 })),
  shipOrder: vi.fn(async () => ({ moved: 2, replayed: false })),
  transfer: vi.fn(async () => ({ moved: 1, replayed: false })),
  transferable: vi.fn(async () => ({
    items: [account(1), account(2), account(3)],
    total: 3,
  })),
  transfers: vi.fn(async () => ({ items: [], total: 0 })),
  updateProduct: vi.fn(async () => {
    throw new Error("not used")
  }),
  wallets: vi.fn(async () => ({ items: wallets, total: wallets.length })),
  ...overrides,
})

const renderPage = (page: ReactElement): void => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AntdApp>{page}</AntdApp>
    </QueryClientProvider>,
  )
}

const pickGroup = async (
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  name: string,
): Promise<void> => {
  await user.click(screen.getByRole("combobox", { name: label }))
  const options = await screen.findAllByRole("option", { name })
  const last = options.at(-1)
  if (last === undefined) throw new Error(`missing option ${name}`)
  await user.click(last)
}

const conflict = (body: unknown): HTTPError =>
  new HTTPError(
    Response.json(body, { status: 409 }),
    new Request("http://localhost/api"),
    {} as never,
  )

describe("ship dialog", () => {
  const openDialog = async (api: MerchantApi) => {
    const user = userEvent.setup()
    renderPage(<MerchantOrdersPage api={api} />)
    await user.click(await screen.findByRole("button", { name: "发货M1" }))
    const dialog = within(await screen.findByRole("dialog"))
    await waitFor(() => expect(dialog.getByText("买家「买家一」购买 日本白号 × 2")).toBeVisible())
    return { dialog, user }
  }

  it("needs a source group and the exact quantity, then ships", async () => {
    const api = createApi()
    const { dialog, user } = await openDialog(api)
    const confirm = dialog.getByRole("button", { name: "确认发货" })
    expect(confirm).toBeDisabled()
    expect(api.transferable).not.toHaveBeenCalled()

    await pickGroup(user, "来源分组", "平台库存")
    await waitFor(() =>
      expect(api.transferable).toHaveBeenCalledWith(
        "account",
        expect.objectContaining({ groupId: stockGroup, shippableOnly: true }),
      ),
    )
    const first = await dialog.findByRole("row", { name: /账号1/ })
    await user.click(within(first).getByRole("checkbox"))
    expect(confirm).toBeDisabled()

    await user.click(within(dialog.getByRole("row", { name: /账号2/ })).getByRole("checkbox"))
    expect(dialog.getByLabelText("已选数量")).toHaveTextContent("已选 2 / 2")
    // 已选满时不能再多选。
    expect(within(dialog.getByRole("row", { name: /账号3/ })).getByRole("checkbox")).toBeDisabled()
    expect(dialog.getByText(/将从「平台库存」转 2 个账号给「买家一」.*账号1、账号2/)).toBeVisible()

    await user.click(confirm)
    await waitFor(() =>
      expect(api.shipOrder).toHaveBeenCalledWith(order.id, {
        ids: [account(1).id, account(2).id],
        sourceGroupId: stockGroup,
      }),
    )
    expect(await screen.findByText("已把 2 个账号发给「买家一」")).toBeVisible()
  }, 60_000)

  it("does not offer the buyer's own group as the source", async () => {
    const { user } = await openDialog(createApi())
    await user.click(screen.getByRole("combobox", { name: "来源分组" }))
    await screen.findByRole("option", { name: "平台库存" })
    expect(screen.queryByRole("option", { name: "买家一" })).toBeNull()
  }, 60_000)

  it("picks the current page up to the quantity", async () => {
    const api = createApi()
    const { dialog, user } = await openDialog(api)
    await pickGroup(user, "来源分组", "平台库存")
    await dialog.findByRole("row", { name: /账号1/ })
    await user.click(dialog.getByRole("button", { name: "选中本页" }))
    expect(dialog.getByLabelText("已选数量")).toHaveTextContent("已选 2 / 2")
  }, 60_000)

  it("names what blocked the shipment and clears the selection", async () => {
    const api = createApi({
      shipOrder: vi.fn(async () => {
        throw conflict({ error: "resource_in_use", items: ["账号1"] })
      }),
    })
    const { dialog, user } = await openDialog(api)
    await pickGroup(user, "来源分组", "平台库存")
    await dialog.findByRole("row", { name: /账号1/ })
    await user.click(dialog.getByRole("button", { name: "选中本页" }))
    await user.click(dialog.getByRole("button", { name: "确认发货" }))
    expect(await screen.findByText(/正在使用.*：账号1/)).toBeVisible()
    expect(dialog.getByLabelText("已选数量")).toHaveTextContent("已选 0 / 2")
  }, 60_000)

  it("shows where a shipped order's items came from and offers no second shipment", async () => {
    const user = userEvent.setup()
    const shipped = { ...order, shippedAt: "2026-11-08T00:00:00.000Z", status: "shipped" as const }
    const api = createApi({
      orders: vi.fn(async () => ({ items: [shipped], total: 1 })),
      transfers: vi.fn(async () => ({
        items: [
          {
            createdAt: "2026-11-08T00:00:00.000Z",
            displayName: "账号1",
            entityId: account(1).id,
            id: "cccccccc-0000-4000-8000-000000000001",
            kind: "account" as const,
            movedByName: "平台人员",
            orderNo: "M1",
            reason: "",
            sourceGroupName: "平台库存",
            targetGroupName: "买家一",
          },
        ],
        total: 1,
      })),
    })
    renderPage(<MerchantOrdersPage api={api} />)
    await user.click(await screen.findByRole("button", { name: "发货明细M1" }))
    const dialog = within(await screen.findByRole("dialog"))
    await waitFor(() => expect(dialog.getByText("平台库存")).toBeVisible())
    expect(api.transfers).toHaveBeenCalledWith(expect.objectContaining({ orderId: order.id }))
    expect(screen.queryByRole("button", { name: "发货M1" })).toBeNull()
  }, 60_000)
})

describe("refund dialog", () => {
  const shipped = { ...order, shippedAt: "2026-11-08T00:00:00.000Z", status: "shipped" as const }

  it("needs a reason, reclaims by default and can skip reclaiming", async () => {
    const user = userEvent.setup()
    const api = createApi({
      orders: vi.fn(async () => ({ items: [shipped], total: 1 })),
      refundOrder: vi.fn(async () => ({ points: 200, reclaimed: 2 })),
    })
    renderPage(<MerchantOrdersPage api={api} />)
    await user.click(await screen.findByRole("button", { name: "退款M1" }))
    const dialog = within(await screen.findByRole("dialog"))
    const confirm = dialog.getByRole("button", { name: "确认退款" })
    expect(confirm).toBeDisabled()
    await user.type(dialog.getByLabelText("退款原因"), " 账号有问题 ")
    await user.click(confirm)
    await waitFor(() =>
      expect(api.refundOrder).toHaveBeenCalledWith(order.id, {
        reason: "账号有问题",
        reclaim: true,
      }),
    )
    expect(await screen.findByText("已退回 200 积分，收回 2 个")).toBeVisible()
  }, 60_000)

  it("keeps the items with the buyer when reclaiming is unticked", async () => {
    const user = userEvent.setup()
    const api = createApi({
      orders: vi.fn(async () => ({ items: [shipped], total: 1 })),
      refundOrder: vi.fn(async () => ({ points: 200, reclaimed: 0 })),
    })
    renderPage(<MerchantOrdersPage api={api} />)
    await user.click(await screen.findByRole("button", { name: "退款M1" }))
    const dialog = within(await screen.findByRole("dialog"))
    await user.type(dialog.getByLabelText("退款原因"), "补偿")
    await user.click(dialog.getByRole("checkbox"))
    await user.click(dialog.getByRole("button", { name: "确认退款" }))
    await waitFor(() =>
      expect(api.refundOrder).toHaveBeenCalledWith(order.id, { reason: "补偿", reclaim: false }),
    )
    expect(await screen.findByText("已退回 200 积分")).toBeVisible()
  }, 60_000)

  it("shows the reason on a refunded order and offers no second refund", async () => {
    const refunded = { ...shipped, cancelReason: "账号有问题", status: "refunded" as const }
    renderPage(
      <MerchantOrdersPage
        api={createApi({ orders: vi.fn(async () => ({ items: [refunded], total: 1 })) })}
      />,
    )
    expect(await screen.findByText("账号有问题")).toBeVisible()
    expect(screen.queryByRole("button", { name: "退款M1" })).toBeNull()
  })
})

describe("ship dialog for a product with an inventory group", () => {
  it("locks the source to that group", async () => {
    const user = userEvent.setup()
    const bound = { ...order, inventoryGroupId: stockGroup, inventoryGroupName: "平台库存" }
    const api = createApi({ orders: vi.fn(async () => ({ items: [bound], total: 1 })) })
    renderPage(<MerchantOrdersPage api={api} />)
    await user.click(await screen.findByRole("button", { name: "发货M1" }))
    const dialog = within(await screen.findByRole("dialog"))
    expect(await dialog.findByText("来源分组：平台库存（商品绑定）")).toBeInTheDocument()
    expect(dialog.queryByRole("combobox", { name: "来源分组" })).toBeNull()
    await waitFor(() =>
      expect(api.transferable).toHaveBeenCalledWith(
        "account",
        expect.objectContaining({ groupId: stockGroup }),
      ),
    )
    await dialog.findByRole("row", { name: /账号1/ })
    await user.click(dialog.getByRole("button", { name: "选中本页" }))
    await user.click(dialog.getByRole("button", { name: "确认发货" }))
    await waitFor(() =>
      expect(api.shipOrder).toHaveBeenCalledWith(
        order.id,
        expect.objectContaining({ sourceGroupId: stockGroup }),
      ),
    )
  }, 60_000)
})

describe("account transfer page", () => {
  it("moves picked accounts after confirming what will be cleared", async () => {
    const user = userEvent.setup()
    const api = createApi({
      transferable: vi.fn(async () => ({
        items: [account(1), account(2, { blockedBy: "in_use", shippable: false })],
        total: 2,
      })),
    })
    renderPage(<AccountTransferPage api={api} />)
    expect(await screen.findByText("先选来源分组，再选要转移的账号")).toBeVisible()
    expect(screen.getByRole("button", { name: "转移" })).toBeDisabled()

    await pickGroup(user, "来源分组", "平台库存")
    const busy = await screen.findByRole("row", { name: /账号2/ })
    expect(within(busy).getByText("正在使用")).toBeVisible()
    expect(within(busy).getByRole("checkbox")).toBeDisabled()

    await user.click(within(screen.getByRole("row", { name: /账号1/ })).getByRole("checkbox"))
    expect(screen.getByRole("button", { name: "转移" })).toBeDisabled()
    await pickGroup(user, "转移到", "买家一")
    await user.click(screen.getByRole("button", { name: "转移" }))

    const dialog = within(await screen.findByRole("dialog"))
    await waitFor(() =>
      expect(dialog.getByText("将 1 个账号从「平台库存」转移到「买家一」。")).toBeVisible(),
    )
    expect(dialog.getByText("账号1")).toBeVisible()
    expect(dialog.getByText(/设备、代理.*标签和备注都会清掉/)).toBeVisible()
    await user.click(dialog.getByRole("button", { name: "确认转移" }))
    await waitFor(() =>
      expect(api.transfer).toHaveBeenCalledWith({
        ids: [account(1).id],
        kind: "account",
        sourceGroupId: stockGroup,
        targetGroupId: buyerGroup,
      }),
    )
    expect(await screen.findByText("已将 1 个账号转移到「买家一」")).toBeVisible()
    expect(screen.getByLabelText("已选数量")).toHaveTextContent("已选 0 个")
  }, 60_000)

  it("keeps picks from other pages and lists them all before moving", async () => {
    const user = userEvent.setup()
    const api = createApi({
      transferable: vi.fn(async (_kind, query) => ({
        items: query.page === 1 ? [account(1)] : [account(2)],
        total: 21,
      })),
    })
    renderPage(<AccountTransferPage api={api} />)
    await pickGroup(user, "来源分组", "平台库存")
    await user.click(
      within(await screen.findByRole("row", { name: /账号1/ })).getByRole("checkbox"),
    )
    await user.click(screen.getByRole("listitem", { name: "2" }))
    await user.click(
      within(await screen.findByRole("row", { name: /账号2/ })).getByRole("checkbox"),
    )
    expect(screen.getByLabelText("已选数量")).toHaveTextContent("已选 2 个")
    await pickGroup(user, "转移到", "买家一")
    await user.click(screen.getByRole("button", { name: "转移" }))
    const dialog = within(await screen.findByRole("dialog"))
    await waitFor(() => expect(dialog.getByText("账号1、账号2")).toBeVisible())
    await user.click(dialog.getByRole("button", { name: "确认转移" }))
    await waitFor(() =>
      expect(api.transfer).toHaveBeenCalledWith(
        expect.objectContaining({ ids: [account(1).id, account(2).id] }),
      ),
    )
  }, 60_000)

  it("clears the search when the source group changes", async () => {
    const user = userEvent.setup()
    const api = createApi()
    renderPage(<AccountTransferPage api={api} />)
    await pickGroup(user, "来源分组", "平台库存")
    await user.type(screen.getByRole("textbox", { name: "搜索" }), "jp")
    await user.click(screen.getByRole("button", { name: "搜索" }))
    await waitFor(() =>
      expect(api.transferable).toHaveBeenLastCalledWith(
        "account",
        expect.objectContaining({ keyword: "jp" }),
      ),
    )
    await pickGroup(user, "来源分组", "买家一")
    expect(screen.getByRole("textbox", { name: "搜索" })).toHaveValue("")
    await waitFor(() =>
      expect(api.transferable).toHaveBeenLastCalledWith(
        "account",
        expect.not.objectContaining({ keyword: "jp" }),
      ),
    )
  }, 60_000)

  it("says so when the items were already moved", async () => {
    const user = userEvent.setup()
    const api = createApi({ transfer: vi.fn(async () => ({ moved: 0, replayed: true })) })
    renderPage(<AccountTransferPage api={api} />)
    await pickGroup(user, "来源分组", "平台库存")
    await user.click(
      within(await screen.findByRole("row", { name: /账号1/ })).getByRole("checkbox"),
    )
    await pickGroup(user, "转移到", "买家一")
    await user.click(screen.getByRole("button", { name: "转移" }))
    const dialog = within(await screen.findByRole("dialog"))
    await user.click(await dialog.findByRole("button", { name: "确认转移" }))
    expect(await screen.findByText("这些账号已经在「买家一」了")).toBeVisible()
  }, 60_000)

  it("does not offer the source group as the target", async () => {
    const user = userEvent.setup()
    renderPage(<AccountTransferPage api={createApi()} />)
    await pickGroup(user, "来源分组", "平台库存")
    await user.click(screen.getByRole("combobox", { name: "转移到" }))
    await screen.findAllByRole("option", { name: "买家一" })
    await waitFor(() => {
      const listbox = screen
        .getAllByRole("listbox")
        .find((item) => within(item).queryByRole("option", { name: "买家一" }) !== null)
      expect(listbox).toBeDefined()
      expect(within(listbox as HTMLElement).queryByRole("option", { name: "平台库存" })).toBeNull()
    })
  }, 60_000)

  it("lists the history with where each move came from", async () => {
    const user = userEvent.setup()
    const api = createApi({
      transfers: vi.fn(async () => ({
        items: [
          {
            createdAt: "2026-11-08T00:00:00.000Z",
            displayName: "账号1",
            entityId: account(1).id,
            id: "cccccccc-0000-4000-8000-000000000001",
            kind: "account" as const,
            movedByName: "平台人员",
            orderNo: null,
            reason: "",
            sourceGroupName: "平台库存",
            targetGroupName: "买家一",
          },
        ],
        total: 1,
      })),
    })
    renderPage(<AccountTransferPage api={api} />)
    await user.click(await screen.findByRole("tab", { name: "转移记录" }))
    const row = await screen.findByRole("row", { name: /账号1/ })
    expect(within(row).getByText("手动转移")).toBeVisible()
    expect(api.transfers).toHaveBeenCalledWith(expect.objectContaining({ kind: "account" }))
  }, 60_000)
})
