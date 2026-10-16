import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { TaskRecordsPage } from "./records-page"

const wrap = (page: ReactElement): void => {
  render(
    <MemoryRouter>
      <AntdApp>{page}</AntdApp>
    </MemoryRouter>,
  )
}

describe("jobs pages", () => {
  it("lists task records and can search by feature", async () => {
    const user = userEvent.setup()
    wrap(<TaskRecordsPage />)
    expect(screen.getByText("发布作品完成")).toBeVisible()
    await user.type(screen.getByLabelText("功能"), "账号检查")
    expect(screen.getByText("检查任务已创建并自动启动")).toBeVisible()
    expect(screen.queryByText("发布作品完成")).not.toBeInTheDocument()
  })
})
