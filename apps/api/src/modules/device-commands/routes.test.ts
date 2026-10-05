import { describe, expect, it } from "bun:test"
import {
  DeviceIdSchema as AdapterDeviceIdSchema,
  createInMemoryDeviceAdapter,
} from "@tk-mg/device-adapter"
import { z } from "zod"

import { createApp } from "../../app"
import { GroupIdSchema, Permission, Role } from "../../lib/authorization"
import { PageKey } from "../../lib/pages"
import { createInMemoryAuditRepository } from "../audit/service"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import {
  createInMemoryDeviceRepository,
  DeviceIdSchema,
  DeviceInstanceIdSchema,
} from "../devices/repository"
import { createInMemoryDeviceCommandRepository } from "./in-memory-repository"
import { createDeviceCommandService } from "./service"

const groupId = "11111111-1111-4111-8111-111111111111"
const otherGroup = "22222222-2222-4222-8222-222222222222"
const deviceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const instanceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const base = `/api/groups/${groupId}/devices/${deviceId}/commands`
const CommandResponse = z.object({
  id: z.string().uuid(),
  status: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  result: z.unknown(),
})

const fixture = (permissions: readonly Permission[], dispatchImmediately = true) => {
  const auditRepository = createInMemoryAuditRepository()
  const repository = createInMemoryDeviceCommandRepository(auditRepository)
  const deviceRepository = createInMemoryDeviceRepository([
    {
      bridge: false,
      createdAt: new Date(),
      enabled: true,
      groupId: GroupIdSchema.parse(groupId),
      host: "localhost",
      id: DeviceIdSchema.parse(deviceId),
      instances: [
        {
          createdAt: new Date(),
          deviceId: DeviceIdSchema.parse(deviceId),
          enabled: true,
          id: DeviceInstanceIdSchema.parse(instanceId),
          index: 1,
          lastHealthAt: null,
          lastHealthFailure: null,
          lastPlaybackDiagnostic: null,
          label: "one",
          status: "unknown",
          updatedAt: new Date(),
        },
      ],
      lastHealthAt: null,
      lastHealthFailure: null,
      model: "test",
      name: "test",
      resourceCount: 1,
      status: "unknown",
      updatedAt: new Date(),
      version: null,
    },
  ])
  const adapter = createInMemoryDeviceAdapter({ autoComplete: true })
  const service = createDeviceCommandService({
    adapter,
    deviceRepository,
    repository,
    dispatchImmediately,
  })
  const authService = createAuthService(
    createInMemoryAuthRepository([
      {
        email: "operator@example.com",
        groupIds: [groupId],
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        password: "password",
        pages: [{ key: PageKey.Devices, canDelete: true, canView: true }],
        permissions,
        role: Role.Operator,
      },
    ]),
    async (password, hash) => password === hash,
  )
  const app = createApp({ authService, auditRepository, deviceCommandService: service })
  const login = async () => {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "operator@example.com", password: "password" }),
    })
    return response.headers.get("set-cookie") ?? ""
  }
  return { app, auditRepository, repository, adapter, login }
}

