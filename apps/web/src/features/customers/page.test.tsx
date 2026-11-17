import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { App as AntdApp } from "antd"
import { describe, expect, it, vi } from "vitest"

import type { Customer, CustomerCreate, CustomersApi } from "./api"
import { CustomerPage } from "./page"

const customer: Customer = {
  boxAdminCount: 2,
  boxCount: 5,
  createdAt: new Date("2026-11-18T00:00:00Z"),
  displayName: "客户甲",
  email: "customer@example.test",
  enabled: true,
  groupId: "11111111-1111-4111-8111-111111111111",
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}

const renderPage = (api: CustomersApi): void => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <AntdApp>
      <QueryClientProvider client={queryClient}>
        <CustomerPage api={api} />
      </QueryClientProvider>
    </AntdApp>,
  )
}

describe("CustomerPage", () => {
  it("lists customers with their box administrators and boxes", async () => {
    renderPage({ create: vi.fn(), list: async () => [customer], update: vi.fn() })
    const row = (await screen.findByText("客户甲")).closest("tr")
    if (row === null) throw new Error("missing row")
    expect(within(row).getByText("customer@example.test")).toBeVisible()
    expect(within(row).getByText("2")).toBeVisible()
    expect(within(row).getByText("5")).toBeVisible()
    expect(within(row).getByText("启用")).toBeVisible()
  })

  it("creates a customer after the passwords match", async () => {
    const create = vi.fn(async (_input: CustomerCreate) => customer)
    renderPage({ create, list: async () => [], update: vi.fn() })
    await userEvent.click(await screen.findByRole("button", { name: "新建客户" }))
    const dialog = await screen.findByRole("dialog")
    await userEvent.type(within(dialog).getByLabelText("客户名称"), "客户甲")
    await userEvent.type(within(dialog).getByLabelText("登录邮箱"), "customer@example.test")
    await userEvent.type(within(dialog).getByLabelText("登录密码"), "customer-pass")
    await userEvent.type(within(dialog).getByLabelText("确认密码"), "different-pass")
    await userEvent.click(within(dialog).getByRole("button", { name: "创 建" }))
    expect(await within(dialog).findByText("两次输入的密码不一致")).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()

    await userEvent.clear(within(dialog).getByLabelText("确认密码"))
    await userEvent.type(within(dialog).getByLabelText("确认密码"), "customer-pass")
    await userEvent.click(within(dialog).getByRole("button", { name: "创 建" }))
    await vi.waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0]?.[0]).toEqual({
      displayName: "客户甲",
      email: "customer@example.test",
      password: "customer-pass",
    })
  })
})
