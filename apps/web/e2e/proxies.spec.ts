import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

const groupId = "11111111-1111-4111-8111-111111111111"

const sessionUser = {
  email: "operator@example.com",
  scope: {
    groupIds: [groupId],
    permissions: ["operations:read", "operations:write"],
    role: "operator",
  },
  userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
}

const registerSession = async (page: Page): Promise<void> => {
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === "/api/auth/session") {
      await route.fulfill({
        body: JSON.stringify({ user: sessionUser }),
        contentType: "application/json",
      })
      return
    }
    await route.fallback()
  })
}

test("renders the 云大师-aligned proxy management page", async ({ page }) => {
  await registerSession(page)
  await page.goto("/operations/proxies")

  await expect(page.getByText("华东代理")).toBeVisible()
  await expect(page.getByRole("button", { name: "搜索" })).toBeVisible()
  await expect(page.getByRole("button", { name: "新增" })).toBeVisible()
  await expect(page.getByRole("button", { name: "批量导入" })).toBeVisible()
  await expect(page.getByRole("button", { name: "常见问题" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "IP端口" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "检测结果" })).toBeVisible()
  await expect(page.getByText("proxy-east-secret")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "新建代理" })).toHaveCount(0)
  await expect(page.locator(".breadcrumb")).toContainText("代理管理")
})

test("imports a SOCKS proxy without showing the password", async ({ page }) => {
  await registerSession(page)
  await page.goto("/operations/proxies")
  await expect(page.getByText("华东代理")).toBeVisible()

  await page.getByRole("button", { name: "批量导入" }).click()
  await page.getByLabel("代理内容").fill("10.0.0.9|9090|imp-user|imp-pass")
  await page.getByRole("button", { name: "确认导入" }).click()

  await expect(page.getByText("10.0.0.9:9090")).toBeVisible()
  await expect(page.getByText("imp-pass")).toHaveCount(0)
})
