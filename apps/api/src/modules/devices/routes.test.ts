import { describe, expect, it } from "bun:test"

import { createApp } from "../../app"
import { GroupIdSchema, Permission, Role } from "../../lib/authorization"
import { PageKey } from "../../lib/pages"
import { createInMemoryAuditRepository } from "../audit/service"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import {
  createInMemoryDeviceRepository,
  DeviceIdSchema,
  DeviceInstanceIdSchema,
} from "./repository"
import { createDeviceService } from "./service"

const groupId = "11111111-1111-4111-8111-111111111111"
const hiddenGroupId = "22222222-2222-4222-8222-222222222222"
const deviceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const instanceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const secondInstanceId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const typedGroupId = GroupIdSchema.parse(groupId)
const typedDeviceId = DeviceIdSchema.parse(deviceId)
const typedInstanceId = DeviceInstanceIdSchema.parse(instanceId)
const typedSecondInstanceId = DeviceInstanceIdSchema.parse(secondInstanceId)

const createAuthenticatedApp = (permissions: readonly Permission[]) => {
  const auditRepository = createInMemoryAuditRepository()
  const authService = createAuthService(
    createInMemoryAuthRepository([
      {
        email: "operator@example.com",
        groupIds: [groupId],
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        password: "correct-horse-battery-staple",
        pages: [{ canDelete: true, canView: true, key: PageKey.Devices }],
        permissions,
        role: Role.Operator,
      },
    ]),
    async (password, passwordHash) => password === passwordHash,
  )
  const repository = createInMemoryDeviceRepository([
    {
      bridge: false,
      createdAt: new Date("2026-09-12T00:00:00.000Z"),
      enabled: true,
      groupId: typedGroupId,
      host: "192.168.1.2",
      id: typedDeviceId,
      instances: [
        {
          createdAt: new Date("2026-09-12T00:00:00.000Z"),
          deviceId: typedDeviceId,
          enabled: true,
          id: typedInstanceId,
          index: 2,
          lastHealthAt: null,
          lastHealthFailure: null,
          lastPlaybackDiagnostic: null,
          label: "V3-02",
          status: "unknown",
          updatedAt: new Date("2026-09-12T00:00:00.000Z"),
        },
        {
          createdAt: new Date("2026-09-12T00:00:00.000Z"),
          deviceId: typedDeviceId,
          enabled: true,
          id: typedSecondInstanceId,
          index: 3,
          lastHealthAt: null,
          lastHealthFailure: null,
          lastPlaybackDiagnostic: null,
          label: "V3-03",
          status: "unknown",
          updatedAt: new Date("2026-09-12T00:00:00.000Z"),
        },
      ],
      lastHealthAt: null,
      lastHealthFailure: null,
      model: "Magic Cloud V3",
      name: "研发机柜 A",
      resourceCount: 2,
      status: "unknown",
      updatedAt: new Date("2026-09-12T00:00:00.000Z"),
      version: "3.0.1",
    },
  ])
  return {
    app: createApp({
      auditRepository,
      authService,
      deviceService: createDeviceService({ auditRepository, repository }),
    }),
    auditRepository,
  }
}

