import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { z } from "zod"

// API-mock UI smoke coverage; this does not exercise the real device stack.
const groupId = "11111111-1111-4111-8111-111111111111"
const deviceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const instanceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const CommandRequestSchema = z.object({ type: z.string() })

const sessionUser = {
  email: "admin@example.com",
  scope: {
    groupIds: [groupId],
    pages: [{ canDelete: true, canView: true, key: "/operations/devices" }],
    permissions: ["devices:read", "devices:write"],
    role: "administrator",
  },
  userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
}

const device = {
  bridge: false,
  createdAt: "2026-09-12T00:00:00.000Z",
  enabled: true,
  groupId,
  host: "192.168.1.2",
  id: deviceId,
  instances: [
    {
      createdAt: "2026-09-12T00:00:00.000Z",
      deviceId,
      enabled: true,
      id: instanceId,
      index: 1,
      label: "V3-01",
      lastHealthAt: null,
      lastHealthFailure: null,
      lastPlaybackDiagnostic: null,
      status: "unknown",
      updatedAt: "2026-09-12T00:00:00.000Z",
    },
  ],
  lastHealthAt: null,
  lastHealthFailure: null,
  model: "Magic Cloud V3",
  name: "研发机柜 A",
  resourceCount: 1,
  status: "unknown",
  updatedAt: "2026-09-12T00:00:00.000Z",
  version: null,
}

const commandRecord = (id: string, kind: string, status: string, result: unknown = null) => ({
  createdAt: "2026-09-12T00:00:00.000Z",
  deviceId,
  errorCode: null,
  fingerprint: "fingerprint",
  finishedAt: status === "succeeded" || status === "cancelled" ? "2026-09-12T00:00:01.000Z" : null,
  groupId,
  id,
  idempotencyKey: `key-${id}`,
  instanceId: kind === "capture_screen" ? instanceId : null,
  kind,
  parameters: {},
  providerReceipt: status === "running" ? { status: "queued" } : null,
  requesterId: sessionUser.userId,
  result,
  resultReference: null,
  startedAt: status === "running" ? "2026-09-12T00:00:00.500Z" : null,
  status,
  timeoutMs: 5_000,
})

const registerDeviceApi = async (page: Page): Promise<void> => {
  let captureStatus = "running"
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === "/api/auth/session") {
      await route.fulfill({
        body: JSON.stringify({ user: sessionUser }),
        contentType: "application/json",
      })
      return
    }
    if (pathname === "/api/access/groups") {
      await route.fulfill({
        body: JSON.stringify({ items: [{ id: groupId, name: "研发组" }] }),
        contentType: "application/json",
      })
      return
    }
    if (pathname === `/api/groups/${groupId}/devices`) {
      await route.fulfill({
        body: JSON.stringify({ items: [device] }),
        contentType: "application/json",
      })
      return
    }
    if (pathname === `/api/groups/${groupId}/devices/${deviceId}`) {
      await route.fulfill({ body: JSON.stringify(device), contentType: "application/json" })
      return
    }
    if (pathname === `/api/groups/${groupId}/devices/${deviceId}/status`) {
      await route.fulfill({
        body: JSON.stringify({
          instances: [
            { failure: null, id: instanceId, label: "V3-01", observedAt: null, state: "unknown" },
          ],
          monitoring: { state: "unconfigured" },
          observation: { failure: null, observedAt: null, state: "unknown" },
        }),
        contentType: "application/json",
      })
      return
    }
    if (pathname === `/api/groups/${groupId}/devices/${deviceId}/commands`) {
      if (request.method() === "POST") {
        const body = CommandRequestSchema.parse(request.postDataJSON())
        const commandId =
          body.type === "health_check"
            ? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
            : "ffffffff-ffff-4fff-8fff-ffffffffffff"
        await route.fulfill({
          body: JSON.stringify(
            commandRecord(
              commandId,
              body.type,
              body.type === "health_check" ? "succeeded" : captureStatus,
              body.type === "health_check" ? { kind: "acknowledged" } : null,
            ),
          ),
          contentType: "application/json",
        })
        return
      }
      await route.fulfill({
        body: JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 }),
        contentType: "application/json",
      })
      return
    }
    if (pathname.endsWith("/commands/ffffffff-ffff-4fff-8fff-ffffffffffff/cancel")) {
      captureStatus = "cancelled"
      await route.fulfill({
        body: JSON.stringify(
          commandRecord("ffffffff-ffff-4fff-8fff-ffffffffffff", "capture_screen", captureStatus),
        ),
        contentType: "application/json",
      })
      return
    }
    if (pathname.endsWith("/commands/ffffffff-ffff-4fff-8fff-ffffffffffff")) {
      await route.fulfill({
        body: JSON.stringify(
          commandRecord("ffffffff-ffff-4fff-8fff-ffffffffffff", "capture_screen", captureStatus),
        ),
        contentType: "application/json",
      })
      return
    }
    await route.fallback()
  })
}

test("renders persisted device inventory from the API", async ({ page }) => {
  await registerDeviceApi(page)

  await page.goto("/operations/devices")

  await expect(page.getByText("研发机柜 A")).toBeVisible()
  await expect(page.getByText("192.168.1.2")).toBeVisible()
  await expect(page.getByText("Magic Cloud V3")).toBeVisible()
  await expect(page.getByText("未配置 / unknown")).toBeVisible()
  await expect(page.locator(".breadcrumb")).toContainText("盒子管理")
})

test("opens device detail with unconfigured status", async ({ page }) => {
  await registerDeviceApi(page)

  await page.goto("/operations/devices")
  await page.getByRole("button", { name: /详情/ }).click()

  await expect(page.getByRole("heading", { name: "研发机柜 A" })).toBeVisible()
  await expect(page.getByText("unconfigured", { exact: true })).toBeVisible()
  await expect(page.locator('input[value="V3-01"]')).toBeVisible()
})

test("submits health check and cancels a running capture command", async ({ page }) => {
  await registerDeviceApi(page)

  await page.goto("/operations/devices")
  await page.getByRole("button", { name: /详情/ }).click()
  await page.getByRole("button", { name: "健康检查" }).click()

  await expect(page.getByText("命令已完成")).toBeVisible()
  await expect(page.getByText("unconfigured", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "截取屏幕" }).click()
  await expect(page.getByText("running", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "取消命令" }).click()
  await expect(page.getByText("cancelled", { exact: true })).toBeVisible()
})

test("keeps the API-backed box page within a narrow mobile viewport", async ({ page }) => {
  await registerDeviceApi(page)
  await page.setViewportSize({ height: 844, width: 320 })

  await page.goto("/operations/devices")
  await expect(page.getByText("研发机柜 A")).toBeVisible()

  const scrollWidth = await page.locator("html").evaluate((element) => element.scrollWidth)
  expect(scrollWidth).toBeLessThanOrEqual(320)
})
