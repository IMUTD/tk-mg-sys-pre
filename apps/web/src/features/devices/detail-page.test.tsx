import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import type { Device, DeviceCommand, DevicesApi } from "./api"
import { DeviceDetailPage } from "./detail-page"

const groupId = "11111111-1111-4111-8111-111111111111"
const deviceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const instanceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const commandId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

const makeCommand = (
  status: DeviceCommand["status"],
  result: DeviceCommand["result"] = null,
): DeviceCommand => ({
  createdAt: new Date("2026-09-12T00:00:00.000Z"),
  deviceId,
  errorCode: null,
  fingerprint: "fingerprint",
  finishedAt: status === "succeeded" || status === "cancelled" ? new Date() : null,
  groupId,
  id: commandId,
  idempotencyKey: "key",
  instanceId: null,
  kind: "health_check",
  parameters: {},
  providerReceipt: null,
  requesterId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  result,
  resultReference: null,
  startedAt: null,
  status,
  timeoutMs: 5_000,
})

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
  owned: vi.fn().mockResolvedValue([]),
  labels: vi.fn().mockResolvedValue({ administratorId: null, groups: [], remarks: [] }),
  createRemark: vi.fn(),
  deleteRemark: vi.fn(),
  createBoxGroup: vi.fn(),
  deleteBoxGroup: vi.fn(),
  assignLabels: vi.fn(),
  cancelCommand: vi.fn().mockResolvedValue(makeCommand("cancelled")),
  create: vi.fn(),
  createInstance: vi
    .fn()
    .mockResolvedValue({ ...device.instances[0], id: crypto.randomUUID(), index: 2 }),
  delete: vi.fn(),
  deleteInstance: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue(device),
  getCommand: vi.fn().mockResolvedValue(makeCommand("running")),
  groups: vi.fn(),
  list: vi.fn(),
  listCommands: vi.fn(),
  status: vi.fn().mockResolvedValue({
    instances: [
      { failure: null, id: instanceId, label: "V3-01", observedAt: null, state: "unknown" },
    ],
    monitoring: { state: "unconfigured" },
    observation: { failure: null, observedAt: null, state: "unknown" },
  }),
  submitCommand: vi.fn(),
  update: vi.fn(),
  updateInstance: vi.fn().mockResolvedValue(device.instances[0]),
})

const renderPage = (api = createApi(), canWrite = true): DevicesApi => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <AntdApp>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DeviceDetailPage
            api={api}
            canDelete={true}
            canWrite={canWrite}
            deviceId={deviceId}
            groupId={groupId}
          />
        </MemoryRouter>
      </QueryClientProvider>
    </AntdApp>,
  )
  return api
}

describe("DeviceDetailPage", () => {
  it("renders status as unconfigured and manages instances through the API", async () => {
    const user = userEvent.setup()
    const api = renderPage()
    vi.spyOn(window, "confirm").mockReturnValue(true)

    expect(await screen.findByText("研发机柜 A")).toBeVisible()
    expect(screen.getByText("unconfigured")).toBeVisible()
    await user.type(screen.getByLabelText("新实例标签"), "V3-02")
    await user.type(screen.getByLabelText("新实例编号"), "2")
    await user.click(screen.getByRole("button", { name: "新增实例" }))
    await user.click(screen.getByRole("button", { name: "删除实例" }))

    await waitFor(() => {
      expect(api.createInstance).toHaveBeenCalledWith({
        deviceId,
        groupId,
        index: 2,
        label: "V3-02",
      })
      expect(api.deleteInstance).toHaveBeenCalledWith({ deviceId, groupId, instanceId })
    })
  })

  it("submits health checks and displays the command result separately from monitoring", async () => {
    const user = userEvent.setup()
    const api = createApi()
    const succeededCommand = makeCommand("succeeded", { kind: "acknowledged" })
    vi.mocked(api.submitCommand).mockResolvedValue(succeededCommand)
    vi.mocked(api.getCommand).mockResolvedValue(succeededCommand)
    renderPage(api)

    await user.click(await screen.findByRole("button", { name: "健康检查" }))

    expect(await screen.findByText("命令已完成")).toBeVisible()
    expect(screen.getByText("unconfigured")).toBeVisible()
    expect(api.submitCommand).toHaveBeenCalledWith({
      deviceId,
      groupId,
      idempotencyKey: expect.any(String),
      type: "health_check",
    })
  })

  it("submits capture for the selected instance and renders no_artifact as text", async () => {
    const user = userEvent.setup()
    const api = createApi()
    const noArtifactCommand: DeviceCommand = {
      ...makeCommand("succeeded", { kind: "no_artifact" }),
      instanceId,
      kind: "capture_screen",
    }
    vi.mocked(api.submitCommand).mockResolvedValue(noArtifactCommand)
    vi.mocked(api.getCommand).mockResolvedValue(noArtifactCommand)
    renderPage(api)

    await user.click(await screen.findByRole("button", { name: "截取屏幕" }))

    expect(await screen.findByText("无截图产物 (no artifact)")).toBeVisible()
    expect(api.submitCommand).toHaveBeenCalledWith({
      deviceId,
      groupId,
      idempotencyKey: expect.any(String),
      instanceId,
      type: "capture_screen",
    })
    expect(document.querySelector("img")).toBeNull()
  })

  it("cancels a running command through the API and displays cancelled", async () => {
    const user = userEvent.setup()
    const api = createApi()
    vi.mocked(api.submitCommand).mockResolvedValue(makeCommand("running"))
    renderPage(api)

    await user.click(await screen.findByRole("button", { name: "健康检查" }))
    await user.click(await screen.findByRole("button", { name: "取消命令" }))

    expect(await screen.findByText("cancelled")).toBeVisible()
    expect(api.cancelCommand).toHaveBeenCalledWith({ commandId, deviceId, groupId })
  })

  it("disables command actions for read-only users", async () => {
    renderPage(createApi(), false)

    expect(await screen.findByRole("button", { name: "健康检查" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "截取屏幕" })).toBeDisabled()
  })

  it("disables command actions when the target device is disabled", async () => {
    const api = createApi()
    vi.mocked(api.get).mockResolvedValue({ ...device, enabled: false })
    renderPage(api)

    expect(await screen.findByRole("button", { name: "健康检查" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "截取屏幕" })).toBeDisabled()
  })
})
