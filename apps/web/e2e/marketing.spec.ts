import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

const administrator = {
  email: "admin@example.com",
  scope: {
    groupIds: [],
    permissions: ["configuration:write"],
    role: "administrator",
  },
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}

const registerSession = async (page: Page): Promise<void> => {
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === "/api/auth/session") {
      await route.fulfill({
        body: JSON.stringify({ user: administrator }),
        contentType: "application/json",
      })
      return
    }
    await route.fallback()
  })
}

test("renders marketing dashboard kpis and trend after 运营概览", async ({ page }) => {
  await registerSession(page)
  await page.goto("/marketing/dashboard")

  await expect(page.getByText("账号销售额")).toBeVisible()
  await expect(page.getByText("剩余开窗账号数")).toBeVisible()
  await expect(page.getByLabel("销售折线图")).toBeVisible()
  await expect(page.locator(".breadcrumb")).toContainText("营销面板")
  await expect(page.getByRole("link", { name: "账号市场" })).toBeVisible()
  await expect(page.getByRole("link", { name: "节点市场" })).toBeVisible()
})

test("lists account and node markets with inventory markers", async ({ page }) => {
  await registerSession(page)
  await page.goto("/marketing/accounts")
  await expect(page.getByText("ACC-W-001")).toBeVisible()
  await expect(page.getByText("ACC-K-077")).toBeVisible()
  await expect(page.getByText("已开窗").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "更新" }).first()).toBeVisible()

  const accountRow = page.getByRole("row").filter({ hasText: "ACC-W-001" })
  await accountRow.getByRole("button", { name: "更新" }).click()
  const accountDialog = page.getByRole("dialog")
  await expect(accountDialog.getByLabel("开窗")).toBeVisible()
  await expect(accountDialog.getByLabel("价格")).toBeVisible()
  await expect(accountDialog.getByLabel("状态")).toBeVisible()
  await expect(accountDialog.getByLabel("粉丝量")).toHaveCount(0)
  await accountDialog.getByRole("button", { name: "确认" }).click()
  await expect(page.getByText("更新成功")).toBeVisible()

  await page.goto("/marketing/nodes")
  await expect(page.getByText("美东住宅 A")).toBeVisible()
  await expect(page.getByText("伦敦移动")).toBeVisible()
  await expect(page.getByText("售罄")).toBeVisible()
  await expect(page.getByRole("button", { name: "更新" }).first()).toBeVisible()
})
