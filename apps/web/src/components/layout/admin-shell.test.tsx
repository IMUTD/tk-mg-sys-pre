import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { type AuthApi, WebApp } from "../../app/router"
import type { SessionUser } from "../../lib/api/auth-api"
import { defaultPagesForRole } from "../../lib/pages"

const mallGroup = "11111111-1111-4111-8111-111111111111"

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(input instanceof Request ? input.url : String(input), "http://localhost")
        .pathname
      const arrayRoutes = [
        "/api/skills",
        "/api/behavior-anchors",
        "/api/devices",
        "/api/behavior-chains",
      ]
      if (path === "/api/mall/wallets") {
        return Response.json({
          items: [{ balance: 59900, groupId: mallGroup, name: "一组" }],
        })
      }
      if (path === `/api/groups/${mallGroup}/mall/ledger`) {
        return Response.json({
          items: [
            {
              balance: 59900,
              createdAt: "2026-09-17T04:00:00.000Z",
              delta: -100,
              groupId: mallGroup,
              groupName: "一组",
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              orderNo: "",
              remark: "注册GG",
              type: "spend",
            },
          ],
          total: 1,
        })
      }
      return Response.json(arrayRoutes.includes(path) ? [] : { items: [], total: 0 })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

const pagesForRole = (role: string) => [...defaultPagesForRole(role)]

const administrator = {
  displayName: "管理员",
  email: "admin@example.com",
  scope: {
    groupIds: [],
    pages: pagesForRole("administrator"),
    permissions: ["configuration:write", "resources:read"],
    role: "administrator" as const,
  },
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}

const operator = {
  displayName: "考拉",
  email: "operator@example.com",
  scope: {
    groupIds: ["11111111-1111-4111-8111-111111111111"],
    pages: pagesForRole("operator"),
    permissions: ["resources:read"],
    role: "operator" as const,
  },
  userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
}

const salesperson = {
  email: "sales@example.com",
  scope: {
    groupIds: ["11111111-1111-4111-8111-111111111111"],
    pages: pagesForRole("salesperson"),
    permissions: [],
    role: "salesperson" as const,
  },
  userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
}

const engineer = {
  email: "engineer@example.com",
  scope: {
    groupIds: ["11111111-1111-4111-8111-111111111111"],
    pages: pagesForRole("engineer"),
    permissions: [],
    role: "engineer" as const,
  },
  userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
}

const operationsDirector = {
  email: "ops.director@example.com",
  scope: {
    groupIds: ["11111111-1111-4111-8111-111111111111"],
    pages: pagesForRole("operations_director"),
    permissions: [],
    role: "operations_director" as const,
  },
  userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
}

const createAuthenticatedApi = (
  user:
    | SessionUser
    | typeof administrator
    | typeof operator
    | typeof salesperson
    | typeof engineer
    | typeof operationsDirector,
): AuthApi => ({
  login: async () => ({ kind: "authenticated", user }),
  logout: async () => undefined,
  session: async () => ({ kind: "authenticated", user }),
})

const pageCrumb = (title: string) =>
  screen.findByText(
    (_, element) =>
      element?.matches(".breadcrumb") === true &&
      element.textContent?.replace(/\s+/g, " ").trim() === `哈蜜瓜云控 / ${title}`,
  )

const renderApplication = (api: AuthApi, initialPath: string): void => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <WebApp api={api} initialPath={initialPath} queryClient={queryClient} />
    </QueryClientProvider>,
  )
}

