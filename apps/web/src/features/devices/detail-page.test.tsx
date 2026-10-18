import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import type { DeviceCommand, DevicesApi } from "./api"
import { DeviceDetailPage } from "./detail-page"

import {
  commandId,
  createApi,
  device,
  deviceId,
  groupId,
  instanceId,
  makeCommand,
} from "./device.test-fixtures"

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
  it("deletes a device through the API after confirmation", async () => {
    const user = userEvent.setup()
    const api = renderPage()
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)

    await user.click(await screen.findByRole("button", { name: "删除盒子" }))
    expect(api.delete).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledWith("确认删除此盒子及其所有实例吗？")

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole("button", { name: "删除盒子" }))
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith({ deviceId, groupId }))
  })

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
