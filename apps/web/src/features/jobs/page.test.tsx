import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { BackgroundJobsPage } from "./background-page"
import { TaskRecordsPage } from "./records-page"

const wrap = (page: ReactElement): void => {
  render(
    <MemoryRouter>
      <AntdApp>{page}</AntdApp>
    </MemoryRouter>,
  )
}

describe("jobs pages", () => {
  it("lists background jobs with stats and start action", async () => {
    const user = userEvent.setup()
    wrap(<BackgroundJobsPage />)
    expect(screen.getByText("总任务数")).toBeVisible()
    expect(screen.getByText("账号状态更新-批量-2026-09-17 09:54:42")).toBeVisible()
    expect(screen.getByRole("button", { name: "添加后台任务" })).toBeVisible()
    const start = screen.getAllByRole("button", { name: "启动" })[0]
    if (start === undefined) throw new Error("missing start")
    await user.click(start)
    expect(await screen.findByText("已启动")).toBeVisible()
  })

  it("lists task records and can search by feature", async () => {
    const user = userEvent.setup()
    wrap(<TaskRecordsPage />)
    expect(screen.getByText("发布作品完成")).toBeVisible()
    await user.type(screen.getByLabelText("功能"), "账号检查")
    await user.click(screen.getByRole("button", { name: "搜索" }))
    expect(screen.getByText("检查任务已创建并自动启动")).toBeVisible()
    expect(screen.queryByText("发布作品完成")).not.toBeInTheDocument()
  })
})
