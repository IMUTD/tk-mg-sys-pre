import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { identityApi, type PlatformIdentity } from "./api"
import { PlatformIdentityPage } from "./platform-page"

const row: PlatformIdentity = {
  userId: "10000000-0000-4000-8000-000000000001",
  email: "tenant@example.test",
  displayName: "租户管理员",
  enabled: true,
  mode: "enforced",
  required: true,
  canVerify: true,
  status: "verified",
  canAccessBusiness: true,
  version: 2,
  isPlatformAdmin: false,
  currentAttemptId: null,
  maskedName: "李*",
  maskedNumber: "1101**********1234",
  lastErrorCode: null,
  verifiedAt: "2026-11-05T00:00:00Z",
  providerAvailable: true,
  consentVersion: "2026-11-05-v1",
}
describe("platform identity management", () => {
  it("requires a reason and operator password before unbinding the displayed version", async () => {
    const unbind = vi.fn(async () => ({ status: "unbound" as const, version: 3, replayed: false }))
    const api = {
      ...identityApi,
      list: async () => ({ items: [row], total: 1, page: 1, pageSize: 20 }),
      unbind,
    }
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PlatformIdentityPage viewerId="platform" api={api} />
      </QueryClientProvider>,
    )
    expect(await screen.findByText("1101**********1234")).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "解除绑定" }))
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "确认解绑" }))
    expect(unbind).not.toHaveBeenCalled()
    await userEvent.type(within(dialog).getByLabelText("解绑原因"), "管理员申请更换身份资料")
    await userEvent.type(within(dialog).getByLabelText("我的登录密码"), "operator-test-password")
    await userEvent.click(within(dialog).getByRole("button", { name: "确认解绑" }))
    await vi.waitFor(() =>
      expect(unbind).toHaveBeenCalledWith(
        row.userId,
        {
          expectedVersion: 2,
          reason: "管理员申请更换身份资料",
          operatorPassword: "operator-test-password",
        },
        expect.any(String),
      ),
    )
  })
})
