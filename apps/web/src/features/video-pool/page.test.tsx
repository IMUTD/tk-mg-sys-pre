import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { VideoPoolPage } from "./page"

describe("VideoPoolPage", () => {
  it("renders 云大师 video management filters and works", () => {
    render(
      <MemoryRouter>
        <AntdApp>
          <VideoPoolPage />
        </AntdApp>
      </MemoryRouter>,
    )
    expect(screen.getByLabelText("作品id")).toBeVisible()
    expect(screen.getByLabelText("文案")).toBeVisible()
    expect(screen.getByRole("button", { name: "导出选中" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "UID/作品ID" })).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "封面" })).toBeVisible()
    expect(screen.getByText("74820119301")).toBeVisible()
  })
})
