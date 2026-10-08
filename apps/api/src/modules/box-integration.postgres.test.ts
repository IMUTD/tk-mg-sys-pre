import { afterEach, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createPostgresWorkerRepository } from "@tk-mg/task-execution"
import { z } from "zod"

import { createApp } from "../app"
import {
  createMigratedTestDatabase,
  getTestDatabaseUrl,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../db/test-database"
import { startInitializerSync } from "../init-sync"
import { createSecretCipher } from "../lib/crypto"
import { createPostgresAccountRepository } from "./accounts/repository"
import { createAccountService } from "./accounts/service"
import { createPostgresAuditRepository } from "./audit/service"
import { createPostgresAuthRepository } from "./auth/postgres-repository"
import { createAuthService } from "./auth/service"
import { recoverBoxTasks, registerBoxLink } from "./box-link"
import { applyInitializerSnapshot, InitializerConflictError } from "./initializer-sync/repository"
import type { InitializerSnapshot } from "./initializer-sync/source"
import { createPostgresMemberRepository } from "./members/repository"
import { createPostgresExecutionTaskRepository } from "./task-execution/postgres-repository"

const pgTest = hasConfiguredTestDatabase ? it : it.skip
const secret = "integration-only-password"
const token = "integration-only-agent-token"
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const Pointer = z.object({
  task_id: z.string().uuid(),
  checkpoint: z.object({ step_id: z.string().uuid() }),
  phase: z.string(),
  role: z.string(),
  bindings: z.object({ indexNum: z.number() }),
  templateDoc: z.object({ steps: z.array(z.object({ afterMs: z.number().optional() })) }),
})
let database: MigratedTestDatabase | undefined
let boxRuntime: ReturnType<typeof registerBoxLink> | undefined

afterEach(async () => {
  await boxRuntime?.close()
  boxRuntime = undefined
  await database?.close()
  database = undefined
})

const setup = async (beforeScopeMigration = false) => {
  database = await createMigratedTestDatabase()
  const sql = database.client
  if (beforeScopeMigration) {
    const directory = new URL("../db/migrations/", import.meta.url)
    const journal = z
      .object({ entries: z.array(z.object({ idx: z.number(), tag: z.string() })) })
      .parse(JSON.parse(await readFile(new URL("meta/_journal.json", directory), "utf8")))
    // The guarded test helper owns the disposable database and its advisory lock.
    await sql.begin(async (tx) => {
      await tx`drop schema public cascade`
      await tx`create schema public`
      for (const entry of journal.entries.filter((entry) => entry.idx < 37)) {
        await tx.unsafe(await readFile(new URL(`${entry.tag}.sql`, directory), "utf8"))
      }
    })
  }
  const passwordHash = await Bun.password.hash(secret, { algorithm: "bcrypt", cost: 4 })
  const snapshot: InitializerSnapshot = {
    admins: ["first", "second"].map((id) => ({
      id,
      username: id,
      email: `${id}@example.test`,
      passwordHash,
      enabled: true,
    })),
    boxes: [
      {
        id: "box-one",
        ip: "192.0.2.10",
        type: "Q1",
        firmware: "test",
        memory: "",
        memoryPct: 0,
        disk: "",
        diskPct: 0,
        online: false,
        lastSeenAt: null,
        adminId: "first",
      },
    ],
  }
  await applyInitializerSnapshot(sql, "fixture", snapshot)
  const mappings = await sql<{ sourceId: string; userId: string; groupId: string }[]>`
    select source_id as "sourceId", user_id as "userId", group_id as "groupId"
    from init_admin_mapping order by source_id`
  const first = mappings.find((row) => row.sourceId === "first")
  const second = mappings.find((row) => row.sourceId === "second")
  const device = (
    await sql<{ id: string; groupId: string }[]>`
    select id, group_id as "groupId" from device where external_id = 'box-one'`
  )[0]
  if (first === undefined || second === undefined || device === undefined)
    throw new Error("Missing fixtures")
  await sql`insert into device_agent(device_id, token_hash) values (${device.id}, ${hash(token)})`
  const auditRepository = createPostgresAuditRepository(sql)
  const authService = createAuthService(createPostgresAuthRepository(sql))
  const accountService = createAccountService({
    auditRepository,
    cipher: createSecretCipher("12345678901234567890123456789012"),
    repository: createPostgresAccountRepository(sql),
  })
  const makeApp = () =>
    createApp({
      accessGroupRepository: createPostgresMemberRepository(sql),
      accountService,
      auditRepository,
      authService,
    })
  let app = makeApp()
  boxRuntime = registerBoxLink(app, sql, getTestDatabaseUrl(), authService, auditRepository)
  await boxRuntime.checkReadiness()
  const login = async (email: string, password = secret) => {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
    return { response, cookie: response.headers.get("set-cookie") ?? "" }
  }
  const cookie = (await login("first@example.test")).cookie
  const secondCookie = (await login("second@example.test")).cookie
  const post = (path: string, body: unknown, asAgent = false, key?: string) =>
    app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(asAgent ? { authorization: `Bearer ${token}` } : { cookie }),
        ...(key === undefined ? {} : { "idempotency-key": key }),
      },
      body: JSON.stringify(body),
    })
  const enqueue = (key: string, indexNum = 1, guards: string[] = []) =>
    post(
      "/api/tasks",
      {
        deviceId: device.id,
        indexNum,
        steps: [
          { skill: "DumpNodeXmlEx", input: {}, afterMs: 25, guards },
          { skill: "DumpNodeXmlEx", input: {} },
        ],
      },
      false,
      key,
    )
  const claim = () => post("/agent/tasks/claim?boxId=box-one&wait=0", {}, true)
  const status = (pointer: z.infer<typeof Pointer>, value = "succeeded") =>
    post(
      `/agent/tasks/${pointer.task_id}/status`,
      {
        status: value,
        checkpoint: { step_id: pointer.checkpoint.step_id, outputs: { result: "ok" } },
      },
      true,
    )
  return {
    sql,
    snapshot,
    first,
    second,
    device,
    app,
    cookie,
    secondCookie,
    login,
    post,
    enqueue,
    claim,
    status,
    restart: async () => {
      await boxRuntime?.close()
      app = makeApp()
      boxRuntime = registerBoxLink(app, sql, getTestDatabaseUrl(), authService, auditRepository)
      await boxRuntime.checkReadiness()
      return app
    },
  }
}

