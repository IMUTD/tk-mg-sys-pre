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

describe("MemberPage hierarchy", () => {
  it("shows the platform account with its first-level users and its own staff", async () => {
    renderPage(sessionUser(false))
    expect(await screen.findByText("平台管理员")).toBeVisible()
    expect(screen.getByText("客户甲")).toBeVisible()
    expect(screen.getByText("平台运营")).toBeVisible()
    // 一级用户名下的二级用户不展示。
    expect(screen.queryByText("甲的销售")).not.toBeInTheDocument()
    expect(screen.getByText("共 1 个一级用户，一级用户名下的二级用户不在这里展示")).toBeVisible()

    const platformRow = screen.getByText("平台管理员").closest("tr")
    if (platformRow === null) throw new Error("missing platform row")
    await userEvent.click(within(platformRow).getByRole("button", { name: /收起|Collapse/ }))
    expect(screen.queryByText("客户甲")).not.toBeInTheDocument()
  })

  it("keeps the platform row as context while searching", async () => {
    renderPage(sessionUser(false))
    await screen.findByText("客户甲")
    await userEvent.type(screen.getByRole("searchbox", { name: "搜索成员" }), "客户")

    expect(await screen.findByText("客户甲")).toBeVisible()
    expect(screen.getByText("平台管理员")).toBeVisible()
    expect(screen.queryByText("平台运营")).not.toBeInTheDocument()
  })

  it("puts several platform accounts under one platform heading", async () => {
    const second = {
      ...members[0],
      displayName: "平台管理员二",
      email: "p2@example.test",
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    } as Member
    renderPage(sessionUser(false), async () => [...members, second])
    expect(await screen.findByText("平台方 · 2 个平台账号 · 1 个一级用户")).toBeVisible()
    expect(screen.getByText("平台管理员二")).toBeVisible()
    expect(screen.getByText("客户甲")).toBeVisible()
    expect(screen.queryByText("甲的销售")).not.toBeInTheDocument()
  })

  it("keeps the flat list for a first-level user", async () => {
    renderPage(sessionUser(true), async () => members.slice(2))
    expect(await screen.findByText("甲的销售")).toBeVisible()
    expect(screen.getByText("客户甲")).toBeVisible()
    expect(screen.queryByText(/一级用户名下/)).not.toBeInTheDocument()
  })
})
