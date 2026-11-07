import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

const administrator = {
  email: "admin@example.com",
  scope: {
    groupIds: [],
    pages: [],
    permissions: ["configuration:write"],
    role: "administrator",
  },
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}

const mallGroup = "11111111-1111-4111-8111-111111111111"

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
    if (pathname === "/api/mall/wallets") {
      await route.fulfill({
        body: JSON.stringify({ items: [{ balance: 59900, groupId: mallGroup, name: "一组" }] }),
        contentType: "application/json",
      })
      return
    }
    if (pathname === `/api/groups/${mallGroup}/mall/ledger`) {
      await route.fulfill({
        body: JSON.stringify({
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
        }),
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
  await expect(page.getByText("日本满季度白号")).toBeVisible()

  await page.goto("/operations/task-records")
  await expect(page.getByText("发布作品完成")).toBeVisible()
})

test("renders video pool and image pool under resource center", async ({ page }) => {
  await registerSession(page)
  await page.goto("/studio/video-pool")
  await expect(page.getByText("74820119301")).toBeVisible()
  await expect(page.locator(".breadcrumb")).toContainText("视频数据")

  await page.goto("/studio/image-pool")
  await expect(page.locator(".breadcrumb")).toContainText("图片池")
  await expect(page.getByRole("button", { name: "扫描盒子资源" })).toBeVisible()
})
