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

test("shows behavior chains with a cloud tester on the right", async ({ page }) => {
  await registerSession(page)
  await page.goto("/engineering/behaviors")

  await expect(page.getByText("早班养号")).toBeVisible()
  await expect(page.getByText("晚间巡检")).toBeVisible()
  await expect(page.getByText("AI制定")).toBeVisible()
  await expect(page.getByText("RPA编排")).toBeVisible()
  await expect(page.getByText("接口测试")).toBeVisible()
  await expect(page.getByLabel("测试云机")).toBeVisible()
  await expect(page.locator(".breadcrumb")).toContainText("行为中心")

  await page.getByText("接口测试").click()
  await expect(page.getByText("TouchClick")).toBeVisible()
  await page.getByRole("button", { name: "测试" }).click()
  await expect(page.getByText("接口测试成功")).toBeVisible()
})
