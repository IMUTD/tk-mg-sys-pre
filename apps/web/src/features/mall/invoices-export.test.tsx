import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import type { InvoiceRecord, MallApi } from "./api"
import { createMallApiFixture, createOrderFixtures, mallGroupId } from "./catalog.test-fixtures"
import { toCsv } from "./export-csv"
import { MallInvoicesPage } from "./invoices-page"
import { MallOrdersPage } from "./orders-page"
import { MallRecordsPage } from "./records-page"

const wrap = (page: ReactElement): void => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AntdApp>{page}</AntdApp>
    </QueryClientProvider>,
  )
}

const invoice: InvoiceRecord = {
  amountCents: 1000,
  applicantName: "一组管理员",
  createdAt: "2026-11-07T00:00:00.000Z",
  groupId: mallGroupId,
  groupName: "一组",
  hasFile: true,
  id: "eeeeeeee-0000-4000-8000-000000000001",
  invoiceNumber: "N1",
  invoiceType: "normal",
  rejectReason: "",
  remark: "",
  reviewedAt: "2026-11-08T00:00:00.000Z",
  status: "issued",
  taxNumber: "91310000MA1K123456",
  title: "上海某公司",
  titleType: "company",
  updatedAt: "2026-11-08T00:00:00.000Z",
}

describe("invoice application", () => {
  const openDialog = async (overrides: Partial<MallApi> = {}) => {
    const user = userEvent.setup()
    const createInvoice = vi.fn<MallApi["createInvoice"]>(async () => invoice)
    wrap(<MallInvoicesPage api={createMallApiFixture({ createInvoice, ...overrides })} />)
    await screen.findByText("可开票 ¥100")
    await user.click(screen.getByRole("button", { name: "新增" }))
    const dialog = within(await screen.findByRole("dialog"))
    const submit = dialog.getByRole("button", { name: "提交" })
    return { createInvoice, dialog, submit, user }
  }

  it("requires a valid tax number from a company and sends it in capitals", async () => {
    const { createInvoice, dialog, submit, user } = await openDialog()
    await user.type(dialog.getByLabelText("开票金额"), "10")
    await user.type(dialog.getByLabelText("发票抬头"), " 上海某公司 ")
    expect(submit).toBeDisabled()
    await user.type(dialog.getByLabelText("税号"), "abc")
    expect(submit).toBeDisabled()
    await user.clear(dialog.getByLabelText("税号"))
    await user.type(dialog.getByLabelText("税号"), "91310000ma1k123456")
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)
    await waitFor(() =>
      expect(createInvoice).toHaveBeenCalledWith(
        mallGroupId,
        expect.objectContaining({
          amountYuan: "10",
          invoiceType: "normal",
          taxNumber: "91310000MA1K123456",
          title: "上海某公司",
          titleType: "company",
        }),
      ),
    )
    expect(await screen.findByText("已提交，等待平台审核")).toBeVisible()
  }, 60_000)

  it("hides the tax number and invoice type for a person", async () => {
    const { createInvoice, dialog, submit, user } = await openDialog()
    await waitFor(() => expect(dialog.getByLabelText("税号")).toBeVisible())
    await user.click(dialog.getByRole("combobox", { name: "抬头类型" }))
    await user.click((await screen.findAllByRole("option", { name: "个人" })).at(-1) as HTMLElement)
    await waitFor(() => expect(dialog.queryByLabelText("税号")).toBeNull())
    expect(dialog.queryByRole("combobox", { name: "发票类型" })).toBeNull()
    await user.type(dialog.getByLabelText("开票金额"), "1")
    await user.type(dialog.getByLabelText("发票抬头"), "张三")
    await user.click(submit)
    await waitFor(() =>
      expect(createInvoice).toHaveBeenCalledWith(
        mallGroupId,
        expect.objectContaining({ invoiceType: "normal", taxNumber: "", titleType: "personal" }),
      ),
    )
  }, 60_000)

  it("refuses more than the available amount", async () => {
    const { dialog, submit, user } = await openDialog()
    await user.type(dialog.getByLabelText("开票金额"), "100.01")
    await user.type(dialog.getByLabelText("发票抬头"), "上海某公司")
    await user.type(dialog.getByLabelText("税号"), "91310000MA1K123456")
    expect(await dialog.findByText("超过可开票金额")).toBeInTheDocument()
    expect(submit).toBeDisabled()
  }, 60_000)

  it("shows the result and a download link", async () => {
    const invoiceFileUrl = vi.fn(() => "/api/download")
    wrap(
      <MallInvoicesPage
        api={createMallApiFixture({
          invoiceFileUrl,
          invoices: async () => ({
            items: [
              invoice,
              { ...invoice, hasFile: false, id: "x", rejectReason: "抬头不对", status: "rejected" },
            ],
            total: 2,
          }),
        })}
      />,
    )
    expect(await screen.findByText("发票号码 N1")).toBeVisible()
    expect(screen.getByText("抬头不对")).toBeVisible()
    expect(screen.getByRole("link", { name: "下载" })).toHaveAttribute("href", "/api/download")
    expect(screen.getAllByRole("link")).toHaveLength(1)
  })
})

