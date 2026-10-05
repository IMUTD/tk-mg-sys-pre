import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

const groupId = "11111111-1111-4111-8111-111111111111"

const sessionUser = {
  email: "operator@example.com",
  scope: {
    groupIds: [groupId],
    permissions: ["resources:read", "resources:write"],
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

test("renders the 云大师-aligned registration resource page", async ({ page }) => {
  // Given
  await registerSession(page)

  // When
  await page.goto("/studio/registration")

  // Then
  await expect(page.getByText("xxx12143@gmail.com")).toBeVisible()
  await expect(page.getByRole("button", { name: "搜索" })).toBeVisible()
  await expect(page.getByRole("button", { name: "智能导入" })).toBeVisible()
  await expect(page.getByRole("button", { name: "统计" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "智能解析" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "分配状态" })).toBeVisible()
  await expect(page.locator(".breadcrumb")).toContainText("注册池")
})

test("parses smart import data before writing a tagged batch", async ({ page }) => {
  // Given
  await registerSession(page)
  await page.goto("/studio/registration")
  await expect(page.getByText("xxx12143@gmail.com")).toBeVisible()

  // When
  await page.getByRole("button", { name: "智能导入" }).click()
  await page.getByLabel("原始数据").fill("new@gmail.com----password----help@outlook.com")
  await expect(page.getByRole("button", { name: "解析数据" })).toBeEnabled()
  await page.getByRole("button", { name: "解析数据" }).click()
  await expect(page.getByText("检测到 1 行数据，每行 3 个字段")).toBeVisible()
  await page.getByRole("button", { name: "执行导入" }).click()
  await page.getByLabel("分组名称").fill("batch01")
  await page.getByRole("button", { name: "确认导入" }).click()

  // Then
  await expect(page.getByText("new@gmail.com")).toBeVisible()
  await expect(page.getByText("智能导入成功，共导入1条数据")).toBeVisible()
})

test("downloads the current registration resource export", async ({ page }) => {
  // Given
  await registerSession(page)
  await page.goto("/studio/registration")
  await expect(page.getByText("xxx12143@gmail.com")).toBeVisible()

  // When
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出" }).click()
  const download = await downloadPromise

  // Then
  expect(download.suggestedFilename()).toBe("注册池.csv")
})
