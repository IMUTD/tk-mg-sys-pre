import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { App as AntdApp } from "antd"
import { describe, expect, it } from "vitest"

import type { AuthApi, SessionUser } from "../../lib/api/auth-api"
import { AuthProvider } from "../auth/auth-provider"
import type { Member, MembersApi } from "./api"
import { MemberPage } from "./page"

const platformGroup = { id: "11111111-1111-4111-8111-111111111111", name: "平台库存" }
const customerGroup = { id: "22222222-2222-4222-8222-222222222222", name: "一组客户" }

const member = (
  id: string,
  displayName: string,
  level: NonNullable<Member["level"]>,
  group: { readonly id: string; readonly name: string },
): Member => ({
  createdAt: new Date("2026-11-01T00:00:00Z"),
  displayName,
  email: `${id.slice(0, 4)}@example.test`,
  enabled: true,
  groupIds: [group.id],
  groups: [group],
  id,
  level,
  role: level === "secondary" ? "operator" : "administrator",
})

const members: readonly Member[] = [
  member("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "平台管理员", "platform", platformGroup),
  member("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "平台运营", "secondary", platformGroup),
  member("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "客户甲", "primary", customerGroup),
  member("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "甲的销售", "secondary", customerGroup),
]

const membersApi: MembersApi = {
  create: async () => {
    throw new Error("unused")
  },
  delete: async () => undefined,
  list: async () => members,
  listMemberPermissions: async () => [],
  listPages: async () => [],
  replaceMemberPermissions: async () => [],
  suggestDisplayName: async () => "名字",
  update: async () => {
    throw new Error("unused")
  },
}

const sessionUser = (restrictGroups: boolean): SessionUser => ({
  email: "viewer@example.test",
  scope: {
    groupIds: restrictGroups ? [customerGroup.id] : [platformGroup.id],
    pages: [],
    permissions: [],
    ...(restrictGroups ? { restrictGroups: true } : {}),
    role: "administrator",
  },
  userId: restrictGroups
    ? "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
})

const renderPage = (user: SessionUser, list: MembersApi["list"] = membersApi.list): void => {
  const authApi: AuthApi = {
    login: async () => ({ kind: "authenticated", user }),
    logout: async () => undefined,
    session: async () => ({ kind: "authenticated", user }),
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <AntdApp>
      <QueryClientProvider client={queryClient}>
        <AuthProvider api={authApi}>
          <MemberPage api={{ ...membersApi, list }} />
        </AuthProvider>
      </QueryClientProvider>
    </AntdApp>,
  )
}

describe("MemberPage grouping", () => {
  it("groups every user by access group for the platform, collapsed until opened", async () => {
    renderPage(sessionUser(false))
    expect(await screen.findByText("平台库存 · 平台方 · 2 人")).toBeVisible()
    expect(screen.getByText("一组客户 · 一级：客户甲 · 2 人")).toBeVisible()
    expect(screen.queryByText("甲的销售")).not.toBeInTheDocument()

    const customerRow = screen.getByText("一组客户 · 一级：客户甲 · 2 人").closest("tr")
    if (customerRow === null) throw new Error("missing group row")
    await userEvent.click(within(customerRow).getByRole("button"))

    expect(await screen.findByText("甲的销售")).toBeVisible()
    expect(screen.getByText("客户甲")).toBeVisible()
    expect(screen.queryByText("平台运营")).not.toBeInTheDocument()
  })

  it("expands matching groups while searching", async () => {
    renderPage(sessionUser(false))
    await screen.findByText("平台库存 · 平台方 · 2 人")
    await userEvent.type(screen.getByRole("searchbox", { name: "搜索成员" }), "销售")

    expect(await screen.findByText("甲的销售")).toBeVisible()
    expect(screen.getByText("一组客户 · 一级：客户甲 · 2 人")).toBeVisible()
    expect(screen.queryByText("客户甲")).not.toBeInTheDocument()
    expect(screen.queryByText("平台库存 · 平台方 · 2 人")).not.toBeInTheDocument()
  })

  it("keeps the flat list for a first-level user", async () => {
    renderPage(sessionUser(true), async () => members.slice(2))
    expect(await screen.findByText("甲的销售")).toBeVisible()
    expect(screen.getByText("客户甲")).toBeVisible()
    expect(screen.queryByText(/一组客户 · /)).not.toBeInTheDocument()
  })
})