describe("order export", () => {
  afterEach(() => vi.restoreAllMocks())

  it("guards spreadsheet formulas and quotes separators", () => {
    const csv = toCsv(
      ["a"],
      [["=SUM(A1)"], ["-1"], ["x,y"], ['say "hi"'], ["line\nbreak"], ["普通"]],
    )
    expect(csv.startsWith("﻿")).toBe(true)
    expect(csv).toContain("'=SUM(A1)")
    expect(csv).toContain("'-1")
    expect(csv).toContain('"x,y"')
    expect(csv).toContain('"say ""hi"""')
    expect(csv).toContain('"line\nbreak"')
    expect(csv).toContain("普通")
  })

  it("exports every page, not just the visible one", async () => {
    const user = userEvent.setup()
    const created: Blob[] = []
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      created.push(blob as Blob)
      return "blob:fixture"
    })
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    const [first, second] = createOrderFixtures()
    if (first === undefined || second === undefined) throw new Error("missing fixtures")
    const orders = vi.fn<MallApi["orders"]>(async (_group, query) => ({
      items: query.page === 1 ? [first] : [second],
      total: 2,
    }))
    wrap(<MallOrdersPage api={createMallApiFixture({ orders })} />)
    await user.click(await screen.findByRole("button", { name: "导出" }))
    expect(await screen.findByText("已导出 2 条订单")).toBeVisible()
    expect(click).toHaveBeenCalledTimes(1)
    const text = await created[0]?.text()
    expect(text).toContain(first.orderNo)
    expect(text).toContain(second.orderNo)
    expect(orders).toHaveBeenCalledWith(
      mallGroupId,
      expect.objectContaining({ page: 2, pageSize: 100 }),
    )
  }, 60_000)

  it("says so when there is nothing to export", async () => {
    const user = userEvent.setup()
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    const orders = vi.fn<MallApi["orders"]>(async () => ({ items: [], total: 0 }))
    wrap(<MallOrdersPage api={createMallApiFixture({ orders })} />)
    await user.click(await screen.findByRole("button", { name: "导出" }))
    expect(await screen.findByText("没有可导出的订单")).toBeVisible()
    expect(click).not.toHaveBeenCalled()
  }, 60_000)
})

describe("alipay recharge", () => {
  it("offers recharge only when Alipay is configured", async () => {
    wrap(<MallRecordsPage api={createMallApiFixture()} />)
    await screen.findByRole("button", { name: "搜索" })
    await waitFor(() => expect(screen.queryByRole("button", { name: "充值" })).toBeNull())
  })

  it("creates one order, links to Alipay and confirms the result", async () => {
    const user = userEvent.setup()
    const createRecharge = vi.fn<MallApi["createRecharge"]>(async () => ({
      amountCents: 10000,
      orderNo: "A1",
      payUrl: "https://gateway.invalid/pay",
      points: 10000,
      status: "unpaid",
    }))
    const rechargeStatus = vi
      .fn<MallApi["rechargeStatus"]>()
      .mockResolvedValueOnce({ amountCents: 10000, orderNo: "A1", points: 10000, status: "unpaid" })
      .mockResolvedValueOnce({ amountCents: 10000, orderNo: "A1", points: 10000, status: "paid" })
    wrap(
      <MallRecordsPage
        api={createMallApiFixture({
          createRecharge,
          paymentConfig: async () => ({ alipay: true }),
          rechargeStatus,
        })}
      />,
    )
    await user.click(await screen.findByRole("button", { name: "充值" }))
    const dialog = within(await screen.findByRole("dialog"))
    const go = dialog.getByRole("button", { name: "去支付宝付款" })
    expect(go).toBeDisabled()
    await user.type(dialog.getByLabelText("充值金额"), "100")
    expect(await dialog.findByText("到账 10,000 积分")).toBeInTheDocument()
    await user.click(go)
    const link = await dialog.findByRole("link", { name: "打开支付宝付款" })
    expect(link).toHaveAttribute("href", "https://gateway.invalid/pay")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")

    await user.click(dialog.getByRole("button", { name: "我已付款，查询结果" }))
    expect(await screen.findByText("支付宝还没有收到这笔付款")).toBeVisible()
    await user.click(dialog.getByRole("button", { name: "我已付款，查询结果" }))
    expect(await screen.findByText("已到账 10,000 积分")).toBeVisible()
    expect(createRecharge).toHaveBeenCalledTimes(1)
  }, 60_000)
})
