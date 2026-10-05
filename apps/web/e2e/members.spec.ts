import { expect, test } from "@playwright/test"

import { chooseAntOption } from "./ant-select"

const administrator = {
  email: "admin@example.com",
  scope: {
    groupIds: ["11111111-1111-4111-8111-111111111111"],
    pages: [
      { canDelete: false, canView: true, key: "/overview" },
      { canDelete: false, canView: true, key: "/members" },
    ],
    permissions: ["configuration:write"],
    role: "administrator",
  },
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}

const fulfillJson = (
  route: {
    fulfill: (response: { body: string; contentType: string; status?: number }) => Promise<void>
  },
  body: unknown,
  status = 200,
): Promise<void> =>
  route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json",
    status,
  })

test("creates, searches, updates, and deletes a member through the administrator UI", async ({
  page,
}) => {
  let createdPayload: unknown = null
  let updatedPayload: unknown = null
  let deletedId: string | null = null
  let member = {
    createdAt: "2026-09-12T00:00:00.000Z",
    displayName: "路飞",
    email: "operator@example.com",
    enabled: true,
    groupIds: [] as string[],
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    role: "operator",
  }
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === "/api/auth/session") {
      await fulfillJson(route, { user: administrator })
      return
    }
    if (path === "/api/members/pages") {
      await fulfillJson(route, { items: [] })
      return
    }
    if (path === "/api/members/display-name") {
      await fulfillJson(route, { displayName: "路飞" })
      return
    }
    if (path === "/api/members" && request.method() === "GET") {
      await fulfillJson(route, { items: deletedId === member.id ? [] : [member] })
      return
    }
    if (path === "/api/members" && request.method() === "POST") {
      createdPayload = JSON.parse(request.postData() ?? "null")
      await fulfillJson(route, member, 201)
      return
    }
    if (path.endsWith(`/members/${member.id}`) && request.method() === "PATCH") {
      updatedPayload = JSON.parse(request.postData() ?? "null")
      member = { ...member, ...updatedPayload }
      await fulfillJson(route, member)
      return
    }
    if (path.endsWith(`/members/${member.id}`) && request.method() === "DELETE") {
      deletedId = member.id
      await route.fulfill({ status: 204, body: "", contentType: "text/plain" })
      return
    }
    await route.fallback()
  })

  await page.goto("/members")
  await page.getByRole("button", { name: "新建成员" }).click()
  const createDialog = page.getByRole("dialog", { name: "新建成员" })
  await expect(createDialog).toHaveAttribute("aria-modal", "true")
  await createDialog.getByRole("textbox", { name: "账号" }).fill("operator@example.com")
  await createDialog.getByLabel("初始密码").fill("member-password-123")
  await expect(createDialog.getByLabel("成员名字")).toHaveValue("路飞")
  await expect(createDialog.getByRole("button", { name: "换一个名字" })).toBeVisible()
  await page.getByRole("button", { name: "创建成员" }).click()
  await expect(page.getByRole("cell", { exact: true, name: "路飞" })).toBeVisible()
  await expect(page.getByRole("cell", { name: "运营员" })).toBeVisible()
  await expect(page.getByLabel("复制账号 operator@example.com")).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "密码" })).toHaveCount(0)
  await expect(page.getByText("member-password-123")).toHaveCount(0)
  await page.getByLabel("搜索成员").fill("operator@")
  await page.getByRole("button", { name: "编辑 路飞" }).first().click()
  await chooseAntOption(page, "角色", "管理员")
  await page.getByRole("switch", { name: "启用成员" }).click()
  await page.getByRole("button", { name: "保存成员" }).click()

  await expect(page.getByRole("cell", { exact: true, name: "停用" })).toBeVisible()
  await expect(page.getByRole("cell", { exact: true, name: "管理员" })).toBeVisible()
  await expect(page.getByText("全部权限")).toBeVisible()
  await expect(page.getByRole("button", { name: "配置 路飞 的成员权限" })).toHaveCount(0)
  expect(createdPayload).toMatchObject({
    displayName: "路飞",
    password: "member-password-123",
    role: "operator",
  })
  expect(updatedPayload).toMatchObject({
    enabled: false,
    role: "administrator",
  })

  await page.getByRole("button", { name: "删除 路飞" }).click()
  await page.getByRole("dialog", { name: "删除成员" }).getByRole("button", { name: "删除" }).click()
  await expect(page.getByText("暂无成员")).toBeVisible()
  expect(deletedId).toBe(member.id)
})

test("hides the members page from non-administrators", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/api/auth/session") {
      await fulfillJson(route, {
        user: {
          email: "operator@example.com",
          scope: {
            groupIds: [],
            pages: [{ canDelete: false, canView: true, key: "/overview" }],
            permissions: [],
            role: "operator",
          },
          userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        },
      })
      return
    }
    await route.fallback()
  })

  await page.goto("/members")
  await expect(page).toHaveURL(/\/overview$/)
  await expect(page.getByText("成员与权限")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "新建成员" })).toHaveCount(0)
})

test("opens per-member permissions after create and saves the final page matrix", async ({
  page,
}) => {
  let savedPayload: unknown = null
  const member = {
    createdAt: "2026-09-12T00:00:00.000Z",
    displayName: "鸣人",
    email: "operator@example.com",
    enabled: true,
    groupIds: [],
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    role: "operator",
  }
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === "/api/auth/session") {
      await fulfillJson(route, { user: administrator })
      return
    }
    if (path === "/api/members" && request.method() === "GET") {
      await fulfillJson(route, { items: [member] })
      return
    }
    if (path === `/api/members/${member.id}/permissions` && request.method() === "GET") {
      await fulfillJson(route, {
        items: [{ canDelete: false, canView: true, key: "/operations/devices" }],
      })
      return
    }
    if (path === `/api/members/${member.id}/permissions` && request.method() === "PUT") {
      savedPayload = JSON.parse(request.postData() ?? "null")
      const body = savedPayload as { pages?: unknown }
      await fulfillJson(route, { items: body.pages ?? [] })
      return
    }
    await route.fallback()
  })

  await page.goto("/members")
  await expect(page.getByRole("tab", { name: "角色权限" })).toHaveCount(0)
  await expect(page.getByText("授权分组")).toHaveCount(0)
  await page.getByRole("button", { name: "配置 鸣人 的成员权限" }).click()
  await expect(page.getByRole("dialog", { name: "成员权限 · 鸣人" })).toBeVisible()
  await expect(page.getByLabel("盒子管理可查看")).toBeChecked()
  await page.getByLabel("盒子管理可删除").check()
  await page.getByRole("button", { name: "保存权限" }).click()
  await expect
    .poll(() => savedPayload)
    .toMatchObject({
      pages: expect.arrayContaining([
        { canDelete: true, canView: true, key: "/operations/devices" },
      ]),
    })
})
