import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { RobotsPage } from "./page"

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
