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

test("renders points mall and operations job pages", async ({ page }) => {
  await registerSession(page)
  await page.goto("/mall/records")
  await expect(page.getByText("注册GG")).toBeVisible()
  await expect(page.locator(".breadcrumb")).toContainText("积分记录")

  await page.goto("/mall/redeem")
  await expect(page.getByText("日本满季度白号100个")).toBeVisible()

  await page.goto("/operations/task-records")
  await expect(page.getByText("发布作品完成")).toBeVisible()
})

test("renders video pool and image pool under resource center", async ({ page }) => {
  await registerSession(page)
  await page.goto("/studio/video-pool")
  await expect(page.getByText("74820119301")).toBeVisible()
  await expect(page.locator(".breadcrumb")).toContainText("视频池")

  await page.goto("/studio/image-pool")
  await expect(page.getByText("图片池白板")).toBeVisible()
})
