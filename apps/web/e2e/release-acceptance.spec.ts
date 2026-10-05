import { expect, test } from "@playwright/test"

import { administrator, operator, routeApi } from "./release-acceptance.fixture"

test("isolates an operator to assigned groups and denies administrator routes", async ({
  page,
}) => {
  // Given
  await routeApi(page, operator, async (route) => {
    await route.fallback()
  })

  // When
  await page.goto("/registration-resources")
  await expect(page.getByText("xxx12143@gmail.com")).toBeVisible()
  await page.goto("/operations/configuration")

  // Then
  await expect(page.getByRole("heading", { level: 1, name: "运营概览" })).toBeVisible()
  await expect(page.getByRole("link", { name: "配置中心" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "工作日志" })).toHaveCount(0)
})

test("requires parse before confirming a smart import", async ({ page }) => {
  // Given
  await routeApi(page, operator, async (route) => {
    await route.fallback()
  })
  await page.goto("/registration-resources")
  await expect(page.getByText("xxx12143@gmail.com")).toBeVisible()

  // When
  await page.getByRole("button", { name: "智能导入" }).click()
  await page.getByLabel("原始数据").fill("new@gmail.com----password----help@outlook.com")
  await expect(page.getByRole("button", { name: "解析数据" })).toBeEnabled()
  await expect(page.getByRole("button", { name: "执行导入" })).toHaveCount(0)
  await page.getByRole("button", { name: "解析数据" }).click()
  await expect(page.getByText("检测到 1 行数据，每行 3 个字段")).toBeVisible()
  await page.getByRole("button", { name: "执行导入" }).click()
  await page.getByLabel("分组名称").fill("batch01")
  await page.getByRole("button", { name: "确认导入" }).click()

  // Then
  await expect(page.getByText("new@gmail.com")).toBeVisible()
  await expect(page.getByText("智能导入成功，共导入1条数据")).toBeVisible()
})

test("opens the 云大师 account pool without claiming a lease", async ({ page }) => {
  await routeApi(page, operator, async (route) => {
    await route.fallback()
  })
  await page.goto("/operations/account-pool")

  await expect(page.getByText("1107发布")).toBeVisible()
  await expect(page.getByRole("button", { name: "创建账号池" })).toBeVisible()
  await expect(page.getByRole("button", { name: "租用" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "归还" })).toHaveCount(0)
})

test("terminates running tasks locally without calling task APIs", async ({ page }) => {
  const requests: string[] = []
  await routeApi(page, operator, async (route, request, pathname) => {
    requests.push(`${request.method()} ${pathname}`)
    await route.fallback()
  })
  await page.goto("/operations/tasks")
  await expect(page.getByText("养号任务")).toBeVisible()

  await page
    .getByRole("row")
    .filter({ hasText: "5003" })
    .getByRole("button", { name: "终止" })
    .click()
  await page.getByRole("button", { name: "确定" }).click()

  await expect(page.getByText("已终止").first()).toBeVisible()
  expect(requests.some((item) => item.includes("/retry") || item.includes("/cancel"))).toBe(false)
})

test("shows private-cloud storage cards without posting NAS credentials", async ({ page }) => {
  const requests: string[] = []
  await routeApi(page, administrator, async (route, request, pathname) => {
    requests.push(`${request.method()} ${pathname}`)
    await route.fallback()
  })
  await page.goto("/engineering/storage")

  await expect(page.getByText("主 NAS")).toBeVisible()
  await expect(page.getByText("配置NAS")).toBeVisible()
  await expect(page.getByRole("button", { name: "全量备份" }).first()).toBeVisible()
  await expect(page.locator("body")).not.toContainText("nas-secret")
  await expect(page.getByText("私有云储存尚未配置")).toHaveCount(0)
  expect(requests.some((item) => item.includes("/storage/configuration"))).toBe(false)

  await page.goto("/engineering/robots")
  await expect(page.getByText("美区养号")).toBeVisible()
  await expect(page.getByRole("button", { name: "立即执行" }).first()).toBeVisible()

  await page.goto("/engineering/behaviors")
  await expect(page.getByText("早班养号")).toBeVisible()
  await expect(page.getByLabel("测试云机")).toBeVisible()

  await page.goto("/work-logs")
  await expect(page.getByRole("heading", { level: 1, name: "工作日志" })).toBeVisible()
})
