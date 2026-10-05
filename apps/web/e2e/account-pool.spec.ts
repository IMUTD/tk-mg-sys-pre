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

const registerSession = async (page: Page): Promise<string[]> => {
  const requests: string[] = []
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
    await route.fallback()
  })
  return requests
}

test("renders the 云大师-aligned account pool page", async ({ page }) => {
  await registerSession(page)
  await page.goto("/operations/account-pool")

  await expect(page.getByText("1107发布")).toBeVisible()
  await expect(page.getByRole("button", { name: "搜索" })).toBeVisible()
  await expect(page.getByRole("button", { name: "新增" })).toBeVisible()
  await expect(page.getByRole("button", { name: "创建账号池" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "备份方式" })).toBeVisible()
  await expect(page.getByText("1107养号")).toBeVisible()
  await expect(page.getByRole("button", { name: "新建账号池" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "租用" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "归还" })).toHaveCount(0)
  await expect(page.locator(".breadcrumb")).toContainText("账号池")
})

test("creates an account pool locally without posting to the operations API", async ({ page }) => {
  const requests = await registerSession(page)
  await page.goto("/operations/account-pool")
  await expect(page.getByText("1107发布")).toBeVisible()

  await page.getByRole("button", { name: "新增" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("新增账号池")).toBeVisible()
  await dialog.getByLabel("账号池名").fill("1109矩阵")
  await dialog.getByLabel("设备").click()
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText("192.168.76.130-270-亮18", { exact: true })
    .click()
  await dialog.getByLabel("账号分组").click()
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText(/亮2/, { exact: false })
    .click()
  await dialog.getByRole("button", { name: "确认" }).click()

  await expect(page.getByText("新增成功")).toBeVisible()
  await expect(page.getByText("1109矩阵")).toBeVisible()
  expect(requests.some((item) => item.startsWith("POST "))).toBe(false)
})
