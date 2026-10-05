import { afterEach, describe, expect, it } from "bun:test"
import { z } from "zod"

import { createApp } from "../../app"
import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { Role } from "../../lib/authorization"
import { createPostgresAuditRepository } from "../audit/service"
import { createPostgresAuthRepository } from "../auth/postgres-repository"
import { createAuthService } from "../auth/service"
import { createPostgresMemberRepository } from "../members/repository"
import { createPostgresDeviceRepository } from "./postgres-repository"
import { createDeviceService } from "./service"

const databaseIntegrationTest = hasConfiguredTestDatabase ? it : it.skip
const administratorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const groupId = "11111111-1111-4111-8111-111111111111"
const secondGroupId = "22222222-2222-4222-8222-222222222222"

const DeviceSchema = z.object({
  groupId: z.string().uuid(),
  host: z.string(),
  id: z.string().uuid(),
  instances: z.array(z.object({ id: z.string().uuid(), index: z.number().int() })),
  status: z.enum(["unknown", "online", "offline"]),
})
const StatusSchema = z.object({
  monitoring: z.object({ state: z.literal("unconfigured") }),
  observation: z.object({ state: z.literal("unknown") }),
})

let activeDatabase: MigratedTestDatabase | null = null

afterEach(async () => {
  if (activeDatabase !== null) {
    await activeDatabase.close()
    activeDatabase = null
  }
})

describe("device PostgreSQL integration", () => {
  databaseIntegrationTest(
    "persists devices, scopes groups, records audits, and reports unconfigured status",
    async () => {
      activeDatabase = await createMigratedTestDatabase()
      const client = activeDatabase.client
      await client`
        insert into access_group (id, name)
        values (${groupId}, ${"研发组"}), (${secondGroupId}, ${"交付组"})
      `
      await client`
        insert into app_user (id, email, password_hash, role, enabled)
        values (
          ${administratorId},
          ${"admin@example.com"},
          ${await Bun.password.hash("correct-horse-battery-staple")},
          ${Role.Administrator},
          true
        )
      `
      const auditRepository = createPostgresAuditRepository(client)
      const memberRepository = createPostgresMemberRepository(client)
      const app = createApp({
        accessGroupRepository: memberRepository,
        auditRepository,
        authService: createAuthService(createPostgresAuthRepository(client)),
        deviceService: createDeviceService({
          auditRepository,
          repository: createPostgresDeviceRepository(client),
        }),
      })
      const login = await app.request("/api/auth/login", {
        body: JSON.stringify({
          email: "admin@example.com",
          password: "correct-horse-battery-staple",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      const cookie = login.headers.get("set-cookie") ?? ""

      const groups = await app.request("/api/access/groups", { headers: { Cookie: cookie } })
      const created = await app.request(`/api/groups/${groupId}/devices`, {
        body: JSON.stringify({
          bridge: false,
          host: "  EDGE-A.EXAMPLE.local  ",
          model: "Magic Cloud V3",
          name: "研发机柜 A",
          resourceCount: 1,
          version: null,
        }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "POST",
      })
      const device = DeviceSchema.parse(await created.json())
      const duplicateDevice = await app.request(`/api/groups/${groupId}/devices`, {
        body: JSON.stringify({
          bridge: false,
          host: "edge-a.example.LOCAL",
          model: "Magic Cloud V3",
          name: "重复机柜",
          resourceCount: 0,
          version: null,
        }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "POST",
      })
      const instance = await app.request(`/api/groups/${groupId}/devices/${device.id}/instances`, {
        body: JSON.stringify({ enabled: true, index: 1, label: "V3-01" }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "POST",
      })
      const duplicateInstance = await app.request(
        `/api/groups/${groupId}/devices/${device.id}/instances`,
        {
          body: JSON.stringify({ enabled: true, index: 1, label: "V3-duplicate" }),
          headers: { "Content-Type": "application/json", Cookie: cookie },
          method: "POST",
        },
      )
      const detail = await app.request(`/api/groups/${groupId}/devices/${device.id}`, {
        headers: { Cookie: cookie },
      })
      const status = await app.request(`/api/groups/${groupId}/devices/${device.id}/status`, {
        headers: { Cookie: cookie },
      })
      const audits = await client<
        { readonly action: string; readonly groupId: string; readonly target: string }[]
      >`
        select action, metadata->>'groupId' as "groupId", target
        from audit_event
        where actor_id = ${administratorId}
      `

      expect(groups.status).toBe(200)
      const groupItems = (await groups.json()) as { readonly items: readonly unknown[] }
      expect(groupItems.items).toHaveLength(2)
      expect(groupItems.items).toEqual(
        expect.arrayContaining([
          { id: groupId, name: "研发组" },
          { id: secondGroupId, name: "交付组" },
        ]),
      )
      expect(created.status).toBe(201)
      expect(device.host).toBe("edge-a.example.local")
      expect(duplicateDevice.status).toBe(409)
      expect(await duplicateDevice.json()).toEqual({ error: "device_host_conflict" })
      expect(instance.status).toBe(201)
      expect(duplicateInstance.status).toBe(409)
      expect(await duplicateInstance.json()).toEqual({
        error: "device_instance_index_conflict",
      })
      expect(DeviceSchema.parse(await detail.json()).instances).toHaveLength(1)
      expect(StatusSchema.parse(await status.json())).toEqual({
        monitoring: { state: "unconfigured" },
        observation: { state: "unknown" },
      })
      const auditRows = audits.map((audit) => ({
        action: audit.action,
        groupId: audit.groupId,
        target: audit.target,
      }))
      expect(auditRows).toHaveLength(2)
      expect(auditRows).toEqual(
        expect.arrayContaining([
          { action: "device.create", groupId, target: `device:${device.id}` },
          {
            action: "device.instance.create",
            groupId,
            target: expect.stringContaining(`device:${device.id}/instance:`),
          },
        ]),
      )
    },
  )
})
