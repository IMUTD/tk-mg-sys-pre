import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { HTTPError } from "ky"
import { describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import type { InvoiceRecord } from "../mall/api"
import type { MerchantApi } from "./api"
import { MerchantInvoicesPage } from "./invoices-page"

const invoice: InvoiceRecord = {
  amountCents: 1000,
  applicantName: "一组管理员",
  createdAt: "2026-11-07T00:00:00.000Z",
  groupId: "11111111-1111-4111-8111-111111111111",
  groupName: "一组",
  hasFile: false,
  id: "eeeeeeee-0000-4000-8000-000000000001",
  invoiceNumber: "",
  invoiceType: "normal",
  rejectReason: "",
  remark: "",
  reviewedAt: null,
  status: "pending",
  taxNumber: "91310000MA1K123456",
  title: "上海某公司",
  titleType: "company",
  updatedAt: "2026-11-07T00:00:00.000Z",
}

const createApi = (overrides: Partial<MerchantApi> = {}) =>
  ({
    invoiceFileUrl: vi.fn(() => "/api/download"),
    invoices: vi.fn(async () => ({ items: [invoice], total: 1 })),
    issueInvoice: vi.fn(async () => ({ ...invoice, status: "issued" as const })),
    rejectInvoice: vi.fn(async () => ({ ...invoice, status: "rejected" as const })),
    ...overrides,
  }) as unknown as MerchantApi

const renderPage = (api: MerchantApi): void => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AntdApp>
        <MerchantInvoicesPage api={api} />
      </AntdApp>
    </QueryClientProvider>,
  )
}

describe("merchant invoice review", () => {
  it("starts on the pending queue and shows the tax number", async () => {
    const api = createApi()
    renderPage(api)
    expect(await screen.findByText("91310000MA1K123456")).toBeVisible()
    expect(api.invoices).toHaveBeenCalledWith(expect.objectContaining({ status: "pending" }))
  })

  it("issues with a number and uploads the PDF", async () => {
    const user = userEvent.setup()
    const api = createApi()
    renderPage(api)
    await user.click(await screen.findByRole("button", { name: "开具上海某公司" }))
    const dialog = within(await screen.findByRole("dialog"))
    const confirm = dialog.getByRole("button", { name: "确认开具" })
    expect(confirm).toBeDisabled()
    await user.type(dialog.getByLabelText("发票号码"), " N1 ")
    const file = new File(["%PDF-1"], "a.pdf", { type: "application/pdf" })
    await user.upload(dialog.getByLabelText("发票文件"), file)
    await user.click(confirm)
    await waitFor(() =>
      expect(api.issueInvoice).toHaveBeenCalledWith(invoice.id, { file, invoiceNumber: "N1" }),
    )
    expect(await screen.findByText("发票已开具")).toBeVisible()
  }, 60_000)

  it("refuses a file over 5MB before sending it", async () => {
    const user = userEvent.setup()
    const api = createApi()
    renderPage(api)
    await user.click(await screen.findByRole("button", { name: "开具上海某公司" }))
    const dialog = within(await screen.findByRole("dialog"))
    await user.type(dialog.getByLabelText("发票号码"), "N1")
    const big = new File(["%PDF-1"], "a.pdf", { type: "application/pdf" })
    Object.defineProperty(big, "size", { value: 5 * 1024 * 1024 + 1 })
    await user.upload(dialog.getByLabelText("发票文件"), big)
    expect(await dialog.findByText("文件超过 5MB")).toBeInTheDocument()
    expect(dialog.getByRole("button", { name: "确认开具" })).toBeDisabled()
  }, 60_000)

  it("requires a reason to reject", async () => {
    const user = userEvent.setup()
    const api = createApi()
    renderPage(api)
    await user.click(await screen.findByRole("button", { name: "驳回上海某公司" }))
    const dialog = within(await screen.findByRole("dialog"))
    const confirm = dialog.getByRole("button", { name: "确认驳回" })
    expect(confirm).toBeDisabled()
    await user.type(dialog.getByLabelText("驳回原因"), " 抬头不对 ")
    await user.click(confirm)
    await waitFor(() => expect(api.rejectInvoice).toHaveBeenCalledWith(invoice.id, "抬头不对"))
    expect(await screen.findByText("已驳回，额度已退回")).toBeVisible()
  }, 60_000)

  it("explains when someone else already handled it", async () => {
    const user = userEvent.setup()
    const api = createApi({
      rejectInvoice: vi.fn(async () => {
        throw new HTTPError(
          Response.json({ error: "invoice_not_pending" }, { status: 409 }),
          new Request("http://localhost/api"),
          {} as never,
        )
      }),
    })
    renderPage(api)
    await user.click(await screen.findByRole("button", { name: "驳回上海某公司" }))
    const dialog = within(await screen.findByRole("dialog"))
    await user.type(dialog.getByLabelText("驳回原因"), "晚了")
    await user.click(dialog.getByRole("button", { name: "确认驳回" }))
    expect(await screen.findByText("这张发票已经处理过了")).toBeVisible()
  }, 60_000)

  it("shows the number and a download link once issued", async () => {
    renderPage(
      createApi({
        invoices: vi.fn(async () => ({
          items: [{ ...invoice, hasFile: true, invoiceNumber: "N9", status: "issued" as const }],
          total: 1,
        })),
      }),
    )
    expect(await screen.findByText("N9")).toBeVisible()
    expect(screen.getByRole("link", { name: "下载" })).toHaveAttribute("href", "/api/download")
    expect(screen.queryByRole("button", { name: "开具上海某公司" })).toBeNull()
  })
})
