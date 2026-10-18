import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { VideoPoolPage } from "./page"

vi.mock(import("./catalog"), async (importOriginal) => ({
  ...(await importOriginal()),
  createSeedVideos: () => [
    {
      caption: "测试作品",
      comments: 20,
      cover: "",
      group: "美国区",
      id: 1,
      likes: 100,
      publishedAt: "2026-09-17",
      uid: "74820119301",
      updatedAt: "2026-09-17 12:00:00",
      views: 1000,
      workId: "video-1",
    },
  ],
}))

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
