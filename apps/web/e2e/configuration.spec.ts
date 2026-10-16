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

test("renders the 云大师-aligned configuration list without secrets", async ({ page }) => {
  await registerSession(page)
  await page.goto("/operations/configuration")

  await expect(page.getByText("冰拓打码")).toBeVisible()
  await expect(page.getByRole("button", { name: "搜索" })).toBeVisible()
  await expect(page.getByRole("button", { name: "新增" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "额外参数" })).toBeVisible()
  await expect(page.getByText("喵提醒(喵码)")).toBeVisible()
  await expect(page.getByRole("button", { name: "新建配置" })).toHaveCount(0)
  await expect(page.locator("body")).not.toContainText("bingtop-secret")
  await expect(page.locator("body")).not.toContainText("minio-secret")
  await expect(page.locator(".breadcrumb")).toContainText("配置中心")
})

test("creates a config locally without posting to the settings API", async ({ page }) => {
  const requests = await registerSession(page)
  await page.goto("/operations/configuration")
  await expect(page.getByText("冰拓打码")).toBeVisible()

  await page.getByRole("button", { name: "新增" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("新增配置")).toBeVisible()
  await dialog.getByLabel("配置项").click()
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText("喵提醒(喵码)", { exact: true })
    .click()
  await dialog.getByLabel("账号").fill("miao-new")
  await dialog.getByLabel("密码").fill("new-config-secret")
  await dialog.getByRole("button", { name: "确认" }).click()

  await expect(page.getByText("新增成功")).toBeVisible()
  await expect(page.getByText("miao-new")).toBeVisible()
  await expect(page.locator("body")).not.toContainText("new-config-secret")
  expect(requests.some((item) => item.startsWith("POST ") || item.startsWith("PATCH "))).toBe(false)
})

test("hides configuration content from an operator", async ({ page }) => {
  await registerSession(page, {
    ...administrator,
    email: "operator@example.com",
    scope: { ...administrator.scope, role: "operator" },
  })

  await page.goto("/operations/configuration")

  await expect(page.getByText("哈蜜瓜云控 / 运营概览")).toBeVisible()
})
