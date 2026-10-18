import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { TaskListPage } from "./list-page"

import * as taskData from "./myt-task"
import {
  createTaskDeviceFixtures,
  createTaskFixtures,
  createTaskScriptFixtures,
} from "./myt-task.test-fixtures"

afterEach(() => vi.unstubAllGlobals())

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost")
      if (url.pathname !== "/api/labels/catalog")
        throw new Error(`Unexpected task API request: ${url.pathname}`)
      return Response.json({
        administratorId: null,
        canDelete: false,
        scope: "device",
        groups: [],
        remarks: [],
      })
    }),
  )
  vi.spyOn(taskData, "createSeedTasks").mockImplementation(createTaskFixtures)
  vi.spyOn(taskData, "createSeedTaskDevices").mockImplementation(createTaskDeviceFixtures)
  vi.spyOn(taskData, "createSeedTaskScripts").mockImplementation(createTaskScriptFixtures)
})

const renderPage = (canWrite = true, path = "/operations/tasks"): void => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AntdApp>
        <TaskListPage canWrite={canWrite} />
      </AntdApp>
    </MemoryRouter>,
  )
}

const rowByText = (text: string): HTMLElement => {
  const row = screen.getAllByRole("row").find((item) => item.textContent?.includes(text))
  if (row === undefined) throw new Error(`missing row ${text}`)
  return row
}

describe("TaskListPage", () => {
  it("renders 云大师任务列表 filters, columns and seed tasks", async () => {
    renderPage()

    expect(await screen.findByText("5001")).toBeVisible()
    expect(screen.getByLabelText("任务ID")).toBeVisible()
    expect(screen.getByLabelText("任务名")).toBeVisible()
    expect(screen.getByLabelText("功能")).toBeVisible()
    expect(screen.getByLabelText("设备")).toBeVisible()
    expect(screen.getByLabelText("机位")).toBeVisible()
    expect(screen.getByLabelText("状态")).toBeVisible()
    expect(screen.getByLabelText("模板")).toBeVisible()
    expect(screen.getByLabelText("主任务")).toBeVisible()
    expect(screen.getByRole("button", { name: "搜索" })).toBeVisible()
    expect(screen.getByRole("button", { name: "新增" })).toBeVisible()
    expect(screen.getByRole("button", { name: /查看正在执行/ })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "展开子任务" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "执行进度" })).toBeVisible()
    expect(screen.getByText("5002")).toBeVisible()
    expect(screen.getByText("养号任务")).toBeVisible()
    expect(
      screen.getByText("任务历史数据仅保留30天。任务下发后,大约需要1分钟时间准备数据,请耐心等待"),
    ).toBeVisible()
    expect(screen.queryByRole("button", { name: "新建任务" })).not.toBeInTheDocument()
    expect(screen.queryByText("排队中")).not.toBeInTheDocument()
  })

  it("keeps running-task inspection for read-only operators", async () => {
    renderPage(false)
    await screen.findByText("5001")

    expect(screen.getByRole("button", { name: /查看正在执行/ })).toBeEnabled()
    expect(screen.queryByRole("button", { name: "新增" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "启动" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "终止" })).not.toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "日志" }).length).toBeGreaterThan(0)
  })

  it("creates a task from 新增 without auto-start", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("5001")

    await user.click(screen.getByRole("button", { name: "新增" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("新增任务")).toBeInTheDocument()
    await user.click(within(dialog).getByLabelText("功能"))
    await user.click(await screen.findByText("养号 (v2.0.1)"))
    await user.click(within(dialog).getByLabelText("设备"))
    await user.click(await screen.findByText("192.168.76.130-270-亮18"))
    await user.keyboard("{Escape}")
    await user.click(within(dialog).getByLabelText("机位"))
    await user.click(await screen.findByTitle("2"))
    await user.click(within(dialog).getByRole("button", { name: "确认" }))

    expect(await screen.findByText("新增成功，请在列表手动启动")).toBeVisible()
    expect(screen.getByText("5007")).toBeVisible()
  })

  it("starts an idle task from the row action", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("5001")

    await user.click(within(rowByText("5001")).getByRole("button", { name: "启动" }))
    expect(await screen.findByText("已启动任务")).toBeVisible()
    expect(within(rowByText("5001")).getByText("执行中")).toBeVisible()
  })

  it("opens logs and the running-task dialog", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("养号任务")

    await user.click(within(rowByText("5003")).getByRole("button", { name: "日志" }))
    const logs = await screen.findByRole("dialog")
    expect(within(logs).getByText(/开始执行 养号/)).toBeInTheDocument()
    const closeButtons = within(logs).getAllByRole("button", { name: "关闭" })
    const closeButton = closeButtons[closeButtons.length - 1]
    if (closeButton === undefined) throw new Error("missing close button")
    await user.click(closeButton)

    await user.click(screen.getByRole("button", { name: /查看正在执行/ }))
    const running = await screen.findByRole("dialog")
    expect(within(running).getByText("查询设备")).toBeInTheDocument()
    expect(within(running).getByText("养号任务")).toBeInTheDocument()
  })

  it("opens 新增任务 from a device deep link", async () => {
    renderPage(true, "/operations/tasks?scriptId=61&deviceId=23849&deviceSeq=1")

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByLabelText("任务名")).toHaveValue("升级中控")
  })
}, 30_000)
