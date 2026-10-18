import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { loadChains, resetChains } from "../behaviors/chain-store"
import { RobotsPage } from "./page"
import { createRobotFixtures } from "./robot.test-fixtures"

vi.mock(import("./robot"), async (importOriginal) => ({
  ...(await importOriginal()),
  createSeedRobots: () => createRobotFixtures(),
}))

beforeEach(async () => {
  resetChains()
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      if (input !== "/api/behavior-chains") throw new Error(`Unexpected request: ${String(input)}`)
      return Response.json([
        {
          id: "1",
          lastTestedAt: null,
          name: "早班养号",
          origin: "rpa",
          steps: [],
          updatedAt: "2026-09-17T12:00:00.000Z",
        },
      ])
    }),
  )
  await loadChains()
})

afterEach(() => {
  resetChains()
  vi.unstubAllGlobals()
})

const renderPage = (canWrite = true): void => {
  render(
    <MemoryRouter>
      <AntdApp>
        <RobotsPage canWrite={canWrite} />
      </AntdApp>
    </MemoryRouter>,
  )
}

describe("RobotsPage", () => {
  it("renders all robot cards bound to shared behavior chains", async () => {
    renderPage()

    expect(await screen.findByText("美区养号")).toBeVisible()
    expect(screen.getByText("晚班日更")).toBeVisible()
    expect(screen.getByText("夜间巡检")).toBeVisible()
    expect(screen.getByRole("button", { name: "新增" })).toBeVisible()
    expect(screen.getAllByText(/早班养号/).length).toBeGreaterThan(0)
    expect(screen.queryByText("AI养号")).not.toBeInTheDocument()
    expect(screen.queryByText("全自动养号")).not.toBeInTheDocument()
    expect(screen.queryByText("运营机器人尚未配置")).not.toBeInTheDocument()
  })

  it("hides write actions when canWrite is false but keeps logs", async () => {
    renderPage(false)
    await screen.findByText("美区养号")

    expect(screen.queryByRole("button", { name: "新增" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "立即执行" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "日志" }).length).toBeGreaterThan(0)
  })

  it("creates a robot bound to a behavior chain", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("美区养号")

    await user.click(screen.getByRole("button", { name: "新增" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("名称"), "试运行")
    await user.click(within(dialog).getByLabelText("行为链"))
    await user.click(
      await screen.findByText("早班养号", { selector: ".ant-select-item-option-content" }),
    )
    await user.click(within(dialog).getByRole("button", { name: "确认" }))

    expect(await screen.findByText("新增成功")).toBeVisible()
    expect(screen.getByText("试运行")).toBeVisible()
  })

  it("shows run progress after 立即执行", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("美区养号")

    const card = screen.getByText("美区养号").closest(".robots-card")
    if (!(card instanceof HTMLElement)) throw new Error("missing card")
    await user.click(within(card).getByRole("button", { name: "立即执行" }))

    expect(await screen.findByText("已开始执行")).toBeVisible()
    expect(await screen.findByText("执行中")).toBeVisible()
    expect(await screen.findByText("最近成功")).toBeVisible()
  })
}, 30_000)