const login = async (app: ReturnType<typeof createApp>): Promise<string> => {
  const response = await app.request("/api/auth/login", {
    body: JSON.stringify({
      email: "operator@example.com",
      password: "correct-horse-battery-staple",
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })
  return response.headers.get("set-cookie") ?? ""
}

describe("device routes", () => {
  it("lists only the inventory visible in an operator group", async () => {
    // Given
    const { app } = createAuthenticatedApp([Permission.DevicesRead])
    const cookie = await login(app)

    // When
    const visible = await app.request(`/api/groups/${groupId}/devices`, {
      headers: { Cookie: cookie },
    })
    const hidden = await app.request(`/api/groups/${hiddenGroupId}/devices`, {
      headers: { Cookie: cookie },
    })

    // Then
    expect(visible.status).toBe(200)
    expect(await visible.json()).toEqual(
      expect.objectContaining({ items: [expect.objectContaining({ id: deviceId })] }),
    )
    expect(hidden.status).toBe(404)
  })

  it("denies device creation for a read-only operator", async () => {
    // Given
    const { app, auditRepository } = createAuthenticatedApp([Permission.DevicesRead])
    const cookie = await login(app)

    // When
    const response = await app.request(`/api/groups/${groupId}/devices`, {
      body: JSON.stringify({
        bridge: false,
        host: "192.168.1.3",
        model: "Magic Cloud V3",
        name: "研发机柜 B",
      }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST",
    })

    // Then
    expect(response.status).toBe(403)
    expect(auditRepository.all()).toContainEqual(
      expect.objectContaining({ action: "device.create", outcome: "denied" }),
    )
  })

  it("updates device IP and instance enablement for a device operator", async () => {
    // Given
    const { app } = createAuthenticatedApp([Permission.DevicesRead, Permission.DevicesWrite])
    const cookie = await login(app)

    // When
    const detail = await app.request(`/api/groups/${groupId}/devices/${deviceId}`, {
      headers: { Cookie: cookie },
    })
    const updatedDevice = await app.request(`/api/groups/${groupId}/devices/${deviceId}`, {
      body: JSON.stringify({ host: "192.168.1.9" }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "PATCH",
    })
    const updatedInstance = await app.request(
      `/api/groups/${groupId}/devices/${deviceId}/instances/${instanceId}`,
      {
        body: JSON.stringify({ enabled: false }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "PATCH",
      },
    )

    // Then
    expect(detail.status).toBe(200)
    expect(await updatedDevice.json()).toEqual(expect.objectContaining({ host: "192.168.1.9" }))
    expect(await updatedInstance.json()).toEqual(expect.objectContaining({ enabled: false }))
  })

  it("reports unconfigured status without claiming a live adapter", async () => {
    // Given
    const { app } = createAuthenticatedApp([Permission.DevicesRead])
    const cookie = await login(app)

    // When
    const response = await app.request(`/api/groups/${groupId}/devices/${deviceId}/status`, {
      headers: { Cookie: cookie },
    })

    // Then
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      instances: [
        {
          failure: null,
          id: instanceId,
          label: "V3-02",
          observedAt: null,
          state: "unknown",
        },
        {
          failure: null,
          id: secondInstanceId,
          label: "V3-03",
          observedAt: null,
          state: "unknown",
        },
      ],
      monitoring: { state: "unconfigured" },
      observation: { failure: null, observedAt: null, state: "unknown" },
    })
  })

  it("returns stable conflict codes for duplicate hosts and instance indexes", async () => {
    // Given
    const { app } = createAuthenticatedApp([Permission.DevicesRead, Permission.DevicesWrite])
    const cookie = await login(app)

    // When
    const duplicateHost = await app.request(`/api/groups/${groupId}/devices`, {
      body: JSON.stringify({
        bridge: false,
        host: " 192.168.1.2 ",
        model: "Magic Cloud V3",
        name: "重复机柜",
      }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST",
    })
    const duplicateIndex = await app.request(
      `/api/groups/${groupId}/devices/${deviceId}/instances`,
      {
        body: JSON.stringify({ enabled: true, index: 2, label: "V3-duplicate" }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "POST",
      },
    )

    // Then
    expect(duplicateHost.status).toBe(409)
    expect(await duplicateHost.json()).toEqual({ error: "device_host_conflict" })
    expect(duplicateIndex.status).toBe(409)
    expect(await duplicateIndex.json()).toEqual({ error: "device_instance_index_conflict" })
  })

  it("deletes a device instance when page delete is allowed", async () => {
    // Given
    const { app, auditRepository } = createAuthenticatedApp([
      Permission.DevicesRead,
      Permission.DevicesWrite,
    ])
    const cookie = await login(app)

    // When
    const deleted = await app.request(
      `/api/groups/${groupId}/devices/${deviceId}/instances/${instanceId}`,
      {
        headers: { Cookie: cookie },
        method: "DELETE",
      },
    )
    const detail = await app.request(`/api/groups/${groupId}/devices/${deviceId}`, {
      headers: { Cookie: cookie },
    })

    // Then
    expect(deleted.status).toBe(204)
    expect(await detail.json()).toEqual(
      expect.objectContaining({ instances: [expect.objectContaining({ id: secondInstanceId })] }),
    )
    expect(auditRepository.all()).toContainEqual(
      expect.objectContaining({
        action: "device.instance.delete",
        metadata: { groupId },
        outcome: "allowed",
      }),
    )
  })
})
