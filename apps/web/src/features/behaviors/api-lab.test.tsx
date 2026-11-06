import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type ReactNode, useRef } from "react"
import { afterEach, describe, expect, it } from "vitest"

import { AntdApp } from "../../app/antd-app"
import type { AuthApi } from "../../lib/api/auth-api"
import { AuthProvider } from "../auth/auth-provider"
import { ApiLab } from "./api-lab"
import type { DevicePoint } from "./screen-map"

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

const user = {
  displayName: "管理员",
  email: "admin@example.com",
  scope: {
    groupIds: [],
    pages: [],
    permissions: [],
    role: "administrator" as const,
  },
  userId,
}

const api: AuthApi = {
  login: async () => ({ kind: "authenticated", user }),
  logout: async () => undefined,
  session: async () => ({ kind: "authenticated", user }),
}

const LabHarness = (): ReactNode => {
  const applyScreen = useRef<(start: DevicePoint, end: DevicePoint) => string | null>(() => null)
  return <ApiLab applyScreen={applyScreen} onEnqueue={async () => null} pending={false} skills={[]} />
}

const renderLab = (): void => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <AntdApp>
      <QueryClientProvider client={queryClient}>
        <AuthProvider api={api}>
          <LabHarness />
        </AuthProvider>
      </QueryClientProvider>
    </AntdApp>,
  )
}

describe("ApiLab recent uses", () => {
  afterEach(() => {
    localStorage.clear()
  })

  it("keeps the last five tests and restores that test's parameters", async () => {
    const actor = userEvent.setup()
    localStorage.setItem(
      `tk-mg.lab-frequent.${userId}`,
      JSON.stringify([
        { code: "TouchClick", count: 9, lastUsedAt: 1_000 },
        { code: "TouchDown", count: 1, lastUsedAt: 5_000 },
      ]),
    )
    renderLab()

    const history = await screen.findByRole("region", { name: "使用记录" })
    const records = within(history).getAllByRole("button")
    expect(records[0]).toHaveTextContent("按下")
    expect(records[1]).toHaveTextContent("点击")

    await actor.clear(screen.getByRole("textbox", { name: "x" }))
    await actor.type(screen.getByRole("textbox", { name: "x" }), "111")
    await actor.click(screen.getByRole("button", { name: "测试" }))

    const updated = within(screen.getByRole("region", { name: "使用记录" })).getAllByRole("button")
    expect(updated).toHaveLength(3)
    expect(updated[0]).toHaveTextContent("点击")
    await actor.clear(screen.getByRole("textbox", { name: "x" }))
    await actor.type(screen.getByRole("textbox", { name: "x" }), "222")
    await actor.click(updated[0]!)
    expect(screen.getByRole("textbox", { name: "x" })).toHaveValue("111")
  })
})
