import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { DeviceControlPage } from "./control-page"

const slot = (index: number, host = "192.168.76.163") => ({
  apiPort: 30000 + (index - 1) * 100 + 1,
  busy: index === 2,
  height: "1920",
  host,
  index,
  label: `pit-${index}`,
  rpaPort: 30000 + (index - 1) * 100 + 2,
  status: "online",
  webrtcTcp: 30000 + (index - 1) * 100 + 7,
  webrtcUdp: 30000 + (index - 1) * 100 + 8,
  width: "1080",
})

const renderPage = (rows: readonly ReturnType<typeof slot>[]) => {
  const calls: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes("/slots")) {
        return new Response(JSON.stringify(rows), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      }
      if (url.includes("/frames") && url.includes("index=1")) {
        return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
          headers: { "content-type": "image/jpeg" },
          status: 200,
        })
      }
      if (url.includes("/frames") || url.includes("/watch")) {
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 500 })
    }),
  )
  render(
    <AntdApp>
      <MemoryRouter initialEntries={["/operations/devices/box-1/control"]}>
        <Routes>
          <Route path="/operations/devices/:deviceId/control" element={<DeviceControlPage />} />
        </Routes>
      </MemoryRouter>
    </AntdApp>,
  )
  return calls
}

describe("DeviceControlPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("previews with screenshots and opens WebRTC on the same card", async () => {
    const user = userEvent.setup()
    const calls = renderPage([1, 2, 3, 4, 5].map((index) => slot(index)))

    expect(await screen.findByRole("img", { name: "1 预览" })).toBeVisible()
    expect(screen.getAllByText("等待画面").length).toBeGreaterThan(0)
    expect(screen.queryByTitle("1 控制")).not.toBeInTheDocument()
    expect(calls.some((url) => url.includes("/watch"))).toBe(true)
    expect(calls.some((url) => url.includes("/frames"))).toBe(true)

    const preview = screen.getByRole("img", { name: "1 预览" })
    const card = preview.closest("article")
    if (card === null) throw new Error("missing card")
    await user.click(within(card).getByRole("button", { name: "控制" }))

    const player = await screen.findByTitle("1 控制")
    expect(player).toHaveAttribute("allow", "autoplay")
    expect(player).toHaveAttribute("src", expect.stringContaining("embed=1"))
    expect(player).toHaveAttribute("src", expect.stringContaining("sport=30007"))
    expect(screen.queryByRole("img", { name: "1 预览" })).not.toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "关闭" })).toHaveLength(1)

    const second = screen.getAllByRole("button", { name: "控制" })[0]
    if (second === undefined) throw new Error("missing control")
    await user.click(second)
    expect(await screen.findByTitle("2 控制")).toHaveAttribute(
      "src",
      expect.stringContaining("sport=30107"),
    )
    expect(screen.getByTitle("1 控制")).toBeInTheDocument()

    const firstCard = player.closest("article")
    if (firstCard === null) throw new Error("missing card")
    await user.click(within(firstCard).getByRole("button", { name: "关闭" }))
    await waitFor(() => expect(screen.queryByTitle("1 控制")).not.toBeInTheDocument())
    expect(screen.getByRole("img", { name: "1 预览" })).toBeVisible()
    expect(screen.getByTitle("2 控制")).toBeInTheDocument()
  })

  it("keeps the preview and disables control when the pit has no address", async () => {
    renderPage([slot(1, "")])

    expect(await screen.findByRole("img", { name: "1 预览" })).toBeVisible()
    expect(screen.getAllByText("空位").length).toBeGreaterThan(0)
    expect(screen.queryByTitle("1 控制")).not.toBeInTheDocument()
    for (const button of screen.getAllByRole("button", { name: "控制" })) {
      expect(button).toBeDisabled()
    }
  })
})