describe("initializer and box software integration", () => {
  pgTest(
    "isolates business catalogs while reusing device and account scopes across pages",
    async () => {
      const env = await setup()
      const created = await env.post("/api/box-groups", { name: "shared-group" })
      expect(created.status).toBe(201)
      const group = (await created.json()) as { id: string }
      const proxy = await env.post("/api/labels/catalog?page=/operations/proxies", {
        kind: "group",
        name: "shared-group",
      })
      expect(proxy.status).toBe(201)
      const proxyGroup = (await proxy.json()) as { id: string }
      const account = await env.post("/api/labels/catalog?page=/operations/accounts", {
        kind: "group",
        name: "shared-group",
      })
      expect(account.status).toBe(201)
      const accountGroup = (await account.json()) as { id: string }
      expect(new Set([group.id, proxyGroup.id, accountGroup.id]).size).toBe(3)
      const remark = await env.post("/api/labels/catalog?page=/operations/accounts", {
        kind: "remark",
        name: "shared-remark",
      })
      expect(remark.status).toBe(201)
      const catalog = await env.app.request("/api/labels/catalog?page=/operations/proxies", {
        headers: { cookie: env.cookie },
      })
      expect(await catalog.json()).toMatchObject({
        canDelete: true,
        scope: "proxy",
        groups: [
          expect.objectContaining({ id: proxyGroup.id, name: "shared-group", scope: "proxy" }),
        ],
        remarks: [],
      })
      for (const [page, id, scope] of [
        ["/operations/tasks", group.id, "device"],
        ["/operations/account-pool", accountGroup.id, "account"],
      ]) {
        const response = await env.app.request(`/api/labels/catalog?page=${page}`, {
          headers: { cookie: env.cookie },
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
          scope,
          groups: [expect.objectContaining({ id, scope })],
        })
      }
      expect(
        (
          await env.app.request(`/api/labels/catalog/${proxyGroup.id}?page=/operations/accounts`, {
            method: "DELETE",
            headers: { cookie: env.cookie },
          })
        ).status,
      ).toBe(404)
      expect(
        (
          await env.post("/api/devices/labels", {
            deviceIds: [env.device.id],
            boxGroupId: proxyGroup.id,
          })
        ).status,
      ).toBe(404)
      await expect(
        env.sql`update device set box_group_id = ${proxyGroup.id} where id = ${env.device.id}`.execute(),
      ).rejects.toMatchObject({ code: "23514" })
      expect(
        await (
          await env.app.request("/api/labels/catalog?page=/operations/accounts", {
            headers: { cookie: env.secondCookie },
          })
        ).json(),
      ).toMatchObject({ groups: [], remarks: [] })
      expect(
        (
          await env.app.request(`/api/labels/catalog/${group.id}?page=/operations/tasks`, {
            method: "DELETE",
            headers: { cookie: env.secondCookie },
          })
        ).status,
      ).toBe(404)
      expect(
        (
          await env.post("/api/devices/labels", {
            deviceIds: [env.device.id],
            boxGroupId: group.id,
          })
        ).status,
      ).toBe(200)
      expect(
        (
          await env.app.request(`/api/labels/catalog/${group.id}?page=/operations/tasks`, {
            method: "DELETE",
            headers: { cookie: env.cookie },
          })
        ).status,
      ).toBe(204)
      expect(
        (
          await env.sql<{ groupId: string | null }[]>`select box_group_id as "groupId"
      from device where id = ${env.device.id}`
        )[0]?.groupId,
      ).toBeNull()
      expect(
        await env.sql`select id from business_label where id = any(${[proxyGroup.id, accountGroup.id]}::uuid[])`,
      ).toHaveLength(2)
      const tables = await env.sql`select table_name, table_type from information_schema.tables
      where table_schema = 'public' and table_name in ('box_group', 'box_remark', 'business_label')`
      expect(tables).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ table_name: "box_group", table_type: "VIEW" }),
          expect.objectContaining({ table_name: "box_remark", table_type: "VIEW" }),
          expect.objectContaining({ table_name: "business_label", table_type: "BASE TABLE" }),
        ]),
      )
    },
  )

  pgTest(
    "collects persisted business tags idempotently and refuses deletion of used groups",
    async () => {
      const env = await setup()
      const createAccount = () =>
        env.post(`/api/groups/${env.first.groupId}/operations/accounts`, {
          identifier: "classified-account",
          name: "Classified",
          tags: ["shared-business"],
        })
      expect((await createAccount()).status).toBe(201)
      const label = (
        await env.sql<{ id: string }[]>`select id from business_label
      where administrator_id = ${env.first.userId} and name = 'shared-business' and kind = 'group'`
      )[0]
      expect(label).toBeDefined()
      const path = `/api/labels/catalog/${label?.id}?page=/operations/accounts`
      expect(
        (await env.app.request(path, { method: "DELETE", headers: { cookie: env.cookie } })).status,
      ).toBe(409)
      expect(
        (
          await env.app.request(`/api/box-groups/${label?.id}`, {
            method: "DELETE",
            headers: { cookie: env.cookie },
          })
        ).status,
      ).toBe(404)
      await env.sql`update operation_account set tags = array['shared-business', 'other'] where group_id = ${env.first.groupId}`
      const tags = await env.app.request(
        "/api/labels/catalog?page=/operations/account-pool&scope=account-tag",
        {
          headers: { cookie: env.cookie },
        },
      )
      expect(await tags.json()).toMatchObject({
        scope: "account-tag",
        groups: [expect.objectContaining({ name: "other" })],
      })
      expect(
        await env.sql`select id from business_label where name = 'shared-business'`,
      ).toHaveLength(1)
      await env.sql`update operation_account set tags = '{}' where group_id = ${env.first.groupId}`
      expect(
        (await env.app.request(path, { method: "DELETE", headers: { cookie: env.cookie } })).status,
      ).toBe(204)
    },
  )

  pgTest("validates category input and serializes concurrent catalog creation", async () => {
    const env = await setup()
    const path = "/api/labels/catalog?page=/operations/accounts"
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => env.post(path, { kind: "group", name: "concurrent" })),
    )
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409, 409, 409, 409])
    expect((await env.post(path, { kind: "unknown", name: "bad" })).status).toBe(400)
    expect((await env.post(path, { kind: "remark", name: " " })).status).toBe(400)
    expect((await env.post(`${path}&scope=legacy`, { kind: "group", name: "bad" })).status).toBe(
      400,
    )
    expect(
      (
        await env.post("/api/labels/catalog?page=/operations/tasks&scope=proxy", {
          kind: "group",
          name: "bad",
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await env.post("/api/labels/catalog?page=/studio/registration", {
          kind: "group",
          name: "bad+name",
        })
      ).status,
    ).toBe(400)
    expect((await env.app.request("/api/labels/catalog")).status).toBe(401)
    expect(
      (
        await env.app.request("/api/labels/catalog?page=/members", {
          headers: { cookie: env.cookie },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await env.app.request("/api/labels/catalog/not-a-uuid?page=/operations/accounts", {
          method: "DELETE",
          headers: { cookie: env.cookie },
        })
      ).status,
    ).toBe(400)
  })

  pgTest(
    "collects each business domain without notes and protects only its own used categories",
    async () => {
      const env = await setup()
      const name = "same-name"
      await env.sql`insert into operation_account(group_id,identifier,name,encrypted_secret,tags,note)
      values (${env.first.groupId}, 'scope-account', 'Account', '', array[${name},${name}], 'note-only')`
      await env.sql`insert into operation_proxy(group_id,name,endpoint,encrypted_credentials,tags,note)
      values (${env.first.groupId}, 'Proxy', '8.8.8.8:1080', '', array[${name}], 'note-only')`
      await env.sql`insert into operation_resource(group_id,name,category,tags,note)
      values (${env.first.groupId}, 'Resource', 'text', array[${name}], 'note-only')`
      await env.sql`insert into registration_resource(group_id,identifier,fingerprint,kind,encrypted_secret,tags,note)
      values (${env.first.groupId}, 'scope@example.test', 'scope-fingerprint', 'google-email', '', array[${name}], 'note-only')`
      const deviceLabel = await env.post("/api/box-groups", { name })
      expect(deviceLabel.status).toBe(201)
      const rows = await env.sql<{ id: string; scope: string }[]>`
      select id, scope from business_label where name = ${name} order by scope`
      expect(rows.map((row) => row.scope)).toEqual([
        "account",
        "account-tag",
        "device",
        "proxy",
        "registration",
        "resource",
      ])
      expect(new Set(rows.map((row) => row.id)).size).toBe(6)
      expect(await env.sql`select id from business_label where name = 'note-only'`).toHaveLength(0)
      const pages: Record<string, string> = {
        account: "/operations/accounts",
        "account-tag": "/operations/account-pool",
        device: "/operations/tasks",
        proxy: "/operations/proxies",
        resource: "/studio/text-pool",
        registration: "/studio/registration",
      }
      const remove = (row: { id: string; scope: string }, cookie = env.cookie) =>
        env.app.request(
          `/api/labels/catalog/${row.id}?page=${pages[row.scope]}&scope=${row.scope}`,
          {
            method: "DELETE",
            headers: { cookie },
          },
        )
      for (const row of rows) {
        expect((await remove(row, env.secondCookie)).status).toBe(404)
        expect((await remove(row)).status).toBe(row.scope === "device" ? 204 : 409)
      }
      await env.sql`update operation_account set tags = '{}'`
      for (const row of rows.filter(
        (row) => row.scope === "account" || row.scope === "account-tag",
      ))
        expect((await remove(row)).status).toBe(204)
      expect(await env.sql`select id from business_label where name = ${name}`).toHaveLength(3)
      await env.sql`update operation_proxy set tags = '{}'`
      await env.sql`update operation_resource set tags = '{}'`
      await env.sql`update registration_resource set tags = '{}'`
      for (const row of rows.filter((row) =>
        ["proxy", "resource", "registration"].includes(row.scope),
      ))
        expect((await remove(row)).status).toBe(204)
      expect(await env.sql`select id from business_label where name = ${name}`).toHaveLength(0)
    },
  )

  pgTest(
    "requires requesting and source page access and prevents catalog deletion by members",
    async () => {
      const env = await setup()
      const memberId = crypto.randomUUID()
      const passwordHash = await Bun.password.hash(secret, { algorithm: "bcrypt", cost: 4 })
      await env.sql`insert into app_user(id,email,password_hash,role,enabled)
      values (${memberId}, 'member@example.test', ${passwordHash}, 'operations_director', true)`
      await env.sql`insert into user_group(user_id,group_id) values (${memberId}, ${env.first.groupId})`
      const cookie = (await env.login("member@example.test")).cookie
      const created = await env.post("/api/box-groups", { name: "member-protected" })
      const group = (await created.json()) as { id: string }
      expect(
        (
          await env.app.request("/api/labels/catalog?page=/operations/accounts", {
            headers: { cookie },
          })
        ).status,
      ).toBe(200)
      expect(
        (
          await env.app.request(`/api/labels/catalog/${group.id}?page=/operations/accounts`, {
            method: "DELETE",
            headers: { cookie },
          })
        ).status,
      ).toBe(403)
      await env.sql`insert into user_page_permission(user_id,page_key,can_view,can_delete)
        values (${memberId}, '/operations/proxies', false, false)`
      expect(
        (
          await env.app.request("/api/labels/catalog?page=/operations/accounts&scope=proxy", {
            headers: { cookie },
          })
        ).status,
      ).toBe(403)
      expect(
        (
          await env.app.request(`/api/box-groups/${group.id}`, {
            method: "DELETE",
            headers: { cookie },
          })
        ).status,
      ).toBe(403)
      await env.sql`insert into user_page_permission(user_id,page_key,can_view,can_delete)
      values (${memberId}, '/operations/accounts', false, false)`
      expect(
        (
          await env.app.request("/api/labels/catalog?page=/operations/accounts", {
            headers: { cookie },
          })
        ).status,
      ).toBe(403)
    },
  )
  pgTest(
    "upgrades legacy catalogs without losing IDs, device references or record data",
    async () => {
      const env = await setup(true)
      const groupId = crypto.randomUUID()
      const orphanId = crypto.randomUUID()
      const source = crypto.randomUUID()
      await env.sql`insert into business_label(id, administrator_id, kind, name)
      values (${groupId}, ${env.first.userId}, 'group', 'overlapping'),
        (${orphanId}, ${env.first.userId}, 'remark', 'unknown-origin')`
      await env.sql`update device set box_group_id = ${groupId} where id = ${env.device.id}`
      await env.sql`insert into operation_account(group_id, identifier, name, encrypted_secret, tags, note)
      values (${env.first.groupId}, 'legacy', 'Legacy', '', array['overlapping','secondary'], 'record note')`
      await env.sql`insert into operation_proxy(id, group_id, name, endpoint, encrypted_credentials, tags, note)
      values (${source}, ${env.first.groupId}, 'Legacy proxy', '8.8.8.8:1080', '', array['overlapping'], 'proxy note')`
      const before = await env.sql`select id, tags, note from operation_account`
      const beforeProxy = await env.sql`select id, tags, note from operation_proxy`
      const beforeIds = (await env.sql`select id from business_label`).map((row) => row["id"])
      await env.sql.begin(async (tx) => {
        await tx.unsafe(
          await readFile(
            new URL("../db/migrations/0037_business_label_scopes.sql", import.meta.url),
            "utf8",
          ),
        )
      })
      expect(
        (await env.sql`select id, scope from business_label where id = ${groupId}`)[0],
      ).toMatchObject({ id: groupId, scope: "device" })
      expect(
        (await env.sql`select id, scope from business_label where id = ${orphanId}`)[0],
      ).toMatchObject({ id: orphanId, scope: "legacy" })
      expect(
        (await env.sql`select box_group_id from device where id = ${env.device.id}`)[0]?.[
          "box_group_id"
        ],
      ).toBe(groupId)
      expect([...(await env.sql`select id, tags, note from operation_account`)]).toEqual([
        ...before,
      ])
      expect([...(await env.sql`select id, tags, note from operation_proxy`)]).toEqual([
        ...beforeProxy,
      ])
      expect((await env.sql`select id from business_label`).map((row) => row["id"])).toEqual(
        expect.arrayContaining(beforeIds),
      )
      expect(
        (
          await env.sql`select scope from business_label where name = 'overlapping' order by scope`
        ).map((row) => row["scope"]),
      ).toEqual(["account", "device", "proxy"])
      expect(
        (await env.sql`select scope from business_label where name = 'secondary'`)[0]?.["scope"],
      ).toBe("account-tag")
      expect(await env.sql`select id from box_remark where id = ${orphanId}`).toHaveLength(0)
      expect(await env.sql`select id from business_label where name = 'proxy note'`).toHaveLength(0)
    },
  )
  pgTest(
    "preserves users and devices during source connection failure and recovers without remapping",
    async () => {
      const { sql, snapshot, first, device } = await setup()
      const before = await sql`select * from init_sync_state where source_key = 'fixture'`
      const unavailable = new URL(getTestDatabaseUrl())
      unavailable.hostname = "127.0.0.1"
      unavailable.port = "1"
      unavailable.pathname = "/tk_mg_test_unavailable_initializer"
      const runtime = startInitializerSync({
        DATABASE_URL: getTestDatabaseUrl(),
        INIT_SOURCE_DATABASE_URL: unavailable.toString(),
        INIT_SOURCE_KEY: "fixture",
      })
      await runtime.close()
      const after = await sql`select * from init_sync_state where source_key = 'fixture'`
      expect([...after]).toEqual([...before])
      expect(
        (await sql`select enabled from app_user where id = ${first.userId}`)[0]?.["enabled"],
      ).toBe(true)
      expect((await sql`select enabled from device where id = ${device.id}`)[0]?.["enabled"]).toBe(
        true,
      )
      await applyInitializerSnapshot(sql, "fixture", snapshot)
      expect(
        (await sql`select device_id from init_box_mapping where external_id = 'box-one'`)[0]?.[
          "device_id"
        ],
      ).toBe(device.id)
    },
  )
  pgTest(
    "sync is idempotent; password, disable and delete revoke sessions without deleting history",
    async () => {
      const context = await setup()
      const { sql, snapshot, device, first, app, cookie, login } = context
      await applyInitializerSnapshot(sql, "fixture", snapshot)
      expect((await sql`select id from device where external_id = 'box-one'`)[0]?.["id"]).toBe(
        device.id,
      )
      expect(await sql`select * from init_admin_mapping`).toHaveLength(2)
      const changed = structuredClone(snapshot)
      const admin = changed.admins[0]
      if (admin === undefined) throw new Error("Missing admin")
      admin.passwordHash = await Bun.password.hash("changed-password", {
        algorithm: "bcrypt",
        cost: 4,
      })
      await applyInitializerSnapshot(sql, "fixture", changed)
      expect((await app.request("/api/auth/session", { headers: { cookie } })).status).toBe(401)
      expect((await login(admin.email)).response.status).toBe(401)
      expect((await login(admin.email, "changed-password")).response.status).toBe(200)
      admin.enabled = false
      await applyInitializerSnapshot(sql, "fixture", changed)
      expect((await login(admin.email, "changed-password")).response.status).toBe(401)
      expect(
        (await sql`select assignee_user_id from device where id = ${device.id}`)[0]?.[
          "assignee_user_id"
        ],
      ).toBeNull()
      await applyInitializerSnapshot(sql, "fixture", {
        admins: [snapshot.admins[1]].filter(
          (item): item is InitializerSnapshot["admins"][number] => item !== undefined,
        ),
        boxes: [],
      })
      expect(
        (await sql`select enabled from app_user where id = ${first.userId}`)[0]?.["enabled"],
      ).toBe(false)
      expect((await sql`select enabled from device where id = ${device.id}`)[0]?.["enabled"]).toBe(
        false,
      )
      expect(await sql`select * from init_box_mapping`).toHaveLength(1)
    },
  )

  pgTest("conflicts roll back the entire snapshot instead of merging accounts", async () => {
    const { sql, snapshot } = await setup()
    await sql`insert into app_user(email, password_hash, role) values ('collision@example.test','unused','operator')`
    const changed = structuredClone(snapshot)
    const admin = changed.admins[0]
    if (admin === undefined) throw new Error("Missing admin")
    admin.email = "collision@example.test"
    await expect(applyInitializerSnapshot(sql, "fixture", changed)).rejects.toBeInstanceOf(
      InitializerConflictError,
    )
    expect(
      await sql`select id from app_user where email = 'first@example.test' and enabled`,
    ).toHaveLength(1)
    expect(await sql`select * from init_admin_mapping`).toHaveLength(2)
  })

  pgTest(
    "scopes group APIs, accounts, tasks, devices and frames across administrators",
    async () => {
      const { app, cookie, secondCookie, first, second, device, post, enqueue } = await setup()
      const groups = await app.request("/api/access/groups", { headers: { cookie } })
      expect(await groups.json()).toMatchObject({ items: [{ id: first.groupId }] })
      const own = await post(`/api/groups/${first.groupId}/operations/accounts`, {
        identifier: "persisted-account",
        name: "Account",
        secret: "account-secret",
        tags: ["group-one"],
      })
      expect(own.status).toBe(201)
      const list = await app.request(`/api/groups/${first.groupId}/operations/accounts`, {
        headers: { cookie },
      })
      expect(await list.json()).toMatchObject({
        total: 1,
        items: [{ identifier: "persisted-account", tags: ["group-one"] }],
      })
      expect(
        (
          await app.request(`/api/groups/${second.groupId}/operations/accounts`, {
            headers: { cookie },
          })
        ).status,
      ).toBe(404)
      const boxes = await app.request("/api/devices", { headers: { cookie: secondCookie } })
      expect(await boxes.json()).toEqual([])
      expect(
        (
          await app.request(`/api/frames?deviceId=${device.id}&index=1`, {
            headers: { cookie: secondCookie },
          })
        ).status,
      ).toBe(404)
      const task = z.object({ taskId: z.string() }).parse(await (await enqueue("private")).json())
      expect(
        (await app.request(`/api/tasks/${task.taskId}`, { headers: { cookie: secondCookie } }))
          .status,
      ).toBe(404)
    },
  )

  pgTest("rolls back terminal state and lease release if history insertion fails", async () => {
    const { sql, enqueue, claim, status } = await setup()
    await enqueue("history-rollback")
    const pointer = Pointer.parse(await (await claim()).json())
    await sql`create function reject_box_history() returns trigger language plpgsql as $$
        begin raise exception 'test history failure'; end $$`
    await sql`create trigger reject_box_history before insert on operation_log
        for each row execute function reject_box_history()`
    expect((await status(pointer)).status).toBe(500)
    expect(
      (await sql`select status from execution_task where id = ${pointer.task_id}`)[0]?.["status"],
    ).toBe("dispatching")
    expect(
      (
        await sql`select status from execution_task_step where id = ${pointer.checkpoint.step_id}`
      )[0]?.["status"],
    ).toBe("claimed")
    expect(
      await sql`select id from execution_task_device_lease where task_id = ${pointer.task_id} and released_at is null`,
    ).toHaveLength(1)
    await sql`drop trigger reject_box_history on operation_log`
    expect((await status(pointer)).status).toBe(200)
  })

  pgTest(
    "serializes submissions, canonical idempotency and claims without Worker competition",
    async () => {
      const { sql, first, enqueue, claim, status } = await setup()
      const responses = await Promise.all(Array.from({ length: 8 }, () => enqueue("concurrent")))
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 200, 200, 200, 200, 200, 200, 201,
      ])
      expect(await sql`select id from execution_task`).toHaveLength(1)
      const actor = { actorId: first.userId, actorType: "system" as const, requestId: "test" }
      const worker = createPostgresWorkerRepository(sql, {
        systemActor: actor,
      })
      expect(await worker.claimTask("generic-worker", Date.now(), 30000)).toBeNull()
      expect(
        await createPostgresExecutionTaskRepository(sql, actor).claimTask(
          "api-worker",
          Date.now(),
          30000,
        ),
      ).toBeNull()
      const claimed = await Promise.all([claim(), claim(), claim(), claim()])
      expect(claimed.filter((response) => response.status === 200)).toHaveLength(1)
      const response = claimed.find((item) => item.status === 200)
      if (response === undefined) throw new Error("Missing claim")
      const pointer = Pointer.parse(await response.json())
      expect(pointer.templateDoc.steps[0]?.afterMs).toBe(25)
      expect((await claim()).status).toBe(204)
      const finished = await Promise.all([status(pointer), status(pointer)])
      expect(finished.every((item) => item.ok)).toBe(true)
      expect((await status(pointer)).status).toBe(200)
      expect((await status(pointer, "failed")).status).toBe(409)
      const next = Pointer.parse(await (await claim()).json())
      expect(next.checkpoint.step_id).not.toBe(pointer.checkpoint.step_id)
      expect((await status(next)).status).toBe(200)
      expect((await sql`select status from execution_task`)[0]?.["status"]).toBe("succeeded")
      expect(
        await sql`select id from execution_task_device_lease where released_at is null`,
      ).toHaveLength(0)
    },
  )

  pgTest(
    "rejects reused tokens and atomically validates event batches with historical ownership",
    async () => {
      const { sql, app, snapshot, second, device, post, enqueue, claim, status } = await setup()
      const anotherId = crypto.randomUUID()
      await sql`insert into device(id,group_id,external_id,host,name,model)
      values (${anotherId},${second.groupId},'another-box','192.0.2.11','another','Q1')`
      await expect(
        sql`insert into device_agent(device_id,token_hash) values (${anotherId},${hash(token)})`
          .execute()
          .then((rows) => rows),
      ).rejects.toHaveProperty("code", "23505")
      await enqueue("event-history")
      const first = Pointer.parse(await (await claim()).json())
      await status(first)
      const last = Pointer.parse(await (await claim()).json())
      await status(last)
      const foreignToken = "valid-but-foreign-agent-token"
      await sql`insert into device_agent(device_id,token_hash) values (${anotherId},${hash(foreignToken)})`
      const foreign = (path: string, body: unknown) =>
        app.request(path, {
          method: "POST",
          headers: { authorization: `Bearer ${foreignToken}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      expect(
        (
          await foreign(`/agent/tasks/${first.task_id}/status`, {
            status: "succeeded",
            checkpoint: { step_id: first.checkpoint.step_id },
          })
        ).status,
      ).toBe(404)
      expect(
        (
          await foreign(`/agent/tasks/${first.task_id}/guard`, {
            stepId: first.checkpoint.step_id,
          })
        ).status,
      ).toBe(404)
      const oldGroup = device.groupId
      const changed = structuredClone(snapshot)
      const box = changed.boxes[0]
      if (box === undefined) throw new Error("Missing box")
      box.adminId = "second"
      await applyInitializerSnapshot(sql, "fixture", changed)
      const report = {
        box_id: "box-one",
        task_id: first.task_id,
        event: "step.ok",
        msg: "historical-event",
      }
      expect((await post("/agent/events", [report], true)).status).toBe(200)
      expect(
        (await sql`select group_id from operation_log where text = 'historical-event'`)[0]?.[
          "group_id"
        ],
      ).toBe(oldGroup)
      expect(
        (
          await post(
            "/agent/events",
            [
              { ...report, msg: "must-not-partially-persist" },
              { ...report, task_id: crypto.randomUUID() },
            ],
            true,
          )
        ).status,
      ).toBe(404)
      expect(
        await sql`select id from operation_log where text = 'must-not-partially-persist'`,
      ).toHaveLength(0)
      expect(
        (await post("/agent/events", [{ ...report, task_id: "malformed" }], true)).status,
      ).toBe(400)
    },
  )

  pgTest(
    "resumes confirmed steps across service restart and closes pending long polls",
    async () => {
      const { cookie, enqueue, claim, status, restart } = await setup()
      await enqueue("restart")
      const first = Pointer.parse(await (await claim()).json())
      await status(first)
      const app = await restart()
      const next = Pointer.parse(await (await claim()).json())
      expect(next.task_id).toBe(first.task_id)
      expect(next.checkpoint.step_id).not.toBe(first.checkpoint.step_id)
      await status(next)
      expect(
        (await app.request(`/api/tasks/${first.task_id}`, { headers: { cookie } })).status,
      ).toBe(200)
      const start = Date.now()
      const pending = app.request("/agent/tasks/claim?boxId=box-one&wait=25s", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      })
      await Bun.sleep(50)
      await boxRuntime?.close()
      expect((await pending).status).toBe(204)
      expect(Date.now() - start).toBeLessThan(2000)
    },
  )

  pgTest("stops remaining work between confirmed steps before transferring ownership", async () => {
    const { sql, snapshot, second, enqueue, claim, status, device } = await setup()
    await enqueue("between-steps")
    const first = Pointer.parse(await (await claim()).json())
    await status(first)
    const changed = structuredClone(snapshot)
    const box = changed.boxes[0]
    if (box === undefined) throw new Error("Missing box")
    box.adminId = "second"
    await applyInitializerSnapshot(sql, "fixture", changed)
    expect(
      (await sql`select status from execution_task where id = ${first.task_id}`)[0]?.["status"],
    ).toBe("cancelled")
    expect(
      (await sql`select group_id,assignment_pending from device where id = ${device.id}`)[0],
    ).toMatchObject({
      group_id: second.groupId,
      assignment_pending: false,
    })
    expect((await claim()).status).toBe(204)
  })

  pgTest(
    "keeps slots serial, allows different slots in parallel and blocks a wide claim",
    async () => {
      const { sql, post, enqueue, claim } = await setup()
      expect(
        (
          await post(
            "/agent/heartbeat",
            {
              boxId: "box-one",
              slots: [1, 2].map((indexNum) => ({ indexNum, status: "running" })),
            },
            true,
          )
        ).status,
      ).toBe(200)
      await enqueue("slot-one", 1)
      await enqueue("slot-one-again", 1)
      await enqueue("slot-two", 2)
      await enqueue("wide", 0)
      const first = Pointer.parse(await (await claim()).json())
      const second = Pointer.parse(await (await claim()).json())
      expect([first.bindings.indexNum, second.bindings.indexNum].sort()).toEqual([1, 2])
      expect((await claim()).status).toBe(204)
      expect(
        await sql`select id from execution_task_device_lease where released_at is null`,
      ).toHaveLength(2)
    },
  )

  pgTest(
    "retains unknown leases, fences late reports and pauses reassignment until reconciliation",
    async () => {
      const { sql, snapshot, device, second, enqueue, claim, status, app, cookie, post } =
        await setup()
      const group = await post("/api/box-groups", { name: "retained-until-confirmed" })
      const remark = await post("/api/box-remarks", { name: "retained-remark" })
      expect(group.status).toBe(201)
      expect(remark.status).toBe(201)
      const groupId = z.object({ id: z.string().uuid() }).parse(await group.json()).id
      const remarkId = z.object({ id: z.string().uuid() }).parse(await remark.json()).id
      expect(
        (
          await post("/api/devices/labels", {
            deviceIds: [device.id],
            boxGroupId: groupId,
            remarkId,
          })
        ).status,
      ).toBe(200)
      await enqueue("unknown")
      const pointer = Pointer.parse(await (await claim()).json())
      await sql`update execution_task_run set claim_expires_at = now() - interval '1 second'`
      await sql`update execution_task_device_lease set expires_at = now() - interval '1 second'`
      await recoverBoxTasks(sql)
      await recoverBoxTasks(sql)
      expect((await status(pointer)).status).toBe(404)
      expect((await claim()).status).toBe(204)
      const moved = structuredClone(snapshot)
      const box = moved.boxes[0]
      if (box === undefined) throw new Error("Missing box")
      box.adminId = "second"
      await applyInitializerSnapshot(sql, "fixture", moved)
      expect(
        (await sql`select assignment_pending from device where id = ${device.id}`)[0]?.[
          "assignment_pending"
        ],
      ).toBe(true)
      expect(
        (await sql`select box_group_id, remark_id from device where id = ${device.id}`)[0],
      ).toMatchObject({ box_group_id: groupId, remark_id: remarkId })
      await applyInitializerSnapshot(sql, "fixture", moved)
      expect(
        (await sql`select box_group_id, remark_id from device where id = ${device.id}`)[0],
      ).toMatchObject({ box_group_id: groupId, remark_id: remarkId })
      expect(await (await app.request("/api/devices", { headers: { cookie } })).json()).toEqual([])
      expect((await enqueue("old-owner")).status).toBe(404)
      expect((await sql`select status from execution_task`)[0]?.["status"]).toBe(
        "needs_reconciliation",
      )
      // A test operator explicitly confirms the execution stopped; the synchronizer never does this.
      await sql`update execution_task set status = 'failed', finished_at = now(), terminal_reason = 'confirmed_stopped'`
      await recoverBoxTasks(sql)
      await applyInitializerSnapshot(sql, "fixture", moved)
      expect(
        (await sql`select group_id from device where id = ${device.id}`)[0]?.["group_id"],
      ).toBe(second.groupId)
      expect(
        (await sql`select box_group_id, remark_id from device where id = ${device.id}`)[0],
      ).toMatchObject({ box_group_id: null, remark_id: null })
      expect(
        await sql`select id from business_label where id = any(${[groupId, remarkId]}::uuid[])`,
      ).toHaveLength(2)
      expect(
        await sql`select * from device_group_history where device_id = ${device.id}`,
      ).toHaveLength(2)
      expect(await sql`select * from execution_task where id = ${pointer.task_id}`).toHaveLength(1)
    },
  )

  pgTest("unassigns never-dispatched tasks and preserves UUID on allocation changes", async () => {
    const { sql, snapshot, device, second, enqueue } = await setup()
    await enqueue("not-started")
    const changed = structuredClone(snapshot)
    const box = changed.boxes[0]
    if (box === undefined) throw new Error("Missing box")
    box.adminId = null
    await applyInitializerSnapshot(sql, "fixture", changed)
    expect((await sql`select status from execution_task`)[0]?.["status"]).toBe("cancelled")
    box.adminId = "second"
    await applyInitializerSnapshot(sql, "fixture", changed)
    expect(
      (await sql`select id, group_id from device where external_id = 'box-one'`)[0],
    ).toMatchObject({
      id: device.id,
      group_id: second.groupId,
    })
  })

  pgTest(
    "persists idempotent guard insertion and resumes the next guard without replaying the skill",
    async () => {
      const { sql, post, enqueue, claim, status } = await setup()
      await enqueue("guards", 1, ["transcode", "ad"])
      const pointer = Pointer.parse(await (await claim()).json())
      const path = `/agent/tasks/${pointer.task_id}/guard`
      const body = { stepId: pointer.checkpoint.step_id }
      expect(await (await post(path, body, true)).json()).toMatchObject({
        action: "probe",
        guard: "ad",
      })
      expect((await status(pointer)).status).toBe(409)
      const reports = await Promise.all(
        [1, 2].map(() =>
          post(
            path,
            {
              ...body,
              output: '<node text="Settings"/>',
            },
            true,
          ),
        ),
      )
      const first = await reports[0]?.json()
      expect(first).toMatchObject({ action: "ood", guard: "ad" })
      expect(await reports[1]?.json()).toEqual(first)
      expect(await sql`select id from execution_task_step where role = 'ood'`).toHaveLength(1)
      const guard = Pointer.parse(await (await claim()).json())
      expect(guard.role).toBe("ood")
      expect((await status(guard)).status).toBe(200)
      const resumed = Pointer.parse(await (await claim()).json())
      expect(resumed.phase).toBe("guard")
      expect(resumed.checkpoint.step_id).toBe(pointer.checkpoint.step_id)
      expect(await (await post(path, body, true)).json()).toMatchObject({
        action: "probe",
        guard: "transcode",
      })
      const pass = await post(path, { ...body, output: '<node text="clear"/>' }, true)
      expect(await pass.json()).toMatchObject({
        action: "pass",
        guard: "transcode",
        pending: false,
      })
      expect((await status(resumed)).status).toBe(200)
    },
  )

  pgTest(
    "rejects malformed and foreign reports and expires long polls and watch access",
    async () => {
      const { app, post, device, sql, cookie, secondCookie, enqueue, claim } = await setup()
      expect((await post("/agent/register", { boxId: "another-box" }, true)).status).toBe(401)
      expect(
        (await post("/agent/heartbeat", { boxId: "box-one", slots: [{ indexNum: 99 }] }, true))
          .status,
      ).toBe(400)
      const begin = Date.now()
      expect((await post("/agent/tasks/claim?boxId=box-one&wait=20ms", {}, true)).status).toBe(204)
      expect(Date.now() - begin).toBeLessThan(1000)
      await enqueue("foreign")
      const pointer = Pointer.parse(await (await claim()).json())
      const unauthorized = await app.request(`/agent/tasks/${pointer.task_id}/status`, {
        method: "POST",
        headers: { authorization: "Bearer foreign-token", "content-type": "application/json" },
        body: JSON.stringify({
          status: "succeeded",
          checkpoint: { step_id: pointer.checkpoint.step_id },
        }),
      })
      expect(unauthorized.status).toBe(401)
      expect((await post(`/api/devices/${device.id}/watch`, { indexNums: [1] })).status).toBe(200)
      const frame = new Uint8Array([255, 216, 255, 217])
      expect(
        (
          await app.request("/agent/frames?boxId=box-one&indexNum=1", {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
            body: frame,
          })
        ).status,
      ).toBe(204)
      expect(
        (await app.request(`/api/frames?deviceId=${device.id}&index=1`, { headers: { cookie } }))
          .status,
      ).toBe(200)
      expect(
        (
          await app.request(`/api/frames?deviceId=${device.id}&index=1`, {
            headers: { cookie: secondCookie },
          })
        ).status,
      ).toBe(404)
      await sql`update device_watch set expires_at = now() - interval '1 second'`
      expect(
        (await app.request(`/api/frames?deviceId=${device.id}&index=1`, { headers: { cookie } }))
          .status,
      ).toBe(204)
    },
  )
})
