import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import type { Device, DevicesApi } from "./api"
import { DeviceListPage } from "./list-page"

const groupId = "11111111-1111-4111-8111-111111111111"
const deviceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const instanceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

const device: Device = {
  bridge: false,
  createdAt: new Date("2026-09-12T00:00:00.000Z"),
  enabled: true,
  groupId,
  host: "192.168.1.2",
  id: deviceId,
  instances: [
    {
      createdAt: new Date("2026-09-12T00:00:00.000Z"),
      deviceId,
      enabled: true,
      id: instanceId,
      index: 1,
      label: "V3-01",
      lastHealthAt: null,
      lastHealthFailure: null,
      lastPlaybackDiagnostic: null,
      status: "unknown",
      updatedAt: new Date("2026-09-12T00:00:00.000Z"),
    },
  ],
  lastHealthAt: null,
  lastHealthFailure: null,
  model: "Magic Cloud V3",
  name: "研发机柜 A",
  resourceCount: 1,
  status: "unknown",
  updatedAt: new Date("2026-09-12T00:00:00.000Z"),
  version: null,
}

const createApi = (): DevicesApi => ({
  cancelCommand: vi.fn(),
  create: vi.fn(),
  createInstance: vi.fn(),
  delete: vi.fn().mockResolvedValue(undefined),
  deleteInstance: vi.fn(),
  get: vi.fn(),
  getCommand: vi.fn(),
  groups: vi.fn().mockResolvedValue([{ id: groupId, name: "研发组" }]),
  list: vi.fn().mockResolvedValue([device]),
  listCommands: vi.fn(),
  status: vi.fn(),
  submitCommand: vi.fn(),
  update: vi.fn(),
  updateInstance: vi.fn(),
})

const renderPage = (api = createApi(), canDelete = true): DevicesApi => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <AntdApp>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/operations/devices"]}>
          <DeviceListPage api={api} canDelete={canDelete} canWrite={true} isAdministrator={true} />
        </MemoryRouter>
      </QueryClientProvider>
    </AntdApp>,
  )
  return api
}

describe("DeviceListPage", () => {
  it("renders persisted devices from the API", async () => {
    const api = renderPage()

    expect(await screen.findByText("研发机柜 A")).toBeVisible()
    expect(screen.getByText("192.168.1.2")).toBeVisible()
    expect(screen.getByText("Magic Cloud V3")).toBeVisible()
    expect(screen.getByText("未配置 / unknown")).toBeVisible()
    expect(api.groups).toHaveBeenCalledOnce()
    expect(api.list).toHaveBeenCalledWith(groupId)
  })

  it("deletes a device through the API", async () => {
    const user = userEvent.setup()
    const api = renderPage()
    vi.spyOn(window, "matchMedia").mockReturnValue({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: "",
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })

    await user.click(await screen.findByRole("button", { name: /删除/ }))
    await user.click(await screen.findByRole("button", { name: "确定" }))

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith({ deviceId, groupId })
    })
  })
})
