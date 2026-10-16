import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import type { PoolWrite } from "../src/features/account-pool/api"
import { createPoolTestApi } from "../src/test/account-pool-fixtures"

const groupId = "11111111-1111-4111-8111-111111111111"

const sessionUser = {
  email: "operator@example.com",
  scope: {
    groupIds: [groupId],
    permissions: ["operations:read", "operations:write"],
    role: "operator",
    pages: ["/operations/account-pool", "/operations/accounts", "/operations/devices"].map(
      (key) => ({ key, canView: true, canDelete: true }),
    ),
  },
  userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
}

const registerSession = async (page: Page): Promise<string[]> => {
  const requests: string[] = []
  const { api } = createPoolTestApi()
  const root = `/api/groups/${groupId}/operations/account-pools`
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    requests.push(`${request.method()} ${pathname}`)
    if (pathname === "/api/auth/session") {
      await route.fulfill({
        body: JSON.stringify({ user: sessionUser }),
        contentType: "application/json",
      })
      return
    }
    let body: unknown
    let status = 200
    if (pathname === "/api/labels/catalog") {
      body = {
        groups: [],
        remarks: [],
        canDelete: false,
        administratorId: null,
        scope: new URL(request.url()).searchParams.get("scope") ?? "account",
      }
    } else if (pathname === `${root}/devices`) {
      body = { items: await api.devices(groupId) }
    } else if (pathname === `${root}/sources`) {
      const input = request.postDataJSON()
      body = await api.sources(groupId, input.filter, input.page, input.pageSize)
    } else if (pathname === `${root}/batch-delete`) {
      await api.remove(groupId, request.postDataJSON().ids)
      body = { deleted: request.postDataJSON().ids.length }
    } else if (pathname === root && request.method() === "POST") {
      const input = request.postDataJSON() as PoolWrite & {
        desk?: Parameters<typeof api.createDesk>[1]
        name?: string
      }
      body =
        input.desk === undefined
          ? await api.create(groupId, input)
          : await api.createDesk(groupId, input.desk, input.name ?? "")
      status = 201
    } else if (pathname === root) {
      const query = new URL(request.url()).searchParams
      body = await api.list(groupId, {
        id: query.get("id") ?? "",
        key: query.get("key") ?? "",
        remark: query.get("remark") ?? "",
        page: Number(query.get("page") ?? 1),
        pageSize: Number(query.get("pageSize") ?? 10),
      })
    } else if (pathname.startsWith(`${root}/`)) {
      body = await api.details(groupId, pathname.slice(root.length + 1))
    } else {
      await route.fulfill({
        status: 404,
        body: JSON.stringify({ error: "unmocked_endpoint" }),
        contentType: "application/json",
      })
      return
    }
    await route.fulfill({ status, body: JSON.stringify(body), contentType: "application/json" })
  })
  return requests
}

test("renders the 云大师-aligned account pool page", async ({ page }) => {
  await registerSession(page)
  await page.goto("/operations/account-pool")

  await expect(page.getByText("1107发布")).toBeVisible()
  await expect(page.getByRole("button", { name: "搜索" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "新增" })).toBeVisible()
  await expect(page.getByRole("button", { name: "创建账号池" })).toHaveCount(0)
  await expect(page.getByRole("columnheader", { name: "命名" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "备份方式" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "重置" })).toHaveCount(0)
  await expect(page.getByText("1107养号")).toBeVisible()
  await expect(page.getByRole("button", { name: "新建账号池" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "租用" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "归还" })).toHaveCount(0)
  await expect(page.locator(".breadcrumb")).toContainText("账号池")
})

test("creates an account pool through the API and retains it after refresh", async ({ page }) => {
  const requests = await registerSession(page)
  await page.goto("/operations/account-pool")
  await expect(page.getByText("1107发布")).toBeVisible()

  await page.getByRole("button", { name: "新增" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("新增账号池")).toBeVisible()
  await dialog.getByRole("button", { name: "正常", exact: true }).click()
  await expect(dialog.getByText("账号状态=正常")).toBeVisible()
  await dialog.getByRole("button", { name: "确认" }).click()

  await expect(page.getByText("新增成功")).toBeVisible()
  await expect(page.getByText("账号状态=正常")).toBeVisible()
  expect(requests).toContain(`POST /api/groups/${groupId}/operations/account-pools`)
  await page.reload()
  await expect(page.getByText("账号状态=正常")).toBeVisible()
  await expect(page.getByText("Acc#SeedAlpha")).toHaveCount(0)
})

test("creates selected UUIDs across pages and deletes through the API", async ({ page }) => {
  const requests = await registerSession(page)
  await page.goto("/operations/account-pool")
  await expect(page.getByRole("button", { name: "创建账号池" })).toHaveCount(0)
  await page.getByRole("button", { name: "新增", exact: true }).click()
  const dialog = page.getByRole("dialog")
  const save = page.waitForResponse(
    (result) =>
      result.request().method() === "POST" &&
      result.url().endsWith(`/groups/${groupId}/operations/account-pools`),
  )
  await dialog.getByRole("button", { name: "封号", exact: true }).click()
  await dialog.getByRole("button", { name: "确认", exact: true }).click()
  const response = await save
  expect(response.request().postDataJSON()).toMatchObject({
    desk: { status: "1" },
  })
  await expect(page.getByText("账号状态=封号")).toBeVisible()
  await page.reload()
  const row = page.getByRole("row").filter({ hasText: "账号状态=封号" })
  await row.getByRole("button", { name: "删除", exact: true }).click()
  await page.getByRole("button", { name: "确定", exact: true }).click()
  await expect(page.getByText("删除成功")).toBeVisible()
  expect(requests).toContain(`POST /api/groups/${groupId}/operations/account-pools/batch-delete`)
  await page.reload()
  await expect(page.getByText("1107发布")).toBeVisible()
  await expect(page.getByText("账号状态=封号")).toHaveCount(0)
})
