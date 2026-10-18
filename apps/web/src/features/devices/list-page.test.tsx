import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import { AntdApp } from "../../app/antd-app"
import type { DevicesApi } from "./api"
import { createApi } from "./device.test-fixtures"
import { DeviceListPage } from "./list-page"

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

    expect(await screen.findByText("192.168.1.2")).toBeVisible()
    expect(screen.getByText("te***ox")).toBeVisible()
    expect(screen.getByText("Magic Cloud V3")).toBeVisible()
    expect(screen.getByText("未知")).toBeVisible()
    expect(api.owned).toHaveBeenCalledOnce()
    expect(api.labels).toHaveBeenCalledOnce()
    expect(screen.queryByRole("button", { name: "删除盒子" })).not.toBeInTheDocument()
  })

  it("asks before deleting a box remark and only deletes after confirmation", async () => {
    const user = userEvent.setup()
    const api = createApi()
    api.labels = vi.fn().mockResolvedValue({
      administratorId: "11111111-1111-4111-8111-111111111111",
      groups: [],
      remarks: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          administratorId: "11111111-1111-4111-8111-111111111111",
          name: "机柜备注",
        },
      ],
    })
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
    renderPage(api)

    await user.click(
      await within(screen.getByRole("group", { name: "备注" })).findByRole("button", {
        name: "关闭",
      }),
    )
    await waitFor(() => {
      expect(
        screen.getByText("确认删除“机柜备注”？仍被盒子使用的备注或分组不能删除。"),
      ).toBeVisible()
    })
    await user.click(screen.getByRole("button", { name: "取消" }))
    expect(api.deleteRemark).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    await user.click(
      within(screen.getByRole("group", { name: "备注" })).getByRole("button", { name: "关闭" }),
    )
    await user.click(await screen.findByRole("button", { name: "删除" }))
    await waitFor(() => {
      expect(api.deleteRemark).toHaveBeenCalledWith("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
    })
  })
})
