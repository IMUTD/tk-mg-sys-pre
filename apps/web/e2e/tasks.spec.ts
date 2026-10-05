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

test("renders the 云大师-aligned task list page", async ({ page }) => {
  await registerSession(page)
  await page.goto("/operations/tasks")

  await expect(page.getByText("5001")).toBeVisible()
  await expect(page.getByRole("button", { name: "搜索" })).toBeVisible()
  await expect(page.getByRole("button", { name: "新增" })).toBeVisible()
  await expect(page.getByRole("button", { name: /查看正在执行/ })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "执行进度" })).toBeVisible()
  await expect(page.getByText("养号任务")).toBeVisible()
  await expect(page.getByRole("button", { name: "新建任务" })).toHaveCount(0)
  await expect(page.locator(".breadcrumb")).toContainText("任务列表")
})

test("creates a task locally without posting to the operations API", async ({ page }) => {
  const requests = await registerSession(page)
  await page.goto("/operations/tasks")
  await expect(page.getByText("5001")).toBeVisible()

  await page.getByRole("button", { name: "新增" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("新增任务")).toBeVisible()
  await dialog.getByLabel("功能").click()
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText("养号 (v2.0.1)", { exact: true })
    .click()
  await dialog.getByLabel("设备").click()
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText("192.168.76.130-270-亮18", { exact: true })
    .click()
  await page.keyboard.press("Escape")
  await dialog.getByLabel("机位").click()
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText("2", { exact: true })
    .click()
  await dialog.getByRole("button", { name: "确认" }).click()

  await expect(page.getByText("新增成功，请在列表手动启动")).toBeVisible()
  await expect(page.getByText("5007")).toBeVisible()
  expect(requests.some((item) => item.startsWith("POST "))).toBe(false)
})

test("terminates a running task from the list", async ({ page }) => {
  await registerSession(page)
  await page.goto("/operations/tasks")
  await expect(page.getByText("养号任务")).toBeVisible()

  const row = page.getByRole("row").filter({ hasText: "5003" })
  await row.getByRole("button", { name: "终止" }).click()
  await page.getByRole("button", { name: "确定" }).click()

  await expect(page.getByText("已终止").first()).toBeVisible()
  await expect(row.getByText("已终止")).toBeVisible()
})
