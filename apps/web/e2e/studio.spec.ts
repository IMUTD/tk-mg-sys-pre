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

test("renders resource studio whiteboards", async ({ page }) => {
  await registerSession(page)
  await page.goto("/studio/video")
  await expect(page.getByText("视频制作白板")).toBeVisible()
  await expect(page.locator(".breadcrumb")).toContainText("视频制作")
  await expect(page.getByRole("link", { name: "图片制作" })).toBeVisible()
  await expect(page.getByRole("link", { name: "文本制作" })).toBeVisible()

  await page.goto("/studio/image")
  await expect(page.getByText("图片制作白板")).toBeVisible()

  await page.goto("/studio/text")
  await expect(page.getByText("文本制作白板")).toBeVisible()
})
