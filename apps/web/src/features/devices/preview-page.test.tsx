import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import { DevicePreviewPage } from "./preview-page"

const renderPage = (
  devices: readonly Record<string, unknown>[] = [
    { host: "192.168.76.164", id: "box-164", name: "164" },
  ],
) => {
  const calls: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? "GET"} ${url}`)
      if (url === "/api/devices") {
        return new Response(JSON.stringify(devices), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      }
      if (url === "/api/box-labels") {
        return new Response(
          JSON.stringify({
            groups: [{ id: "group-a", name: "测试组" }],
            remarks: [{ id: "remark-a", name: "夜班" }],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        )
      }
      if (url.includes("/slots")) {
        return new Response(
          JSON.stringify([
            {
              height: "2340",
              host: "192.168.76.164",
              index: 1,
              label: "hmg16401",
              status: "running",
              width: "1080",
            },
            {
              height: "2340",
              host: "192.168.76.164",
              index: 2,
              label: "hmg16402",
              status: "running",
              width: "1080",
            },
          ]),
          { headers: { "content-type": "application/json" }, status: 200 },
        )
      }
      if (url.includes("/frames") && url.includes("index=1")) {
        return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
          headers: { "content-type": "image/jpeg" },
          status: 200,
        })
      }
      return new Response(null, { status: 204 })
    }),
  )
  render(
    <AntdApp>
      <MemoryRouter>
        <DevicePreviewPage />
      </MemoryRouter>
    </AntdApp>,
  )
  return calls
}

describe("DevicePreviewPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("adds several pits and shows pushed screenshots without a player", async () => {
    const user = userEvent.setup()
    const calls = renderPage()

    expect(screen.getByText("还没有云机。点「添加云机」，勾选要看的坑位。")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "添加云机" }))
    expect(await screen.findByRole("group", { name: "在线状态" })).toBeVisible()
    expect(screen.getByRole("group", { name: "备注" })).toBeVisible()
    expect(screen.getByRole("group", { name: "分组" })).toBeVisible()
    expect(screen.getByLabelText("搜索")).toBeVisible()
    expect(await screen.findByRole("checkbox", { name: "坑位 1 hmg16401" })).toBeVisible()
    await user.click(screen.getByRole("checkbox", { name: "坑位 1 hmg16401" }))
    await user.click(screen.getByRole("checkbox", { name: "坑位 2 hmg16402" }))
    await user.click(screen.getByRole("button", { name: "添加 2 台" }))

    expect(await screen.findByRole("img", { name: "164 1 预览" })).toBeVisible()
    expect(screen.getByText("164 · 2 hmg16402")).toBeVisible()
    expect(screen.getAllByText("等待画面")).toHaveLength(1)
    expect(screen.queryByTitle(/控制/)).not.toBeInTheDocument()
    await waitFor(() => expect(calls.some((url) => url.includes("/watch"))).toBe(true))
    expect(calls.some((url) => url.startsWith("GET /api/frames"))).toBe(true)

    await user.click(screen.getAllByRole("button", { name: "移除" })[0]!)
    await waitFor(() => expect(screen.queryByText("164 · 1 hmg16401")).not.toBeInTheDocument())
  })

  it("uses the condition card to keep one box", async () => {
    const user = userEvent.setup()
    renderPage([
      { host: "192.168.76.163", id: "box-163", name: "163", status: "offline" },
      { host: "192.168.76.164", id: "box-164", name: "164", status: "online" },
    ])
    await user.click(screen.getByRole("button", { name: "添加云机" }))
    expect(await screen.findByRole("checkbox", { name: "163" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "在线" }))
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "163" })).not.toBeInTheDocument())
    expect(screen.getByRole("checkbox", { name: "164" })).toBeVisible()
    await user.click(screen.getByRole("checkbox", { name: "164" }))
    expect(screen.getByRole("button", { name: "添加 2 台" })).toBeEnabled()
  })

  it("selects every phone in the filtered boxes", async () => {
    const user = userEvent.setup()
    renderPage([
      { host: "192.168.76.163", id: "box-163", name: "163", status: "offline" },
      { host: "192.168.76.164", id: "box-164", name: "164", status: "online" },
    ])
    await user.click(screen.getByRole("button", { name: "添加云机" }))
    expect(await screen.findByRole("checkbox", { name: "全选" })).toBeVisible()
    expect(screen.getByText("2 台盒子，4 台云机")).toBeVisible()
    await user.click(screen.getByRole("checkbox", { name: "全选" }))
    expect(screen.getByRole("button", { name: "添加 4 台" })).toBeEnabled()
    await user.click(screen.getByRole("button", { name: "在线" }))
    await waitFor(() => expect(screen.getByText("1 台盒子，2 台云机")).toBeVisible())
    await user.click(screen.getByRole("checkbox", { name: "全选" }))
    expect(screen.getByRole("button", { name: "添加 2 台" })).toBeEnabled()
  })
})
