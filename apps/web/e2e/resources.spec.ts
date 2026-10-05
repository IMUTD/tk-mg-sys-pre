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

test("renders the 云大师-aligned resource pool page", async ({ page }) => {
  // Given
  await registerSession(page)

  // When
  await page.goto("/studio/text-pool")

  // Then
  await expect(page.getByText("这个视频太好看了，已关注")).toBeVisible()
  await expect(page.getByRole("button", { name: "搜索" })).toBeVisible()
  await expect(page.getByRole("button", { name: "批量导入" })).toBeVisible()
  await expect(page.getByRole("button", { name: "统计" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "资源内容" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "已分配次数" })).toBeVisible()
  await expect(page.locator(".breadcrumb")).toContainText("文本池")
})

test("imports materials one line at a time", async ({ page }) => {
  // Given
  await registerSession(page)
  await page.goto("/studio/text-pool")
  await expect(page.getByText("这个视频太好看了，已关注")).toBeVisible()

  // When
  await page.getByRole("button", { name: "批量导入" }).click()
  await page.getByLabel("导入标签").fill("新评论")
  await page.getByLabel("素材内容").fill("第一条素材\n第二条素材")
  await page.getByRole("button", { name: "确认导入" }).click()

  // Then
  await expect(page.getByText("第一条素材")).toBeVisible()
  await expect(page.getByText("导入成功！共导入 2 条素材")).toBeVisible()
})

test("opens tag statistics from the toolbar", async ({ page }) => {
  // Given
  await registerSession(page)
  await page.goto("/studio/text-pool")
  await expect(page.getByText("这个视频太好看了，已关注")).toBeVisible()

  // When
  await page.getByRole("button", { name: "统计" }).click()

  // Then
  await expect(page.getByText("标签素材统计")).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "数量" })).toBeVisible()
})