const submit = (app: ReturnType<typeof createApp>, cookie: string, body: object) =>
  app.request(base, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

describe("device command routes", () => {
  it("refuses a write without DevicesWrite and audits the denial", async () => {
    const { app, auditRepository, login } = fixture([Permission.DevicesRead])
    const cookie = await login()
    const response = await submit(app, cookie, { idempotencyKey: "k", type: "health_check" })
    expect(response.status).toBe(403)
    expect(auditRepository.all()).toContainEqual(
      expect.objectContaining({ action: "device.command.create", outcome: "denied" }),
    )
  })

  it("returns 404 for a hidden group and an instance outside the device", async () => {
    const { app, login } = fixture([Permission.DevicesRead, Permission.DevicesWrite])
    const cookie = await login()
    const hidden = await app.request(`/api/groups/${otherGroup}/devices/${deviceId}/commands`, {
      headers: { Cookie: cookie },
    })
    const instance = await submit(app, cookie, {
      idempotencyKey: "k",
      type: "health_check",
      instanceId: crypto.randomUUID(),
    })
    expect(hidden.status).toBe(404)
    expect(instance.status).toBe(404)
  })

  it("executes for an instance belonging to the requested device", async () => {
    const { app, login } = fixture([Permission.DevicesRead, Permission.DevicesWrite])
    const cookie = await login()
    const response = await submit(app, cookie, {
      idempotencyKey: "instance",
      type: "health_check",
      instanceId,
    })
    expect(response.status).toBe(201)
    expect(CommandResponse.parse(await response.json()).status).toBe("succeeded")
  })

  it("deduplicates identical submissions and rejects changed parameters", async () => {
    const { app, repository, login } = fixture([Permission.DevicesRead, Permission.DevicesWrite])
    const cookie = await login()
    const body = { idempotencyKey: "once", type: "tap", x: 1, y: 2 }
    const first = await submit(app, cookie, body)
    const duplicate = await submit(app, cookie, body)
    const conflict = await submit(app, cookie, { ...body, x: 3 })
    expect(first.status).toBe(201)
    expect(duplicate.status).toBe(200)
    expect(CommandResponse.parse(await first.json()).id).toBe(
      CommandResponse.parse(await duplicate.json()).id,
    )
    expect(conflict.status).toBe(409)
    expect(repository.events()).toHaveLength(3)
  })

  it("treats explicit default timeout as the same normalized command", async () => {
    const { app, login } = fixture([Permission.DevicesRead, Permission.DevicesWrite])
    const cookie = await login()
    const first = await submit(app, cookie, { idempotencyKey: "default", type: "health_check" })
    const duplicate = await submit(app, cookie, {
      idempotencyKey: "default",
      type: "health_check",
      timeoutMs: 5_000,
    })
    expect(duplicate.status).toBe(200)
    expect(CommandResponse.parse(await duplicate.json()).id).toBe(
      CommandResponse.parse(await first.json()).id,
    )
  })

  it("redacts text, returns no artifact for captures, and scopes read/list", async () => {
    const { app, repository, auditRepository, login } = fixture([
      Permission.DevicesRead,
      Permission.DevicesWrite,
    ])
    const cookie = await login()
    const text = await submit(app, cookie, {
      idempotencyKey: "secret",
      type: "input_text",
      text: "very private",
    })
    const capture = await submit(app, cookie, { idempotencyKey: "screen", type: "capture_screen" })
    const textCommand = CommandResponse.parse(await text.json())
    const captureCommand = CommandResponse.parse(await capture.json())
    const detail = await app.request(`${base}/${textCommand.id}`, { headers: { Cookie: cookie } })
    const listed = await app.request(`${base}?page=1&pageSize=1`, { headers: { Cookie: cookie } })
    expect(textCommand.parameters).toEqual({ textLength: 12 })
    expect(
      JSON.stringify({ textCommand, events: repository.events(), audits: auditRepository.all() }),
    ).not.toContain("very private")
    expect(captureCommand.result).toEqual({ kind: "no_artifact" })
    expect(detail.status).toBe(200)
    expect(z.object({ total: z.number() }).parse(await listed.json()).total).toBe(2)
  })

  it("cancels a queued command idempotently", async () => {
    const { app, repository, login } = fixture(
      [Permission.DevicesRead, Permission.DevicesWrite],
      false,
    )
    const cookie = await login()
    const created = await submit(app, cookie, { idempotencyKey: "cancel", type: "health_check" })
    const command = CommandResponse.parse(await created.json())
    const first = await app.request(`${base}/${command.id}/cancel`, {
      method: "POST",
      headers: { Cookie: cookie },
    })
    const second = await app.request(`${base}/${command.id}/cancel`, {
      method: "POST",
      headers: { Cookie: cookie },
    })
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(CommandResponse.parse(await second.json()).status).toBe("cancelled")
    expect(repository.events().filter((event) => event.status === "cancelled")).toHaveLength(1)
  })

  it("records adapter rejection as failed without exposing provider details", async () => {
    const { app, adapter, login } = fixture([Permission.DevicesRead, Permission.DevicesWrite])
    const cookie = await login()
    adapter.setAvailable(AdapterDeviceIdSchema.parse(deviceId), false)
    const response = await submit(app, cookie, { idempotencyKey: "offline", type: "health_check" })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(
      expect.objectContaining({ status: "failed", errorCode: "unavailable" }),
    )
  })
})