describe("WebApp route protection", () => {
  it("redirects an unauthenticated visitor to login", async () => {
    // Given
    const api: AuthApi = {
      login: async () => ({ kind: "unauthenticated" }),
      logout: async () => undefined,
      session: async () => ({ kind: "unauthenticated" }),
    }

    // When
    renderApplication(api, "/operations/devices")

    // Then
    expect(await screen.findByRole("button", { name: "登录" })).toBeVisible()
  })

  it("hides Configuration from an operator navigation", async () => {
    // Given
    const api = createAuthenticatedApi(operator)

    // When
    renderApplication(api, "/studio/text-pool")

    // Then
    expect(await screen.findByRole("link", { name: "文本池" })).toBeVisible()
    expect(screen.getByText("运营中心")).toBeVisible()
    expect(screen.getByRole("link", { name: "盒子管理" })).toBeVisible()
    expect(screen.getByRole("link", { name: "视频数据" }).getAttribute("href")).toBe(
      "/studio/video-pool",
    )
    expect(screen.getByRole("link", { name: "注册池" }).getAttribute("href")).toBe(
      "/studio/registration",
    )
    expect(screen.queryByRole("link", { name: "共享资源池" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "图片池" }).getAttribute("href")).toBe(
      "/studio/image-pool",
    )
    expect(screen.queryByRole("link", { name: "账号池" })).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "制作中心" })).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    expect(screen.getByText("资源中心")).toBeVisible()
    await userEvent.click(screen.getByRole("menuitem", { name: "制作中心" }))
    expect(await screen.findByRole("link", { name: "视频制作" })).toHaveAttribute(
      "href",
      "/studio/video",
    )
    expect(screen.queryByText("工程中心")).not.toBeInTheDocument()
    expect(screen.queryByText("营销中心")).not.toBeInTheDocument()
    expect(screen.queryByText("积分商场")).not.toBeInTheDocument()
    expect(screen.queryByText("商家中心")).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "配置中心" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "工作日志" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "成员与权限" })).not.toBeInTheDocument()
  })

  it("opens private-cloud storage under Engineering Center", async () => {
    // Given
    const api = createAuthenticatedApi(engineer)

    // When
    renderApplication(api, "/operations/storage")

    // Then
    expect(await pageCrumb("私有云储存")).toBeVisible()
    expect(screen.getByText("工程中心")).toBeVisible()
  })

  it("opens operations robots under Engineering Center", async () => {
    // Given
    const api = createAuthenticatedApi(engineer)

    // When
    renderApplication(api, "/engineering/robots")

    // Then
    expect(await pageCrumb("运营机器人")).toBeVisible()
    expect(screen.getByText("工程中心")).toBeVisible()
    expect(screen.getByRole("link", { name: "运营机器人" })).toBeVisible()
  })

  it("opens studio whiteboards under Production Center", async () => {
    // Given
    const api = createAuthenticatedApi(engineer)

    // When
    renderApplication(api, "/studio/video")

    // Then
    expect(await pageCrumb("视频制作")).toBeVisible()
    const production = screen.getByRole("menuitem", { name: "制作中心" }).closest("li")
    const resources = screen.getByRole("menuitem", { name: "资源中心" }).closest("li")
    expect(production).not.toBeNull()
    expect(resources).not.toBeNull()
    expect(within(production as HTMLElement).getByRole("link", { name: "视频制作" })).toBeVisible()
    expect(within(production as HTMLElement).getByRole("link", { name: "图片制作" })).toBeVisible()
    expect(within(production as HTMLElement).getByRole("link", { name: "文本制作" })).toBeVisible()
    expect(
      within(production as HTMLElement).queryByRole("link", { name: "文本池" }),
    ).not.toBeInTheDocument()
    const operations = screen.getByRole("menuitem", { name: "运营中心" }).closest("li")
    expect(operations).not.toBeNull()
    expect(within(operations as HTMLElement).getByRole("link", { name: "视频数据" })).toBeVisible()
    expect(within(resources as HTMLElement).getByRole("link", { name: "文本池" })).toBeVisible()
    expect(within(resources as HTMLElement).getByRole("link", { name: "视频池" })).toBeVisible()
    expect(within(resources as HTMLElement).getByRole("link", { name: "图片池" })).toBeVisible()
    expect(
      within(resources as HTMLElement).queryByRole("link", { name: "共享资源池" }),
    ).not.toBeInTheDocument()
    expect(within(resources as HTMLElement).getByRole("link", { name: "备份池" })).toBeVisible()
    expect(within(resources as HTMLElement).getByRole("link", { name: "注册池" })).toBeVisible()
    expect(
      within(resources as HTMLElement).queryByRole("link", { name: "视频数据" }),
    ).not.toBeInTheDocument()
    expect(
      within(resources as HTMLElement).queryByRole("link", { name: "视频制作" }),
    ).not.toBeInTheDocument()
    expect(await screen.findByText("视频制作白板")).toBeVisible()
  })

  it("opens points mall records", async () => {
    const api = createAuthenticatedApi(salesperson)
    renderApplication(api, "/mall/records")
    expect(await pageCrumb("积分记录")).toBeVisible()
    expect(screen.getByText("积分商场")).toBeVisible()
    expect(screen.getByRole("link", { name: "我的订单" })).toBeVisible()
    expect(screen.getByRole("link", { name: "发票申请" })).toBeVisible()
    expect(screen.getByRole("link", { name: "兑换中心" })).toBeVisible()
    expect(screen.queryByText("商家中心")).not.toBeInTheDocument()
    expect(await screen.findByText("注册GG")).toBeVisible()
  })

  it("shows the merchant center to the platform administrator", async () => {
    renderApplication(createAuthenticatedApi(administrator), "/merchant/recharges")
    expect(await pageCrumb("积分充值")).toBeVisible()
    expect(screen.getByText("商家中心")).toBeVisible()
  })

  it("hides the merchant center from a tenant administrator", async () => {
    const tenant = {
      ...administrator,
      scope: { ...administrator.scope, groupIds: [mallGroup], restrictGroups: true },
    }
    renderApplication(createAuthenticatedApi(tenant), "/merchant/recharges")
    expect(await pageCrumb("运营概览")).toBeVisible()
    expect(screen.queryByText("商家中心")).not.toBeInTheDocument()
  })

  it("opens behavior center under Engineering Center", async () => {
    // Given
    const api = createAuthenticatedApi(engineer)

    // When
    renderApplication(api, "/engineering/behaviors")

    // Then
    expect(await pageCrumb("行为中心")).toBeVisible()
    expect(screen.getByText("工程中心")).toBeVisible()
    expect(screen.getByRole("link", { name: "行为中心" })).toBeVisible()
  })

  it("redirects an operator away from the Configuration route", async () => {
    // Given
    const api = createAuthenticatedApi(operator)

    // When
    renderApplication(api, "/operations/configuration")

    // Then
    expect(await pageCrumb("运营概览")).toBeVisible()
    expect(screen.queryByRole("heading", { name: "配置中心" })).not.toBeInTheDocument()
  })

  it("redirects an operator away from the work-log route", async () => {
    // Given
    const api = createAuthenticatedApi(operator)

    // When
    renderApplication(api, "/work-logs")

    // Then
    expect(await pageCrumb("运营概览")).toBeVisible()
    expect(screen.queryByRole("heading", { name: "工作日志" })).not.toBeInTheDocument()
  })

  it("keeps engineering and operations visible for an administrator", async () => {
    // Given
    const api = createAuthenticatedApi(administrator)

    // When
    renderApplication(api, "/studio/text-pool")

    // Then
    expect(await pageCrumb("文本池")).toBeVisible()
    const engineering = screen.getByRole("menuitem", { name: "工程中心" }).closest("li")
    const operations = screen.getByRole("menuitem", { name: "运营中心" }).closest("li")
    expect(engineering).not.toBeNull()
    expect(operations).not.toBeNull()
    expect(screen.queryByRole("link", { name: "配置中心" })).not.toBeInTheDocument()
    expect(screen.queryByText("营销中心")).not.toBeInTheDocument()
    expect(screen.getByText("管理员")).toBeVisible()
    expect(screen.getByText("工作日志")).toBeVisible()
    expect(screen.getByText("成员与权限")).toBeVisible()
    expect(screen.getByText("运营中心")).toBeVisible()
    expect(screen.getByText("工程中心")).toBeVisible()
  })

  it("redirects a department director away from work logs", async () => {
    const api = createAuthenticatedApi(operationsDirector)
    renderApplication(api, "/work-logs")
    expect(await pageCrumb("运营概览")).toBeVisible()
    expect(screen.queryByRole("heading", { name: "工作日志" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "配置中心" })).not.toBeInTheDocument()
    expect(screen.getByText("资源中心")).toBeVisible()
    expect(screen.queryByRole("link", { name: "工作日志" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "成员与权限" })).not.toBeInTheDocument()
  })

  it("expands operations, engineering, and resources after login", async () => {
    const api = createAuthenticatedApi(administrator)
    renderApplication(api, "/overview")
    expect(await pageCrumb("运营概览")).toBeVisible()
    for (const name of ["运营中心", "工程中心", "资源中心"]) {
      expect(screen.getByRole("menuitem", { name })).toHaveAttribute("aria-expanded", "true")
    }
    expect(screen.queryByRole("menuitem", { name: "营销中心" })).not.toBeInTheDocument()
    for (const name of ["积分商场", "商家中心", "制作中心"]) {
      expect(screen.getByRole("menuitem", { name })).toHaveAttribute("aria-expanded", "false")
    }
  })

  it("does not select 运营中心 on first-level work logs and members", async () => {
    const api = createAuthenticatedApi(administrator)
    renderApplication(api, "/work-logs")
    expect(await pageCrumb("工作日志")).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "运营中心" })).not.toHaveClass(
      "ant-menu-submenu-selected",
    )
    expect(screen.getByRole("link", { name: "工作日志" }).closest("li")).toHaveClass(
      "ant-menu-item-selected",
    )
  })
})
