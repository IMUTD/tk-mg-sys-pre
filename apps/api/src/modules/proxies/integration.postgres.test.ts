import { afterEach, describe, expect, it } from "bun:test"
import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { GroupIdSchema, UserIdSchema } from "../../lib/authorization"
import { createSecretCipher } from "../../lib/crypto"
import { ProxyConfigurationSchema } from "./configuration"
import { createPostgresProxyRepository, ProxyIdSchema } from "./repository"
import { createProxyService } from "./service"

const dbTest = hasConfiguredTestDatabase ? it : it.skip
const groupId = "11111111-1111-4111-8111-111111111111"
const otherGroup = "22222222-2222-4222-8222-222222222222"
const actor = UserIdSchema.parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
let database: MigratedTestDatabase | null = null
afterEach(async () => {
  await database?.close()
  database = null
})
const setup = async () => {
  database = await createMigratedTestDatabase()
  const client = database.client
  await client`insert into access_group (id, name) values (${groupId}, 'first'), (${otherGroup}, 'other')`
  const repository = createPostgresProxyRepository(client)
  const cipher = createSecretCipher("12345678901234567890123456789012")
  const service = createProxyService({
    repository,
    cipher,
    dialTransport: {
      query: async () => ({
        connectivity: {
          ok: true,
          delay: 12,
          status: 204,
          url: "https://www.gstatic.com/generate_204",
        },
        informationDelay: 23,
        information: {
          ip: "1.1.1.1",
          country: "AU",
          city: "Sydney",
          isp: "Cloudflare",
          asn: "AS13335",
        },
      }),
    },
  })
  const create = (configuration = {}, scope = groupId) =>
    service.create(actor, scope, {
      name: "proxy",
      endpoint: "8.8.8.8:8080",
      credentials: JSON.stringify({ username: "u", password: "password-private" }),
      note: "persisted",
      tags: ["integration"],
      status: "ready",
      configuration: ProxyConfigurationSchema.parse({
        host: "8.8.8.8",
        port: 8080,
        ...configuration,
      }),
    })
  return { client, repository, service, create }
}

