import { expect, test } from "@playwright/test"

import { deviceId, registerDeviceApi } from "./devices.fixture"

// API-mock UI smoke coverage; this does not exercise real device hardware.
test("renders persisted device inventory from the API", async ({ page }) => {
  const api = await registerDeviceApi(page)

  await page.goto("/operations/devices")

  await expect(page.getByText("te***ox")).toBeVisible()
  await expect(page.getByText("192.168.1.2")).toBeVisible()
  await expect(page.getByText("Magic Cloud V3")).toBeVisible()
  await expect(page.getByText("未知", { exact: true })).toBeVisible()
  await expect(page.locator(".breadcrumb")).toContainText("盒子管理")
  await expect(page.getByRole("button", { name: "删除盒子" })).toHaveCount(0)
  expect(api.unexpectedRequests).toEqual([])
})

test("opens device control with the reported slot status", async ({ page }) => {
  const api = await registerDeviceApi(page)

  await page.goto("/operations/devices")
  await page.getByRole("button", { name: "中控", exact: true }).click()

  await expect(page).toHaveURL(`/operations/devices/${deviceId}/control`)
  await expect(page.getByText("1 V3-01", { exact: true })).toBeVisible()
  await expect(page.getByText("offline", { exact: true })).toBeVisible()
  await expect(page.locator(".control-card")).toHaveCount(5)
  await expect(page.getByRole("button", { name: "返回盒子管理" })).toBeVisible()
  expect(api.unexpectedRequests).toEqual([])
})

test("submits start and stop commands for the selected device slot", async ({ page }) => {
  const api = await registerDeviceApi(page)

  await page.goto("/operations/devices")
  await page.getByRole("button", { name: "中控", exact: true }).click()
  const slot = page.locator(".control-card").filter({ hasText: "V3-01" })
  await slot.getByRole("button", { name: "启动", exact: true }).click()
  await expect
    .poll(() => api.taskRequests)
    .toEqual([
      {
        deviceId,
        indexNum: 1,
        steps: [{ input: { name: "V3-01" }, skill: "BoxStart" }],
      },
    ])

  await slot.getByRole("button", { name: "停止", exact: true }).click()
  await expect
    .poll(() => api.taskRequests)
    .toEqual([
      { deviceId, indexNum: 1, steps: [{ input: { name: "V3-01" }, skill: "BoxStart" }] },
      { deviceId, indexNum: 1, steps: [{ input: { name: "V3-01" }, skill: "BoxStop" }] },
    ])
  expect(api.idempotencyKeys.every((key) => /^[0-9a-f-]{36}$/.test(key))).toBe(true)
  expect(new Set(api.idempotencyKeys).size).toBe(2)
  expect(api.unexpectedRequests).toEqual([])
})

test("keeps the API-backed box page within a narrow mobile viewport", async ({ page }) => {
  const api = await registerDeviceApi(page)
  await page.setViewportSize({ height: 844, width: 320 })

  await page.goto("/operations/devices")
  await expect(page.getByText("192.168.1.2")).toBeVisible()

  const scrollWidth = await page.locator("html").evaluate((element) => element.scrollWidth)
  expect(scrollWidth).toBeLessThanOrEqual(320)
  expect(api.unexpectedRequests).toEqual([])
})
