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

test("renders robot cards bound to shared behavior chains", async ({ page }) => {
  await registerSession(page)
  await page.goto("/engineering/robots")

  await expect(page.getByText("美区养号")).toBeVisible()
  await expect(page.getByText("晚班日更")).toBeVisible()
  await expect(page.getByRole("button", { name: "立即执行" }).first()).toBeVisible()
  await expect(page.getByText("AI养号")).toHaveCount(0)
  await expect(page.locator(".breadcrumb")).toContainText("运营机器人")
})

test("creates a robot locally from a saved behavior chain", async ({ page }) => {
  const requests = await registerSession(page)
  await page.goto("/engineering/robots")
  await expect(page.getByText("美区养号")).toBeVisible()

  await page.getByRole("button", { name: "新增" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("新增")).toBeVisible()
  await dialog.getByLabel("名称").fill("试运行")
  await dialog.getByLabel("行为链").click()
  await page.getByTitle("早班养号").click()
  await dialog.getByRole("button", { name: "确认" }).click()

  await expect(page.getByText("新增成功")).toBeVisible()
  await expect(page.getByText("试运行")).toBeVisible()
  expect(requests.some((item) => item.startsWith("POST ") || item.startsWith("PATCH "))).toBe(false)
})
