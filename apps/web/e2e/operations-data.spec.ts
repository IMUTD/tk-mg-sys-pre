import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

const groupId = "11111111-1111-4111-8111-111111111111"
const resourceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const sessionUser = {
  email: "operator@example.com",
  scope: {
    groupIds: [groupId],
    permissions: ["operations:read", "operations:write"],
    role: "operator",
  },
  userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
}
const resource = {
  category: "邮箱",
  createdAt: "2026-09-12T00:00:00.000Z",
  groupId,
  id: resourceId,
  name: "研发邮箱",
  note: "",
  status: "available",
  tags: ["研发"],
  updatedAt: "2026-09-12T00:00:00.000Z",
}

const registerOperationsApi = async (
  page: Page,
  groupIds: readonly string[] = [groupId],
): Promise<{ readonly requests: string[] }> => {
  const requests: string[] = []
  let activeLease = false
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    requests.push(`${request.method()} ${pathname}`)
    if (pathname === "/api/auth/session") {
      await route.fulfill({
        body: JSON.stringify({
          user: { ...sessionUser, scope: { ...sessionUser.scope, groupIds } },
        }),
        contentType: "application/json",
      })
      return
    }
    if (pathname.endsWith("/account-pool")) {
      await route.fulfill({
        body: JSON.stringify({
          items: [
            {
              account: {
                id: resourceId,
                identifier: "pool@example.com",
                name: "池账号",
                status: "ready",
                tags: ["研发"],
              },
              activeLease: activeLease
                ? {
                    createdAt: "2026-09-12T00:00:00.000Z",
                    expiresAt: null,
                    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    leasedByUserId: sessionUser.userId,
                  }
                : null,
            },
          ],
        }),
        contentType: "application/json",
      })
      return
    }
    if (pathname.includes("/account-pool/") && pathname.endsWith("/leases")) {
      if (request.method() === "POST") activeLease = true
      if (request.method() === "DELETE") activeLease = false
      await route.fulfill({
        status: request.method() === "POST" ? 201 : 204,
        body:
          request.method() === "POST"
            ? JSON.stringify({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" })
            : undefined,
        contentType: "application/json",
      })
      return
    }
    if (pathname.endsWith("/allocations")) {
      await route.fulfill({
        body: JSON.stringify({ items: [] }),
        contentType: "application/json",
      })
      return
    }
    if (pathname.includes("/operations/resources/") && request.method() === "PATCH") {
      await route.fulfill({ body: JSON.stringify(resource), contentType: "application/json" })
      return
    }
    if (pathname.endsWith("/resources")) {
      await route.fulfill({
        body: JSON.stringify(
          request.method() === "GET"
            ? { items: [resource], page: 1, pageSize: 20, total: 1 }
            : resource,
        ),
        contentType: "application/json",
        status: request.method() === "POST" ? 201 : 200,
      })
      return
    }
    if (pathname.endsWith("/accounts") || pathname.endsWith("/proxies")) {
      await route.fulfill({
        body: JSON.stringify(
          request.method() === "GET"
            ? { items: [resource], page: 1, pageSize: 20, total: 1 }
            : resource,
        ),
        contentType: "application/json",
        status: request.method() === "POST" ? 201 : 200,
      })
      return
    }
    if (pathname.endsWith("/batch/delete")) {
      await route.fulfill({
        body: JSON.stringify({ affected: 1 }),
        contentType: "application/json",
      })
      return
    }
    await route.fallback()
  })
  return { requests }
}

test("renders the 云大师 account pool without posting lease requests", async ({ page }) => {
  const api = await registerOperationsApi(page)

  await page.goto("/operations/account-pool")

  await expect(page.getByText("1107发布")).toBeVisible()
  await expect(page.getByRole("button", { name: "创建账号池" })).toBeVisible()
  await expect(page.getByRole("button", { name: "租用" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "归还" })).toHaveCount(0)
  expect(api.requests.some((item) => item.includes("/leases"))).toBe(false)
})
