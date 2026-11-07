import { QueryClient } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { type AuthApi, WebApp } from "../../app/router"
import type { SessionUser } from "../../lib/api/auth-api"
import { defaultPagesForRole } from "../../lib/pages"
import type { IdentitySummary } from "../identity-verification/api"

const identity: IdentitySummary = {
  mode: "optional",
  required: false,
  canVerify: true,
  status: "unverified",
  canAccessBusiness: true,
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

const renderProfile = (state: IdentitySummary = identity, initialPath = "/profile") => {
  const user: SessionUser = {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    displayName: "测试管理员",
    email: "tenant@example.com",
    isPlatformAdmin: state.isPlatformAdmin,
    identity: state,
    scope: {
      role: "administrator",
      permissions: [],
      groupIds: [],
      pages: [...defaultPagesForRole("administrator")],
    },
  }
  const api: AuthApi = {
    login: async () => ({ kind: "authenticated", user }),
    session: async () => ({ kind: "authenticated", user }),
    logout: async () => undefined,
  }
  const requests: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(input instanceof Request ? input.url : String(input), "http://localhost")
        .pathname
      requests.push(path)
      return Response.json(path === "/api/identity-verification/me" ? state : { items: [] })
    }),
  )
  render(
    <WebApp
      api={api}
      initialPath={initialPath}
      queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    />,
  )
  return requests
}

afterEach(() => vi.unstubAllGlobals())

describe("personal profile identity verification", () => {
  it("offers verification inside the profile without a standalone menu", async () => {
    // Given / When
    renderProfile()

    // Then
    expect(await screen.findByText("个人资料", { exact: true })).toBeVisible()
    expect(screen.getByText("tenant@example.com")).toBeVisible()
    expect(await screen.findByLabelText("身份证人像面")).toBeVisible()
    expect(screen.queryByRole("link", { name: "实名认证" })).not.toBeInTheDocument()
  })

  it("opens the profile when an old verification link is visited", async () => {
    // Given / When
    renderProfile(identity, "/identity-verification")

    // Then
    expect(await screen.findByText("个人资料", { exact: true })).toBeVisible()
    expect(screen.getByText("tenant@example.com")).toBeVisible()
    expect(await screen.findByLabelText("身份证人像面")).toBeVisible()
  })

  it("requires verification in the profile before loading business pages", async () => {
    // Given / When
    const requests = renderProfile(
      { ...identity, mode: "enforced", required: true, canAccessBusiness: false },
      "/operations/devices",
    )

    // Then
    expect(await screen.findByText("个人资料", { exact: true })).toBeVisible()
    expect(await screen.findByLabelText("身份证人像面")).toBeVisible()
    expect(screen.queryByRole("link", { name: "盒子管理" })).not.toBeInTheDocument()
    expect(requests).not.toContain("/api/devices")
  })

  it("only displays the completed status when the administrator is verified", async () => {
    // Given / When
    renderProfile({ ...identity, status: "verified", maskedNumber: "110***********002X" })

    // Then
    expect(await screen.findByText("已认证", { exact: true })).toBeVisible()
    expect(screen.queryByLabelText("身份证人像面")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "进入系统" })).not.toBeInTheDocument()
    expect(screen.queryByText("110***********002X")).not.toBeInTheDocument()
  })

  it("does not offer verification to an exempt platform administrator", async () => {
    // Given / When
    renderProfile({ ...identity, isPlatformAdmin: true, canVerify: false, status: "not_required" })

    // Then
    expect(await screen.findByText("无需认证", { exact: true })).toBeVisible()
    expect(screen.getByText("tenant@example.com")).toBeVisible()
    expect(screen.queryByLabelText("身份证人像面")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "实名认证管理" })).toBeVisible()
  })

  it("does not present a disabled service as a completed verification", async () => {
    // Given / When
    renderProfile({ ...identity, mode: "off", canVerify: false, status: "not_required" })

    // Then
    expect(await screen.findByText("暂未开放", { exact: true })).toBeVisible()
    expect(screen.queryByText("已认证", { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByLabelText("身份证人像面")).not.toBeInTheDocument()
  })
})
