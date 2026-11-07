import { mkdir } from "node:fs/promises"
import { expect, type Page, test } from "@playwright/test"
import type { IdentitySummary } from "../src/features/identity-verification/api"
import { defaultPagesForRole } from "../src/lib/pages"

const evidenceDirectory = "/tmp/tk-mg-profile-qa"
const initial: IdentitySummary = {
  mode: "optional",
  required: false,
  canVerify: true,
  status: "unverified",
  canAccessBusiness: true,
  version: 0,
  isPlatformAdmin: false,
  currentAttemptId: null,
  maskedName: null,
  maskedNumber: null,
  lastErrorCode: null,
  verifiedAt: null,
  providerAvailable: true,
  consentVersion: "2026-11-05-v1",
}

const registerProfileApi = async (page: Page, identity = initial) => {
  let current = identity
  const unexpectedRequests: string[] = []
  const submissions: string[] = []
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/api/auth/session") {
      await route.fulfill({
        json: {
          user: {
            userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            displayName: "测试管理员",
            email: "tenant@example.com",
            isPlatformAdmin: false,
            identity: current,
            scope: {
              groupIds: [],
              pages: defaultPagesForRole("administrator"),
              permissions: [],
              role: "administrator",
            },
          },
        },
      })
      return
    }
    if (path === "/api/identity-verification/me") {
      await route.fulfill({ json: current })
      return
    }
    if (path === "/api/identity-verification/attempts" && route.request().method() === "POST") {
      submissions.push(route.request().postData() ?? "")
      current = {
        ...current,
        status: "verified",
        canAccessBusiness: true,
        version: 1,
        currentAttemptId: "test-attempt",
        maskedName: "测*",
        maskedNumber: "110***********002X",
        verifiedAt: "2026-11-07T07:00:00.000Z",
      }
      await route.fulfill({
        json: {
          attempt: {
            id: "test-attempt",
            status: "verified",
            errorCode: null,
            startedAt: "2026-11-07T07:00:00.000Z",
            finishedAt: "2026-11-07T07:00:00.000Z",
          },
        },
      })
      return
    }
    unexpectedRequests.push(path)
    await route.fulfill({ status: 500, json: { error: "unexpected_test_request" } })
  })
  return { unexpectedRequests, submissions }
}

test.beforeAll(async () => {
  await mkdir(evidenceDirectory, { recursive: true })
})

test("opens personal details and verification from the account menu", async ({ page }) => {
  // Given
  const fixture = await registerProfileApi(page)
  await page.goto("/identity-verifications")
  await expect(page.getByText("仅平台管理员可以管理实名认证")).toBeVisible()

  // When
  await page.locator(".account-menu-trigger").click()
  await page.getByRole("menuitem", { name: "个人资料" }).click()

  // Then
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByText("tenant@example.com", { exact: true })).toBeVisible()
  await expect(page.getByLabel("身份证人像面", { exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "实名认证", exact: true })).toHaveCount(0)
  await page.screenshot({ path: `${evidenceDirectory}/profile-desktop.png`, fullPage: true })
  expect(fixture.unexpectedRequests).toEqual([])
})

test("keeps a successful verification in the profile and restores business access", async ({
  page,
}) => {
  // Given
  const fixture = await registerProfileApi(page, {
    ...initial,
    mode: "enforced",
    required: true,
    canAccessBusiness: false,
  })
  await page.goto("/operations/devices")
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByRole("button", { name: "提交认证" })).toBeDisabled()
  await expect(page.getByRole("link", { name: "盒子管理" })).toHaveCount(0)
  await page.screenshot({ path: `${evidenceDirectory}/profile-enforced.png`, fullPage: true })
  await page.getByLabel("身份证人像面", { exact: true }).setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a27sAAAAASUVORK5CYII=",
      "base64",
    ),
  })
  await expect(page.getByRole("button", { name: "提交认证" })).toBeDisabled()
  await page.getByRole("checkbox").check()

  // When
  await page.getByRole("button", { name: "提交认证" }).click()

  // Then
  await expect(page.getByText("已认证", { exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "盒子管理" })).toBeVisible()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByLabel("身份证人像面", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "进入系统" })).toHaveCount(0)
  await expect(page.getByText("110***********002X", { exact: true })).toHaveCount(0)
  await page.screenshot({ path: `${evidenceDirectory}/profile-verified.png`, fullPage: true })
  expect(fixture.submissions).toHaveLength(1)
  expect(fixture.submissions[0]).toContain('name="consentAccepted"')
  expect(fixture.unexpectedRequests).toEqual([])
})

test("redirects a bookmarked verification page into personal details", async ({ page }) => {
  // Given
  await registerProfileApi(page)

  // When
  await page.goto("/identity-verification")

  // Then
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByText("个人资料", { exact: true })).toBeVisible()
  await expect(page.getByLabel("身份证人像面", { exact: true })).toBeVisible()
})

test("keeps profile and identity controls inside a narrow viewport", async ({ page }) => {
  // Given
  await page.setViewportSize({ width: 390, height: 844 })
  await registerProfileApi(page, {
    ...initial,
    mode: "enforced",
    required: true,
    canAccessBusiness: false,
  })

  // When
  await page.goto("/profile")

  // Then
  await expect(page.getByRole("button", { name: "提交认证" })).toBeVisible()
  for (const card of await page.locator(".ant-card").all()) {
    const bounds = await card.boundingBox()
    expect(bounds).not.toBeNull()
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390)
  }
  await page.screenshot({ path: `${evidenceDirectory}/profile-mobile.png`, fullPage: true })
})

test("shows personal details and verification in dark theme", async ({ page }) => {
  // Given
  await page.addInitScript(() => {
    localStorage.setItem("tk-mg.ui-preferences", JSON.stringify({ navTheme: "realDark" }))
  })
  await registerProfileApi(page)

  // When
  await page.goto("/profile")

  // Then
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  await expect(page.getByRole("button", { name: "提交认证" })).toBeVisible()
  await page.screenshot({ path: `${evidenceDirectory}/profile-dark.png`, fullPage: true })
})
