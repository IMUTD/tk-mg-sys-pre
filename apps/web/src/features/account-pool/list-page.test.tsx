import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { createPoolTestApi, poolTestGroup } from "../../test/account-pool-fixtures"
import * as labelsApi from "../labels/api"
import * as poolApi from "./api"
import { AccountPoolListPage } from "./list-page"

const renderPage = (canWrite = true, canDelete = true) =>
  render(
    <MemoryRouter>
      <AntdApp>
        <AccountPoolListPage canWrite={canWrite} canDelete={canDelete} groupId={poolTestGroup} />
      </AntdApp>
    </MemoryRouter>,
  )

const rowByText = (text: string): HTMLElement => {
  const row = screen.getAllByRole("row").find((item) => item.textContent?.includes(text))
  if (row === undefined) throw new Error(`missing row ${text}`)
  return row
}

describe("AccountPoolListPage", () => {
  let state: ReturnType<typeof createPoolTestApi>
  beforeEach(() => {
    state = createPoolTestApi()
    vi.spyOn(poolApi, "createAccountPoolsApi").mockReturnValue(state.api)
    vi.spyOn(labelsApi, "createLabelsApi").mockReturnValue({
      list: async (_page, scope = "account") => ({
        groups: [],
        remarks: [],
        canDelete: false,
        administratorId: null,
        scope,
      }),
      create: vi.fn(),
      remove: vi.fn(),
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders 云大师账号池 filters, columns and API records", async () => {
    renderPage()

    expect(await screen.findByText("1107发布")).toBeVisible()
    expect(screen.getByLabelText("ID")).toBeVisible()
    expect(screen.getByLabelText("编码")).toBeVisible()
    expect(screen.getByLabelText("备注")).toBeVisible()
    expect(screen.getByRole("button", { name: "搜索" })).toBeVisible()
    expect(screen.getByRole("button", { name: "新增" })).toBeVisible()
    expect(screen.getByRole("button", { name: "创建账号池" })).toBeVisible()
    expect(screen.getByRole("button", { name: "什么是账号池?" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "备份方式" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "绑定设备" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "分析" })).toBeVisible()
    expect(screen.getByText("1107养号")).toBeVisible()
    expect(screen.getByText("gen-1108测试")).toBeVisible()
    expect(screen.getAllByText("发布任务池")[0]).toBeVisible()
    expect(within(rowByText("1107发布")).getByRole("button", { name: "复制" })).toBeVisible()
    expect(
      within(rowByText("gen-1108测试")).queryByRole("button", { name: "复制" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "租用" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "归还" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "新建账号池" })).not.toBeInTheDocument()
    expect(screen.queryByText("Acc#SeedAlpha")).not.toBeInTheDocument()
  })

  it("hides write actions when canWrite is false", async () => {
    renderPage(false)
    await screen.findByText("1107发布")

    expect(screen.queryByRole("button", { name: "新增" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "创建账号池" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "什么是账号池?" })).toBeVisible()
    expect(screen.getAllByRole("button", { name: "数据统计" }).length).toBeGreaterThan(0)
  })

  it("creates a pool from 新增 without showing secrets", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("1107发布")

    await user.click(screen.getByRole("button", { name: "新增" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("新增账号池")).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText("账号池名"), "1109矩阵")
    await user.click(within(dialog).getByLabelText("设备"))
    await user.click(await screen.findByRole("option", { name: "192.168.76.130-270-亮18" }))
    await user.click(within(dialog).getByLabelText("账号分组"))
    await user.click(await screen.findByRole("option", { name: /亮2/ }))
    await user.click(within(dialog).getByRole("button", { name: "确认" }))

    expect(await screen.findByText("新增成功")).toBeVisible()
    expect(screen.getByText("1109矩阵")).toBeVisible()
    expect(screen.queryByText("Acc#SeedAlpha")).not.toBeInTheDocument()
    expect(state.writes).toHaveLength(1)
    expect(state.writes[0]).toMatchObject({
      key: "1109矩阵",
      mode: "all",
      filter: { tag: ["亮2"] },
    })
    const saved = await state.api.list(poolTestGroup, {
      id: "",
      key: "1109矩阵",
      remark: "",
      page: 1,
      pageSize: 10,
    })
    expect(saved.total).toBe(1)
  })

  it("creates a pool from selected API accounts", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("1107发布")

    await user.click(screen.getByRole("button", { name: "创建账号池" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("创建账号池")).toBeInTheDocument()
    await user.click(within(dialog).getByLabelText("创建设备"))
    await user.click(await screen.findByRole("option", { name: "192.168.76.130-270-亮18" }))
    await user.click(within(dialog).getByLabelText("选择账号 184992211"))
    await user.click(within(dialog).getByRole("button", { name: /新建选中/ }))

    expect(await screen.findByText("新建成功")).toBeVisible()
    expect(await screen.findByText("gen-104")).toBeVisible()
    expect(state.writes[0]).toMatchObject({
      mode: "selected",
      accountIds: ["aaaaaaaa-aaaa-4aaa-8aaa-000000000001"],
    })
  })

  it("filters by encoding without rendering passwords", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("1107养号")

    await user.type(screen.getByLabelText("编码"), "养号")
    await user.click(screen.getByRole("button", { name: "搜索" }))

    await waitFor(() => expect(screen.queryByText("1107发布")).not.toBeInTheDocument())
    expect(await screen.findByText("1107养号")).toBeVisible()
    expect(screen.queryByText("Acc#SeedTravel")).not.toBeInTheDocument()
  })

  it("opens help and persisted account list dialogs", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("1107发布")

    await user.click(screen.getByRole("button", { name: "什么是账号池?" }))
    const help = await screen.findByRole("dialog")
    expect(within(help).getByText("1. 简单介绍")).toBeInTheDocument()
    await user.keyboard("{Escape}")
    expect(screen.queryByText("1. 简单介绍")).not.toBeInTheDocument()

    await user.click(within(rowByText("1107发布")).getByRole("button", { name: "账号列表" }))
    const list = await screen.findByRole("dialog")
    expect(within(list).getByText("账号列表")).toBeInTheDocument()
    expect(within(list).getByText("user.alpha")).toBeInTheDocument()
    expect(within(list).queryByText("Acc#SeedAlpha")).not.toBeInTheDocument()
  })

  it("retains saved pools after remount instead of storing them only in React", async () => {
    await state.api.create(poolTestGroup, {
      filter: (await state.api.details(poolTestGroup, "cccccccc-cccc-4ccc-8ccc-000000000101"))
        .filterCondition ?? {
        backType: "3",
        deviceId: null,
        deviceSeq: null,
        online: null,
        status: "",
        tag: [],
        tagInclude: [],
        tagExclude: [],
        tagQueryMode: "AND",
      },
      key: "持久化验收",
      mode: "all",
      remark: "",
      times: 3,
    })
    const view = renderPage()
    expect(await screen.findByText("持久化验收")).toBeVisible()
    view.unmount()
    renderPage()
    expect(await screen.findByText("持久化验收")).toBeVisible()
  })

  it("preserves UUID selections across candidate pages", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("1107发布")
    await user.click(screen.getByRole("button", { name: "创建账号池" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByLabelText("创建设备"))
    await user.click(await screen.findByRole("option", { name: "192.168.76.130-270-亮18" }))
    await user.click(await within(dialog).findByLabelText("选择账号 184992211"))
    await user.click(within(dialog).getByTitle("2"))
    await user.click(await within(dialog).findByLabelText("选择账号 SIM-11"))
    await user.click(within(dialog).getByRole("button", { name: "新建选中(2)" }))
    expect(await screen.findByText("新建成功")).toBeVisible()
    expect(state.writes[0]?.accountIds).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
      "aaaaaaaa-aaaa-4aaa-8aaa-000000000011",
    ])
  })

  it("keeps the dialog and shows failure without inventing a successful write", async () => {
    vi.spyOn(state.api, "create").mockRejectedValue(new Error("offline"))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("1107发布")
    await user.click(screen.getByRole("button", { name: "创建账号池" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByLabelText("创建设备"))
    await user.click(await screen.findByRole("option", { name: "192.168.76.130-270-亮18" }))
    await within(dialog).findByLabelText("选择账号 184992211")
    await user.click(within(dialog).getByRole("button", { name: "新建所有(12)" }))
    expect(await screen.findByText("账号池请求失败")).toBeVisible()
    expect(screen.getByRole("dialog")).toBeVisible()
    expect(screen.queryByText("新建成功")).not.toBeInTheDocument()
    expect(state.writes).toHaveLength(0)
  })

  it("shows candidate-read errors and prevents creating from a failed read", async () => {
    vi.spyOn(state.api, "sources").mockRejectedValue(new Error("offline"))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("1107发布")
    await user.click(screen.getByRole("button", { name: "创建账号池" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByLabelText("创建设备"))
    await user.click(await screen.findByRole("option", { name: "192.168.76.130-270-亮18" }))
    expect(await within(dialog).findByText("候选账号加载失败")).toBeVisible()
    expect(within(dialog).getByRole("button", { name: /新建所有/ })).toBeDisabled()
    expect(state.writes).toHaveLength(0)
  })

  it("loads persisted round progress and differentiates stored statistics from unqueried data", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("1107发布")
    await user.click(within(rowByText("1107发布")).getByRole("button", { name: "消耗进度" }))
    const dialog = await screen.findByRole("dialog")
    await waitFor(() => expect(within(dialog).getByText("1107发布_1")).toBeVisible())
    expect(within(dialog).getByText("1 / 2")).toBeVisible()
    expect(within(dialog).getByText("2 / 2")).toBeVisible()
    expect(within(dialog).getAllByRole("button", { name: "导出未使用" })).toHaveLength(3)
    await user.keyboard("{Escape}")
    await user.click(within(rowByText("1107发布")).getByRole("button", { name: "数据统计" }))
    const stats = await screen.findByRole("dialog")
    await waitFor(() => expect(within(stats).getByText("未查询")).toBeVisible())
    expect(within(stats).getByText("已存数据")).toBeVisible()
    expect(within(stats).queryByText("查询成功")).not.toBeInTheDocument()
  })

  it("deletes through the API and does not reappear after remount", async () => {
    const remove = vi.spyOn(state.api, "remove")
    const user = userEvent.setup()
    const view = renderPage()
    await screen.findByText("1107发布")
    await user.click(within(rowByText("1107发布")).getByRole("button", { name: "删除" }))
    await user.click(await screen.findByRole("button", { name: "确定" }))
    expect(await screen.findByText("删除成功")).toBeVisible()
    expect(remove).toHaveBeenCalledWith(poolTestGroup, ["cccccccc-cccc-4ccc-8ccc-000000000101"])
    await waitFor(() => expect(screen.queryByText("1107发布")).not.toBeInTheDocument())
    view.unmount()
    renderPage()
    await screen.findByText("1107养号")
    expect(screen.queryByText("1107发布")).not.toBeInTheDocument()
  })

  it("hides delete actions separately from write permission", async () => {
    renderPage(true, false)
    await screen.findByText("1107发布")
    expect(screen.getByRole("button", { name: "新增" })).toBeVisible()
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument()
  })
}, 30_000)
