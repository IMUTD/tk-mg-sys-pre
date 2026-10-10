import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { type AuthApi, WebApp } from "../../app/router"
import { defaultPagesForRole } from "../../lib/pages"

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
    expect(screen.getByRole("link", { name: "注册池" })).toBeVisible()
    expect(screen.getByText("资源中心")).toBeVisible()
    expect(screen.getByRole("link", { name: "视频制作" })).toBeVisible()
    expect(screen.queryByText("工程中心")).not.toBeInTheDocument()
    expect(screen.queryByText("营销中心")).not.toBeInTheDocument()
    expect(screen.queryByText("积分商场")).not.toBeInTheDocument()
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
    expect(await screen.findByRole("heading", { name: "私有云储存" })).toBeVisible()
    expect(screen.getByText("工程中心")).toBeVisible()
  })

  it("opens operations robots under Engineering Center", async () => {
    // Given
    const api = createAuthenticatedApi(engineer)

    // When
    renderApplication(api, "/engineering/robots")

    // Then
    expect(await screen.findByRole("heading", { name: "运营机器人" })).toBeVisible()
    expect(screen.getByText("工程中心")).toBeVisible()
    expect(screen.getByRole("link", { name: "运营机器人" })).toBeVisible()
  })

  it("opens marketing dashboard under Marketing Center", async () => {
    // Given
    const api = createAuthenticatedApi(salesperson)

    // When
    renderApplication(api, "/marketing/dashboard")

    // Then
    expect(await screen.findByRole("heading", { name: "营销面板" })).toBeVisible()
    expect(screen.getByText("营销中心")).toBeVisible()
    expect(await screen.findByText("账号销售额")).toBeVisible()
    expect(screen.getByRole("link", { name: "账号市场" })).toBeVisible()
    expect(screen.getByRole("link", { name: "节点市场" })).toBeVisible()
    expect(screen.getByRole("link", { name: "销售业绩" })).toBeVisible()
    expect(screen.getByRole("link", { name: "运营业绩" })).toBeVisible()
    expect(screen.getByText("资源中心")).toBeVisible()
    expect(screen.queryByRole("link", { name: "工作日志" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "成员与权限" })).not.toBeInTheDocument()
  })

  it("opens studio whiteboards under Resource Center", async () => {
    // Given
    const api = createAuthenticatedApi(engineer)

    // When
    renderApplication(api, "/studio/video")

    // Then
    expect(await screen.findByRole("heading", { name: "视频制作" })).toBeVisible()
    expect(screen.getByText("资源中心")).toBeVisible()
    expect(await screen.findByText("视频制作白板")).toBeVisible()
    expect(screen.getByRole("link", { name: "图片制作" })).toBeVisible()
    expect(screen.getByRole("link", { name: "文本制作" })).toBeVisible()
    expect(screen.getByRole("link", { name: "文本池" })).toBeVisible()
    expect(screen.getByRole("link", { name: "注册池" })).toBeVisible()
  })

  it("opens points mall records", async () => {
    const api = createAuthenticatedApi(salesperson)
    renderApplication(api, "/mall/records")
    expect(await screen.findByRole("heading", { name: "积分记录" })).toBeVisible()
    expect(screen.getByText("积分商场")).toBeVisible()
    expect(screen.getByRole("link", { name: "我的订单" })).toBeVisible()
    expect(screen.getByRole("link", { name: "发票申请" })).toBeVisible()
    expect(screen.getByRole("link", { name: "兑换中心" })).toBeVisible()
    expect(await screen.findByText("注册GG")).toBeVisible()
  })

  it("opens behavior center under Engineering Center", async () => {
    // Given
    const api = createAuthenticatedApi(engineer)

    // When
    renderApplication(api, "/engineering/behaviors")

    // Then
    expect(await screen.findByRole("heading", { name: "行为中心" })).toBeVisible()
    expect(screen.getByText("工程中心")).toBeVisible()
    expect(screen.getByRole("link", { name: "行为中心" })).toBeVisible()
  })

  it("redirects an operator away from the Configuration route", async () => {
    // Given
    const api = createAuthenticatedApi(operator)

    // When
    renderApplication(api, "/operations/configuration")

    // Then
    expect(await screen.findByRole("heading", { name: "运营概览" })).toBeVisible()
    expect(screen.queryByRole("heading", { name: "配置中心" })).not.toBeInTheDocument()
  })

  it("redirects an operator away from the work-log route", async () => {
    // Given
    const api = createAuthenticatedApi(operator)

    // When
    renderApplication(api, "/work-logs")

    // Then
    expect(await screen.findByRole("heading", { name: "运营概览" })).toBeVisible()
    expect(screen.queryByRole("heading", { name: "工作日志" })).not.toBeInTheDocument()
  })

  it("shows Configuration to an administrator", async () => {
    // Given
    const api = createAuthenticatedApi(administrator)

    // When
    renderApplication(api, "/studio/text-pool")

    // Then
    expect(await screen.findByRole("heading", { name: "文本池" })).toBeVisible()
    expect(screen.getByText("配置中心")).toBeVisible()
    expect(screen.getByText("管理员")).toBeVisible()
    expect(screen.getByText("工作日志")).toBeVisible()
    expect(screen.getByText("成员与权限")).toBeVisible()
    expect(screen.getByText("运营中心")).toBeVisible()
    expect(screen.getByText("工程中心")).toBeVisible()
  })

  it("redirects a department director away from work logs", async () => {
    const api = createAuthenticatedApi(operationsDirector)
    renderApplication(api, "/work-logs")
    expect(await screen.findByRole("heading", { name: "运营概览" })).toBeVisible()
    expect(screen.queryByRole("heading", { name: "工作日志" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "配置中心" })).toBeVisible()
    expect(screen.getByText("资源中心")).toBeVisible()
    expect(screen.queryByRole("link", { name: "工作日志" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "成员与权限" })).not.toBeInTheDocument()
  })

  it("does not select 运营中心 on first-level work logs and members", async () => {
    const api = createAuthenticatedApi(administrator)
    renderApplication(api, "/work-logs")
    expect(await screen.findByRole("heading", { name: "工作日志" })).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "运营中心" })).not.toHaveClass(
      "ant-menu-submenu-selected",
    )
    expect(screen.getByRole("link", { name: "工作日志" }).closest("li")).toHaveClass(
      "ant-menu-item-selected",
    )
  })
})
