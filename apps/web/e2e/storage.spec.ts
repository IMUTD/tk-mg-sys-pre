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

const registerSession = async (page: Page, user = administrator): Promise<string[]> => {
  const requests: string[] = []
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    requests.push(`${request.method()} ${pathname}`)
    if (pathname === "/api/auth/session") {
      await route.fulfill({
        body: JSON.stringify({ user }),
        contentType: "application/json",
      })
      return
    }
    await route.fallback()
  })
  return requests
}

test("renders NAS and SQL storage cards without secrets", async ({ page }) => {
  await registerSession(page)
  await page.goto("/engineering/storage")

  await expect(page.getByText("主 NAS")).toBeVisible()
  await expect(page.getByText("配置NAS")).toBeVisible()
  await expect(page.getByText("配置SQL类型数据库")).toBeVisible()
  await expect(page.getByRole("button", { name: "全量备份" }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: "定时备份" }).first()).toBeVisible()
  await expect(page.locator("body")).not.toContainText("nas-secret")
  await expect(page.getByText("私有云储存尚未配置")).toHaveCount(0)
  await expect(page.locator(".breadcrumb")).toContainText("私有云储存")

  await page.getByText("配置SQL类型数据库").click()
  await expect(page.getByText("运营库")).toBeVisible()
  await expect(page.locator("body")).not.toContainText("sql-ops-secret")
})

test("creates a NAS target locally after testing the connection", async ({ page }) => {
  const requests = await registerSession(page)
  await page.goto("/engineering/storage")
  await expect(page.getByText("主 NAS")).toBeVisible()

  await page.getByRole("button", { name: "新增" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("新增 NAS")).toBeVisible()
  await dialog.getByLabel("名称").fill("热备 NAS")
  await dialog.getByLabel("主机").fill("nas-hot.internal")
  await dialog.getByLabel("根目录").fill("/hot")
  await dialog.getByLabel("密码").fill("hot-nas-secret")
  await dialog.getByRole("button", { name: "测试连接" }).click()
  await expect(page.getByText("连接成功")).toBeVisible()
  await dialog.getByRole("button", { name: "确认" }).click()

  await expect(page.getByText("新增成功")).toBeVisible()
  await expect(page.getByText("热备 NAS")).toBeVisible()
  await expect(page.locator("body")).not.toContainText("hot-nas-secret")
  expect(requests.some((item) => item.startsWith("POST ") || item.startsWith("PATCH "))).toBe(false)
})
