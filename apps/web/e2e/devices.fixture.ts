import type { Page } from "@playwright/test"
import { z } from "zod"

export const deviceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const groupId = "11111111-1111-4111-8111-111111111111"
const TaskRequestSchema = z.object({
  deviceId: z.string().uuid(),
  indexNum: z.number().int(),
  steps: z.array(z.object({ input: z.object({ name: z.string() }), skill: z.string() })),
})

export const registerDeviceApi = async (page: Page) => {
  const taskRequests: z.infer<typeof TaskRequestSchema>[] = []
  const idempotencyKeys: string[] = []
  const unexpectedRequests: string[] = []
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === "/api/auth/session") {
      await route.fulfill({
        json: {
          user: {
            email: "admin@example.com",
            scope: {
              groupIds: [groupId],
              pages: [{ canDelete: true, canView: true, key: "/operations/devices" }],
              permissions: ["devices:read", "devices:write"],
              role: "administrator",
            },
            userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          },
        },
      })
      return
    }
    if (pathname === "/api/devices") {
      await route.fulfill({
        json: [
          {
            boxGroupId: null,
            boxGroupName: null,
            enabled: true,
            externalId: "test-box",
            groupId,
            host: "192.168.1.2",
            id: deviceId,
            lastSeenAt: null,
            model: "Magic Cloud V3",
            name: "研发机柜 A",
            remarks: [],
            status: "unknown",
            updatedAt: "2026-09-12T00:00:00.000Z",
          },
        ],
      })
      return
    }
    if (pathname === "/api/box-labels") {
      await route.fulfill({ json: { administratorId: null, groups: [], remarks: [] } })
      return
    }
    if (pathname === `/api/devices/${deviceId}/slots`) {
      await route.fulfill({
        json: [
          {
            apiPort: 30002,
            busy: false,
            height: "1280",
            host: "192.168.1.2",
            index: 1,
            label: "V3-01",
            rpaPort: 30004,
            status: "offline",
            width: "720",
          },
        ],
      })
      return
    }
    if (pathname === `/api/devices/${deviceId}/watch` || pathname === "/api/frames") {
      await route.fulfill({ status: 204 })
      return
    }
    if (pathname === "/api/tasks" && request.method() === "POST") {
      taskRequests.push(TaskRequestSchema.parse(request.postDataJSON()))
      idempotencyKeys.push(request.headers()["idempotency-key"] ?? "")
      await route.fulfill({ json: { taskId: crypto.randomUUID() }, status: 202 })
      return
    }
    unexpectedRequests.push(`${request.method()} ${pathname}`)
    await route.fulfill({ json: { error: "unexpected_mock_request" }, status: 500 })
  })
  return { idempotencyKeys, taskRequests, unexpectedRequests }
}
