import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { OverviewPage } from "./page"
import { overviewCounts } from "./stats"

describe("overview counts", () => {
  it("sums devices, all accounts, and video/image/text resources", () => {
    const counts = overviewCounts()
    expect(counts.devices).toBe(8)
    expect(counts.accounts).toBe(8)
    expect(counts.resources).toBe(8)
  })

  it("renders the three count cards", () => {
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    )
    expect(screen.getByText("设备数量")).toBeVisible()
    expect(screen.getByText("账号数量")).toBeVisible()
    expect(screen.getByText("资源数量")).toBeVisible()
    expect(screen.queryByText("等待数据")).not.toBeInTheDocument()
    expect(screen.queryByText("设备状态")).not.toBeInTheDocument()
    expect(screen.queryByText("进行中任务")).not.toBeInTheDocument()
  })
})
