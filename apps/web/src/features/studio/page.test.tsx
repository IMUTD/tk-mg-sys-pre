import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { StudioPage } from "./page"

describe("StudioPage", () => {
  it("renders a whiteboard for each production kind", () => {
    const { rerender } = render(
      <MemoryRouter>
        <AntdApp>
          <StudioPage kind="video" />
        </AntdApp>
      </MemoryRouter>,
    )
    expect(screen.getByText("视频制作白板")).toBeVisible()

    rerender(
      <MemoryRouter>
        <AntdApp>
          <StudioPage kind="image" />
        </AntdApp>
      </MemoryRouter>,
    )
    expect(screen.getByText("图片制作白板")).toBeVisible()

    rerender(
      <MemoryRouter>
        <AntdApp>
          <StudioPage kind="text" />
        </AntdApp>
      </MemoryRouter>,
    )
    expect(screen.getByText("文本制作白板")).toBeVisible()
  })

  it("renders the image pool whiteboard", () => {
    render(
      <MemoryRouter>
        <AntdApp>
          <StudioPage kind="image-pool" />
        </AntdApp>
      </MemoryRouter>,
    )
    expect(screen.getByText("图片池白板")).toBeVisible()
  })
})
