import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { IdentitySummary } from "./api"
import { IdentityVerificationPage } from "./page"

const initial: IdentitySummary = {
  mode: "enforced",
  required: true,
  canVerify: true,
  status: "unverified",
  canAccessBusiness: false,
  version: 0,
  isPlatformAdmin: false,
  currentAttemptId: null,
  maskedName: null,
  maskedNumber: null,
  lastErrorCode: null,
  verifiedAt: null,
  providerAvailable: true,
  consentVersion: "2026-11-05-v1",
}
const renderPage = (data = initial) => {
  const api = {
    me: vi.fn(async () => data),
    submit: vi.fn(async () => ({
      id: "attempt",
      status: "verified" as const,
      errorCode: null,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    })),
  }
  const onVerified = vi.fn(async () => {})
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <IdentityVerificationPage userId="user" api={api} onVerified={onVerified} />
    </QueryClientProvider>,
  )
  return { api, onVerified }
}
describe("identity upload page", () => {
  it("uses a new request key after a lost response is found to have failed", async () => {
    let current = initial
    const keys: string[] = []
    const api = {
      me: async () => current,
      submit: async (_file: File, _consent: string, key: string) => {
        keys.push(key)
        current = {
          ...initial,
          status: "error",
          currentAttemptId: "attempt-one",
          lastErrorCode: "identity_provider_unavailable",
        }
        throw new TypeError("Response lost")
      },
    }
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <IdentityVerificationPage userId="user" api={api} onVerified={async () => {}} />
      </QueryClientProvider>,
    )
    await screen.findByRole("button", { name: /提交认证/ })
    await userEvent.upload(
      screen.getByLabelText("身份证人像面"),
      new File(["photo"], "id.png", { type: "image/png" }),
    )
    await userEvent.click(screen.getByRole("checkbox"))
    await userEvent.click(screen.getByRole("button", { name: /提交认证/ }))
    await screen.findByText("网络请求未完成，请刷新状态后再试。")
    await waitFor(() => expect(screen.getByRole("button", { name: /提交认证/ })).toBeEnabled())
    await userEvent.click(screen.getByRole("button", { name: /提交认证/ }))
    expect(keys).toHaveLength(2)
    expect(keys[1]).not.toBe(keys[0])
  })
  it("requires both a photo and separate consent before submitting", async () => {
    const { api } = renderPage()
    const button = await screen.findByRole("button", { name: /提交认证/ })
    expect(button).toBeDisabled()
    await userEvent.upload(
      screen.getByLabelText("身份证人像面"),
      new File(["photo"], "id.png", { type: "image/png" }),
    )
    expect(button).toBeDisabled()
    expect(api.submit).not.toHaveBeenCalled()
  })
  it("shows verified masked identity without asking for another upload", async () => {
    renderPage({
      ...initial,
      status: "verified",
      canAccessBusiness: true,
      maskedName: "张*",
      maskedNumber: "1101**********1234",
    })
    expect(await screen.findByText("1101**********1234")).toBeVisible()
    expect(screen.queryByLabelText("身份证人像面")).not.toBeInTheDocument()
  })
})
