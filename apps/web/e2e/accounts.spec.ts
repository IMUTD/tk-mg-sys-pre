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

test("renders the 云大师-aligned account management page", async ({ page }) => {
  await registerSession(page)
  await page.goto("/operations/accounts")

  await expect(page.getByText("user.alpha")).toBeVisible()
  await expect(page.getByRole("button", { name: "搜索" })).toBeVisible()
  await expect(page.getByRole("button", { name: "回收站" })).toBeVisible()
  await expect(page.getByRole("button", { name: "统计" })).toBeVisible()
  await expect(page.getByRole("button", { name: "转移码" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "UID/账号/密码" })).toBeVisible()
  await expect(page.getByText("复制密码").first()).toBeVisible()
  await expect(page.getByText("Acc#SeedAlpha")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "新建账号" })).toHaveCount(0)
  await expect(page.locator(".breadcrumb")).toContainText("账号管理")
})

test("recycles a selected account and restores it from the recycle bin", async ({ page }) => {
  await registerSession(page)
  await page.goto("/operations/accounts")
  await expect(page.getByText("user.bravo")).toBeVisible()

  await page.getByLabel("选择 user.bravo").click()
  await page.getByRole("button", { name: "删除" }).click()
  await page.getByRole("button", { name: "确定" }).click()
  await expect(page.getByText("user.bravo")).toHaveCount(0)

  await page.getByRole("button", { name: "回收站" }).click()
  await expect(
    page.getByText("这里只展示最近 7 天内删除的账号，恢复后会重新进入正常账号列表。"),
  ).toBeVisible()
  await page.getByRole("dialog").getByLabel("选择 user.bravo").click()
  await page.getByRole("dialog").getByRole("button", { name: "批量恢复" }).click()
  await page.getByRole("button", { name: "确定" }).click()
  await expect(page.getByText("已恢复 1 个账号")).toBeVisible()
})

test("opens account group statistics from the toolbar", async ({ page }) => {
  await registerSession(page)
  await page.goto("/operations/accounts")
  await expect(page.getByText("user.alpha")).toBeVisible()

  await page.getByRole("button", { name: "统计" }).click()
  await expect(page.getByText("今日剩余检测次数: 128")).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "封号率" })).toBeVisible()
})
