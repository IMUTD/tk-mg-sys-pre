import { expect, test } from "@playwright/test"

const administrator = {
  email: "admin@example.com",
  scope: { groupIds: [], permissions: ["configuration:write"], role: "administrator" },
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}

test("filters paginated audit events without mutation controls", async ({ page }) => {
  // Given
  let requested = ""
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/api/auth/session") {
      await route.fulfill({
        body: JSON.stringify({ user: administrator }),
        contentType: "application/json",
      })
      return
    }
    if (path === "/api/audit") {
      requested = route.request().url()
      await route.fulfill({
        body: JSON.stringify({
          items: [
            {
              action: "member.update",
              actorId: administrator.userId,
              createdAt: "2026-09-12T00:00:00.000Z",
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              metadata: { groupId: "11111111-1111-4111-8111-111111111111" },
              outcome: "allowed",
              target: "member:operator",
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
        }),
        contentType: "application/json",
      })
      return
    }
    await route.fallback()
  })

  // When
  await page.goto("/work-logs")
  await expect(page.getByText("哈蜜瓜云控 / 工作日志")).toBeVisible()
  await page.getByLabel("操作筛选").fill("member.update")
  await page.getByRole("button", { name: "查询" }).click()

  // Then
  await expect.poll(() => requested).toContain("action=member.update")
  await expect(page.getByText("member:operator")).toBeVisible()
  await expect(page.getByRole("button", { name: /删除|编辑|新建/ })).toHaveCount(0)
  const startBox = await page.getByText("开始时间", { exact: true }).boundingBox()
  const endBox = await page.getByText("结束时间", { exact: true }).boundingBox()
  expect(startBox).not.toBeNull()
  expect(endBox).not.toBeNull()
  if (startBox === null || endBox === null) throw new Error("missing time labels")
  expect(endBox.y).toBeGreaterThan(startBox.y)
})

test("keeps audit filters inside the desktop viewport", async ({ page }) => {
  // Given
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/api/auth/session") {
      await route.fulfill({
        body: JSON.stringify({ user: administrator }),
        contentType: "application/json",
      })
      return
    }
    if (path === "/api/audit") {
      await route.fulfill({
        body: JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 }),
        contentType: "application/json",
      })
      return
    }
    await route.fallback()
  })
  await page.setViewportSize({ height: 900, width: 1440 })

  // When
  await page.goto("/work-logs")

  // Then
  const scrollWidth = await page.locator("html").evaluate((element) => element.scrollWidth)
  expect(scrollWidth).toBeLessThanOrEqual(1440)
})