describe("persistent proxy graph and probes", () => {
  dbTest(
    "persists configuration, credentials, stable display IDs and actual result metadata",
    async () => {
      const { service, create, client } = await setup()
      const proxy = await create({ protocol: "http", turbo: true, tun: true, safe: true })
      expect(proxy.configuration).toMatchObject({
        protocol: "http",
        turbo: true,
        tun: true,
        safe: true,
      })
      expect(proxy.displayId).toBeGreaterThan(0)
      expect(JSON.stringify(proxy)).not.toContain("password-private")
      expect(await service.credentials?.(actor, groupId, proxy.id)).toMatchObject({
        password: "password-private",
      })
      const result = await service.detect?.(actor, groupId, proxy.id, {
        channel: "us",
        mode: "detailed",
        useTurbo: false,
      })
      expect(result).toMatchObject({
        ok: true,
        detection_type: "proxy_connectivity",
        connectivity_checked: true,
        message: "proxy_online",
        target_ip: "1.1.1.1",
        results: [
          { response_body: { ip: "1.1.1.1", city: "Sydney", asn: "AS13335" } },
          { ok: true, url: "https://www.gstatic.com/generate_204" },
        ],
      })
      const page = await service.list({ groupId, page: 1, pageSize: 100 })
      expect(page.items[0]?.displayId).toBe(proxy.displayId)
      expect(page.items[0]?.checkResult).toEqual(result)
      expect(page.items[0]?.tags).toEqual(["integration"])
      expect(page.items.find((item) => item.id === proxy.id)?.note).toBe("persisted")
      const stored = await client`select encrypted_credentials from operation_proxy`
      expect(JSON.stringify(stored)).not.toContain("password-private")
      expect(await service.credentials?.(actor, otherGroup, proxy.id)).toBeNull()
      const ungrouped = await service.create(actor, groupId, {
        name: "ungrouped",
        endpoint: "1.1.1.1:8080",
        credentials: JSON.stringify({ username: "u", password: "password-private" }),
        note: "",
        tags: [],
        status: "ready",
        configuration: ProxyConfigurationSchema.parse({ host: "1.1.1.1", port: 8080 }),
      })
      await service.detect?.(actor, groupId, ungrouped.id, {
        channel: "us",
        mode: "detailed",
        useTurbo: false,
      })
      const grouped = await service.list({ groupId, page: 1, pageSize: 100 })
      const detected = grouped.items.find((item) => item.id === ungrouped.id)
      expect(detected?.tags).toEqual([])
      expect(detected?.note).toBe("")
      expect(
        await service.detect?.(actor, otherGroup, proxy.id, {
          channel: "us",
          mode: "quick",
          useTurbo: false,
        }),
      ).toBeNull()
    },
  )
  dbTest(
    "rejects cycles, self references, foreign ownership and disabling/deleting an in-use accelerator",
    async () => {
      const { service, create } = await setup()
      const accelerator = await create({ turbo: true })
      const landing = await create({ acceleratorId: accelerator.id })
      const hidden = await create({ turbo: true }, otherGroup)
      await expect(
        service.update(actor, groupId, accelerator.id, {
          configuration: {
            ...ProxyConfigurationSchema.parse(accelerator.configuration),
            acceleratorId: landing.id,
          },
        }),
      ).rejects.toThrow()
      await expect(
        service.update(actor, groupId, landing.id, {
          configuration: {
            ...ProxyConfigurationSchema.parse(landing.configuration),
            acceleratorId: landing.id,
          },
        }),
      ).rejects.toThrow("invalid_accelerator")
      await expect(
        service.update(actor, groupId, landing.id, {
          configuration: {
            ...ProxyConfigurationSchema.parse(landing.configuration),
            acceleratorId: hidden.id,
          },
        }),
      ).rejects.toThrow("invalid_accelerator")
      await expect(
        service.update(actor, groupId, accelerator.id, { status: "disabled" }),
      ).rejects.toThrow("invalid_accelerator")
      await expect(service.delete(actor, groupId, [accelerator.id])).rejects.toThrow(
        "accelerator_in_use",
      )
      const listed = await service.list({ groupId, page: 1, pageSize: 100 })
      expect(
        listed.items.find((item) => item.id === landing.id)?.configuration?.acceleratorId,
      ).toBe(accelerator.id)
      await service.update(actor, groupId, landing.id, {
        configuration: {
          ...ProxyConfigurationSchema.parse(landing.configuration),
          acceleratorId: null,
        },
      })
      expect(await service.delete(actor, groupId, [accelerator.id])).toBe(1)
    },
  )
  dbTest("claims one concurrent probe and discards a changed upstream snapshot", async () => {
    const { repository, service, create, client } = await setup()
    const accelerator = await create({ turbo: true })
    const landing = await create({ acceleratorId: accelerator.id })
    const scope = GroupIdSchema.parse(groupId)
    const attempts = await Promise.allSettled([
      repository.startProbe?.(scope, landing.id, true),
      repository.startProbe?.(scope, landing.id, true),
    ])
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1)
    const snapshot = attempts.find((item) => item.status === "fulfilled")
    if (snapshot?.status !== "fulfilled" || snapshot.value == null)
      throw new Error("missing snapshot")
    await service.update(actor, groupId, accelerator.id, { credentials: "changed:password" })
    expect(
      await repository.finishProbe?.(scope, snapshot.value, {
        ok: true,
        message: "success",
        check_time: Date.now(),
        channel: "us",
        mode: "quick",
        use_turbo: true,
        include_response: false,
        successes: 1,
        failures: 0,
        status: 200,
        results: [],
      }),
    ).toBe(false)
    const rows =
      await client`select probe_token, check_result from operation_proxy where id = ${landing.id}`
    expect(rows[0]).toMatchObject({ probe_token: null, check_result: null })
    await client`update operation_proxy set probe_started_at = now() - interval '61 seconds', probe_token = gen_random_uuid() where id = ${landing.id}`
    expect(await repository.startProbe?.(scope, landing.id, true)).not.toBeNull()
  })
  dbTest("rejects stale edits and merges concurrent independent legacy patches", async () => {
    const { service, create } = await setup()
    const proxy = await create()
    await Promise.all([
      service.update(actor, groupId, proxy.id, { note: "new-note" }),
      service.update(actor, groupId, proxy.id, { tags: ["new-tag"] }),
    ])
    expect((await service.list({ groupId, page: 1, pageSize: 100 })).items[0]).toMatchObject({
      note: "new-note",
      tags: ["new-tag"],
    })
    await service.update(actor, groupId, proxy.id, { credentials: "new:secret" })
    await expect(
      service.update(actor, groupId, proxy.id, {
        expectedRevision: proxy.revision,
        note: "stale",
      }),
    ).rejects.toThrow("proxy_configuration_changed")
    expect(ProxyIdSchema.parse(proxy.id)).toBe(proxy.id)
  })
  dbTest(
    "preserves detected IP for favorites and unchanged credentials, not connection edits",
    async () => {
      const { service, create, client } = await setup()
      const proxy = await create({ protocol: "http" })
      const result = await service.detect?.(actor, groupId, proxy.id, {
        channel: "us",
        mode: "detailed",
        useTurbo: false,
      })
      const favorite = await service.update(actor, groupId, proxy.id, {
        endpoint: proxy.endpoint,
        status: proxy.status,
        configuration: { ...ProxyConfigurationSchema.parse(proxy.configuration), favorite: true },
      })
      expect(favorite?.checkResult).toEqual(result)
      expect(favorite?.revision).toBe((proxy.revision ?? 0) + 1)
      const before = await client<
        { encrypted_credentials: string }[]
      >`select encrypted_credentials from operation_proxy where id = ${proxy.id}`
      const unchanged = await service.update(actor, groupId, proxy.id, {
        endpoint: proxy.endpoint,
        configuration: favorite?.configuration,
        credentials: JSON.stringify({ username: "u", password: "password-private" }),
        note: "updated note",
        tags: ["updated tag"],
      })
      expect(unchanged?.checkResult).toEqual(result)
      expect(unchanged?.revision).toBe(favorite?.revision)
      const after = await client<
        { encrypted_credentials: string }[]
      >`select encrypted_credentials from operation_proxy where id = ${proxy.id}`
      expect(after[0]?.encrypted_credentials).toBe(before[0]?.encrypted_credentials)
      expect(
        (await service.update(actor, groupId, proxy.id, { credentials: "u:new-password" }))
          ?.checkResult,
      ).toBeNull()
      expect(
        await service.update(actor, groupId, crypto.randomUUID(), { credentials: "u:secret" }),
      ).toBeNull()
    },
  )
  dbTest(
    "encrypts private refresh URLs and preserves them during public metadata edits",
    async () => {
      const { service, create, client } = await setup()
      const refreshUrl = "https://refresh.example.test/?token=private-refresh-token"
      const proxy = await create({ refreshUrl })
      expect(JSON.stringify(proxy)).not.toContain("private-refresh-token")
      expect(await service.credentials?.(actor, groupId, proxy.id)).toMatchObject({ refreshUrl })
      expect(
        JSON.stringify(
          await client`select configuration, encrypted_credentials from operation_proxy`,
        ),
      ).not.toContain("private-refresh-token")
      await service.update(actor, groupId, proxy.id, {
        configuration: { ...ProxyConfigurationSchema.parse(proxy.configuration), favorite: true },
      })
      await service.update(actor, groupId, proxy.id, { credentials: "u:new-password" })
      expect(await service.credentials?.(actor, groupId, proxy.id)).toMatchObject({ refreshUrl })
      await service.update(actor, groupId, proxy.id, {
        credentials: JSON.stringify({ username: "u", password: "new-password", refreshUrl: "" }),
      })
      expect(await service.credentials?.(actor, groupId, proxy.id)).toMatchObject({
        refreshUrl: "",
      })
      // A provisional older configuration is redacted on read and encrypted on its next edit.
      await client`update operation_proxy set configuration = jsonb_set(configuration,
      '{refreshUrl}', to_jsonb(${refreshUrl}::text)) where id = ${proxy.id}`
      const page = await service.list({ groupId, page: 1, pageSize: 100 })
      expect(JSON.stringify(page)).not.toContain("private-refresh-token")
      await service.update(actor, groupId, proxy.id, { note: "migrate private URL" })
      expect(await service.credentials?.(actor, groupId, proxy.id)).toMatchObject({ refreshUrl })
      expect(
        JSON.stringify(
          await client`select configuration, encrypted_credentials from operation_proxy`,
        ),
      ).not.toContain("private-refresh-token")
    },
  )
})
