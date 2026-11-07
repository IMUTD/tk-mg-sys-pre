import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { HTTPError } from "ky"
import type { ReactElement } from "react"
import { describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import type { MallOrderRecord, MallProduct } from "../mall/api"
import type { MerchantApi } from "./api"
import { MerchantOrdersPage } from "./orders-page"
import { MerchantProductsPage } from "./products-page"

const product: MallProduct = {
  createdAt: "2026-11-07T00:00:00.000Z",
  enabled: true,
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  kind: "account",
  minQuantity: 2,
  name: "日本满季度白号",
  pricePoints: 5000,
  spec: "100 个起售",
  stock: 8,
  updatedAt: "2026-11-07T00:00:00.000Z",
}

const order: MallOrderRecord = {
  amountCents: 0,
  buyerName: "一组管理员",
  cancelReason: "",
  cancelledAt: null,
  createdAt: "2026-11-07T00:00:00.000Z",
  description: "100 个起售",
  groupId: "11111111-1111-4111-8111-111111111111",
  groupName: "一组",
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  orderNo: "M20261107AAAA",
  paidAt: "2026-11-07T00:00:00.000Z",
  points: 10000,
  product: "日本满季度白号",
  productKind: "account",
  quantity: 2,
  refundedAt: null,
  shippedAt: null,
  status: "pending_ship",
  title: "资源购买",
  type: "resource",
  unitPoints: 5000,
}

const createApi = (overrides: Partial<MerchantApi> = {}): MerchantApi => ({
  adjust: vi.fn(async () => ({ balance: 0 })),
  cancelOrder: vi.fn(async () => undefined),
  createProduct: vi.fn(async () => product),
  ledger: vi.fn(async () => ({ items: [], total: 0 })),
  orders: vi.fn(async () => ({ items: [order], total: 1 })),
  products: vi.fn(async () => ({ items: [product], total: 1 })),
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
  transferable: vi.fn(async () => ({ items: [], total: 0 })),
  transfers: vi.fn(async () => ({ items: [], total: 0 })),
  updateProduct: vi.fn(async () => product),
  wallets: vi.fn(async () => ({ items: [], total: 0 })),
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

describe("merchant products page", () => {
  it("creates a product and requires a name and a price", async () => {
    const user = userEvent.setup()
    const api = createApi()
    renderPage(<MerchantProductsPage api={api} />)
    await user.click(await screen.findByRole("button", { name: "新增商品" }))
    const dialog = within(await screen.findByRole("dialog"))
    const save = dialog.getByRole("button", { name: "保存" })
    expect(save).toBeDisabled()

    await user.type(dialog.getByLabelText("商品名称"), " 美区新注册号 ")
    expect(save).toBeDisabled()
    await user.type(dialog.getByLabelText("单价"), "3000")
    await user.clear(dialog.getByLabelText("初始库存"))
    await user.type(dialog.getByLabelText("初始库存"), "50")
    await user.tab()
    await user.click(save)

    await waitFor(() => expect(api.createProduct).toHaveBeenCalledTimes(1))
    expect(api.createProduct).toHaveBeenCalledWith({
      inventoryGroupId: null,
      enabled: true,
      kind: "account",
      minQuantity: 1,
      name: "美区新注册号",
      pricePoints: 3000,
      spec: "",
      stock: 50,
    })
    expect(await screen.findByText("商品已新增")).toBeVisible()
  }, 60_000)

  it("binds a product to an inventory group and flags a shortfall", async () => {
    const user = userEvent.setup()
    const groupId = "33333333-3333-4333-8333-333333333333"
    const api = createApi({
      products: vi.fn(async () => ({
        items: [
          {
            ...product,
            available: 3,
            inventoryGroupId: groupId,
            inventoryGroupName: "平台库存",
          },
        ],
        total: 1,
      })),
      wallets: vi.fn(async () => ({
        items: [{ balance: 0, groupId, name: "平台库存" }],
        total: 1,
      })),
    })
    renderPage(<MerchantProductsPage api={api} />)
    expect(await screen.findByText(/平台库存：3/)).toBeVisible()
    expect(screen.getByText("不足")).toBeVisible()

    await user.click(screen.getByRole("button", { name: "编辑日本满季度白号" }))
    const dialog = within(await screen.findByRole("dialog"))
    await user.click(dialog.getByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(api.updateProduct).toHaveBeenCalledWith(
        product.id,
        expect.objectContaining({ inventoryGroupId: groupId }),
      ),
    )
  }, 60_000)

  it("edits a product and sends stock only as a delta", async () => {
    const user = userEvent.setup()
    const api = createApi()
    renderPage(<MerchantProductsPage api={api} />)
    await user.click(await screen.findByRole("button", { name: "编辑日本满季度白号" }))
    const dialog = within(await screen.findByRole("dialog"))
    await waitFor(() => expect(dialog.getByText("当前库存 8，正数补货，负数减少")).toBeVisible())
    expect(dialog.getByLabelText("类型")).toBeDisabled()

    await user.clear(dialog.getByLabelText("库存增减"))
    await user.type(dialog.getByLabelText("库存增减"), "-3")
    await user.tab()
    await user.click(dialog.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(api.updateProduct).toHaveBeenCalledTimes(1))
    const [id, input] = vi.mocked(api.updateProduct).mock.calls[0] ?? []
    expect(id).toBe(product.id)
    expect(input).toMatchObject({ pricePoints: 5000, stockDelta: -3 })
    expect(input).not.toHaveProperty("stock")
  }, 60_000)

  it("omits the stock delta when stock is untouched", async () => {
    const user = userEvent.setup()
    const api = createApi()
    renderPage(<MerchantProductsPage api={api} />)
    await user.click(await screen.findByRole("button", { name: "编辑日本满季度白号" }))
    const dialog = within(await screen.findByRole("dialog"))
    await user.click(dialog.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(api.updateProduct).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.updateProduct).mock.calls[0]?.[1]).not.toHaveProperty("stockDelta")
  })

  it("takes a product off sale", async () => {
    const user = userEvent.setup()
    const api = createApi({ updateProduct: vi.fn(async () => ({ ...product, enabled: false })) })
    renderPage(<MerchantProductsPage api={api} />)
    await user.click(await screen.findByRole("button", { name: "下架日本满季度白号" }))
    await waitFor(() =>
      expect(api.updateProduct).toHaveBeenCalledWith(product.id, { enabled: false }),
    )
    expect(await screen.findByText("已下架")).toBeVisible()
  })
})

describe("merchant orders page", () => {
  it("lists only resource orders and shows the buyer", async () => {
    const api = createApi()
    renderPage(<MerchantOrdersPage api={api} />)
    expect(await screen.findByText("M20261107AAAA")).toBeVisible()
    expect(screen.getByText("一组（一组管理员）")).toBeVisible()
    expect(screen.getByText("10,000 积分")).toBeVisible()
    expect(api.orders).toHaveBeenCalledWith({ page: 1, pageSize: 20, type: "resource" })
  })

  it("requires a reason and cancels with a refund message", async () => {
    const user = userEvent.setup()
    const api = createApi()
    renderPage(<MerchantOrdersPage api={api} />)
    await user.click(await screen.findByRole("button", { name: "取消订单M20261107AAAA" }))
    const dialog = within(await screen.findByRole("dialog"))
    const confirm = dialog.getByRole("button", { name: "确认取消" })
    expect(confirm).toBeDisabled()
    await user.type(dialog.getByLabelText("取消原因"), " 缺货 ")
    await user.click(confirm)
    await waitFor(() => expect(api.cancelOrder).toHaveBeenCalledWith(order.id, "缺货"))
    expect(await screen.findByText("已取消，10,000 积分已退回「一组」")).toBeVisible()
  })

  it("explains when an order can no longer be cancelled", async () => {
    const user = userEvent.setup()
    const cancelOrder = vi
      .fn<MerchantApi["cancelOrder"]>()
      .mockRejectedValue(
        new HTTPError(
          Response.json({ error: "order_not_cancellable" }, { status: 409 }),
          new Request("http://localhost/api"),
          {} as never,
        ),
      )
    renderPage(<MerchantOrdersPage api={createApi({ cancelOrder })} />)
    await user.click(await screen.findByRole("button", { name: "取消订单M20261107AAAA" }))
    const dialog = within(await screen.findByRole("dialog"))
    await user.type(dialog.getByLabelText("取消原因"), "缺货")
    await user.click(dialog.getByRole("button", { name: "确认取消" }))
    expect(await screen.findByText("这笔订单已发货或不能取消")).toBeVisible()
  })

  it("shows why a cancelled order was cancelled and offers no action", async () => {
    const cancelled = { ...order, cancelReason: "缺货", status: "cancelled" as const }
    renderPage(
      <MerchantOrdersPage
        api={createApi({ orders: async () => ({ items: [cancelled], total: 1 }) })}
      />,
    )
    expect(await screen.findByText("缺货")).toBeVisible()
    expect(screen.queryByRole("button", { name: "确认发货" })).not.toBeInTheDocument()
  })
})
