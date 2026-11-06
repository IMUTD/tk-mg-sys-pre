import { expect, test } from "@playwright/test"

test("redirects an unauthenticated operator to the login page", async ({ page }) => {
  // Given
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: "authentication_required" }),
      contentType: "application/json",
      status: 401,
    })
  })

  // When
  await page.goto("/operations/devices")

  // Then
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible()
})

test("does not expose Configuration to an operator", async ({ page }) => {
  // Given
  let requestedSessionPath = ""
  await page.route("**/api/auth/session", async (route) => {
    requestedSessionPath = new URL(route.request().url()).pathname
    await route.fulfill({
      body: JSON.stringify({
        user: {
          email: "operator@example.com",
          scope: {
            groupIds: ["11111111-1111-4111-8111-111111111111"],
            pages: [
              { canDelete: false, canView: true, key: "/overview" },
              { canDelete: false, canView: true, key: "/operations/devices" },
            ],
            permissions: ["resources:read"],
            role: "operator",
          },
          userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        },
      }),
      contentType: "application/json",
      status: 200,
    })
  })

  // When
  await page.goto("/operations/resources")

  // Then
  await expect(page.getByRole("link", { name: "配置中心" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "工作日志" })).toHaveCount(0)
  expect(requestedSessionPath).toBe("/api/auth/session")
})

test("navigates an administrator to the overview after successful login", async ({ page }) => {
  // Given
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: "authentication_required" }),
      contentType: "application/json",
      status: 401,
    })
  })
  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        user: {
          email: "admin@example.com",
          scope: {
            groupIds: [],
            pages: [
              { canDelete: false, canView: true, key: "/overview" },
              { canDelete: false, canView: true, key: "/members" },
            ],
            permissions: ["configuration:write", "resources:read"],
            role: "administrator",
          },
          userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      }),
      contentType: "application/json",
      status: 200,
    })
  })

  // When
  await page.goto("/login")
  await page.getByRole("textbox", { name: "邮箱" }).fill("admin@example.com")
  await page.getByLabel("密码").fill("correct-horse-battery-staple")
  await page.getByRole("button", { name: "登录" }).click()

  // Then
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("tk-mg.remembered-login")))
    .toBe(JSON.stringify({ email: "admin@example.com" }))
  await expect(page.getByText("哈蜜瓜云控 / 运营概览")).toBeVisible()
  await expect(page.getByRole("link", { name: "配置中心" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "成员与权限" })).toBeVisible()
})
