import { afterEach, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"

import { createApp } from "../../app"
import {
  createMigratedTestDatabase,
  getTestDatabaseUrl,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { createSecretCipher } from "../../lib/crypto"
import { createPostgresAccountRepository } from "../accounts/repository"
import { createAccountService } from "../accounts/service"
import { createPostgresAuditRepository } from "../audit/service"
import { createPostgresAuthRepository } from "../auth/postgres-repository"
import { createAuthService } from "../auth/service"
import { registerBoxLink } from "../box-link"
import { applyInitializerSnapshot } from "../initializer-sync/repository"
import type { InitializerSnapshot } from "../initializer-sync/source"
import { createPostgresMemberRepository } from "../members/repository"
import { registerDispatchRoutes } from "./routes"

const pgTest = hasConfiguredTestDatabase ? it : it.skip
const secret = "replay-test-password"
const token = "replay-agent-token"
const hash = (value: string) => createHash("sha256").update(value).digest("hex")

let database: MigratedTestDatabase | undefined
let boxRuntime: ReturnType<typeof registerBoxLink> | undefined

afterEach(async () => {
  await boxRuntime?.close()
  boxRuntime = undefined
  await database?.close()
  database = undefined
})

const setup = async () => {
  database = await createMigratedTestDatabase()
  const sql = database.client
  const passwordHash = await Bun.password.hash(secret, { algorithm: "bcrypt", cost: 4 })
  const snapshot: InitializerSnapshot = {
    admins: [
      {
        id: "first",
        username: "first",
        email: "first@example.test",
        passwordHash,
        enabled: true,
      },
    ],
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
  const first = (
    await sql<{ groupId: string; userId: string }[]>`
      select user_id as "userId", group_id as "groupId" from init_admin_mapping where source_id = 'first'`
  )[0]
  const device = (
    await sql<{ id: string }[]>`select id from device where external_id = 'box-one'`
  )[0]
  if (first === undefined || device === undefined) throw new Error("missing fixture")
  await sql`insert into device_agent(device_id, token_hash) values (${device.id}, ${hash(token)})`
  await sql`insert into device_instance(device_id, instance_index, label) values (${device.id}, 1, '1')`
  const account = (
    await sql<{ id: string }[]>`
      insert into operation_account(group_id, identifier, name, encrypted_secret, tags)
      values (${first.groupId}::uuid, 'user-a', 'user-a', 'x', ${sql.array(["一组"])})
      returning id::text as id`
  )[0]
  if (account === undefined) throw new Error("missing account")
  const auditRepository = createPostgresAuditRepository(sql)
  const authService = createAuthService(createPostgresAuthRepository(sql))
  const app = createApp({
    accessGroupRepository: createPostgresMemberRepository(sql),
    accountService: createAccountService({
      auditRepository,
      cipher: createSecretCipher("12345678901234567890123456789012"),
      repository: createPostgresAccountRepository(sql),
    }),
    auditRepository,
    authService,
  })
  boxRuntime = registerBoxLink(app, sql, getTestDatabaseUrl(), authService, auditRepository)
  registerDispatchRoutes(
    app,
    sql,
    createSecretCipher("12345678901234567890123456789012"),
    authService,
    auditRepository,
  )
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "first@example.test", password: secret }),
  })
  const cookie = login.headers.get("set-cookie") ?? ""
  const send = (path: string, body?: unknown, as: "user" | "agent" = "user", method = "POST") =>
    app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(as === "agent" ? { authorization: `Bearer ${token}` } : { cookie }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  return { accountId: account.id, cookie, device, first, send, sql }
}

const accountPick = (id: string) => ({
  groups: ["一组"],
  ids: [id],
  keyword: "",
  mode: "and" as const,
  tags: [] as string[],
  ungrouped: false,
})

const failFirstStage = async (
  sql: MigratedTestDatabase["client"],
): Promise<{ failedId: string; laterId: string | null }> => {
  const tasks = await sql<{ id: string; stagePosition: number }[]>`
    select id::text as id, stage_position as "stagePosition"
    from execution_task order by stage_position, repeat_index`
  const failed = tasks.find((item) => item.stagePosition === 0)
  const later = tasks.find((item) => item.stagePosition === 1)
  if (failed === undefined) throw new Error("missing stage")
  await sql`
    update execution_task set status = 'failed', finished_at = now() where id = ${failed.id}::uuid`
  await sql`
    update execution_task_step set status = 'failed', finished_at = now()
    where task_id = ${failed.id}::uuid`
  if (later !== undefined) {
    await sql`
      update execution_task
      set status = 'cancelled', terminal_reason = 'previous_stage_stopped', finished_at = now()
      where id = ${later.id}::uuid`
    await sql`
      update execution_task_step set status = 'cancelled', finished_at = now()
      where task_id = ${later.id}::uuid`
  }
  return { failedId: failed.id, laterId: later?.id ?? null }
}

describe("stage replay", () => {
  pgTest("refuses a manual replay of a failed stage", async () => {
    const env = await setup()
    const proxy = await env.send("/api/behavior-chains", {
      name: "代理",
      origin: "rpa",
      steps: [
        {
          api: "SetProxy",
          delayMs: 0,
          guards: [],
          params: { ip: "", port: "", pwd: "", type: "1", usr: "" },
          scopes: {
            ip: "external",
            port: "external",
            pwd: "external",
            type: "internal",
            usr: "external",
          },
          sources: {
            ip: "proxy.host",
            port: "proxy.port",
            pwd: "proxy.password",
            type: "literal",
            usr: "proxy.username",
          },
        },
      ],
    })
    expect(proxy.status).toBe(201)
    const proxyId = ((await proxy.json()) as { id: string }).id
    const next = await env.send("/api/behavior-chains", {
      name: "打开",
      origin: "rpa",
      steps: [{ api: "OpenApp", delayMs: 0, guards: [], params: { pkg: "com.demo" } }],
    })
    expect(next.status).toBe(201)
    const nextId = ((await next.json()) as { id: string }).id
    const cipher = createSecretCipher("12345678901234567890123456789012")
    const proxies = await env.sql<{ id: string }[]>`
      insert into operation_proxy (group_id, name, endpoint, encrypted_credentials, configuration)
      values
        (${env.first.groupId}::uuid, '代理甲', '10.0.0.8:1080', ${cipher.encrypt("user:pass")}, ${env.sql.json({ host: "10.0.0.8", port: 1080 })}),
        (${env.first.groupId}::uuid, '代理乙', '10.0.0.9:1080', ${cipher.encrypt("user:pass")}, ${env.sql.json({ host: "10.0.0.9", port: 1080 })})
      returning id::text as id`
    const firstProxy = proxies[0]?.id
    if (firstProxy === undefined) throw new Error("missing proxy")
    await env.sql`
      update operation_account set proxy_id = ${firstProxy}::uuid where identifier = 'user-a'`
    const chain = await env.send("/api/task-chains", {
      name: "两段",
      stages: [{ chainId: proxyId }, { chainId: nextId }],
    })
    expect(chain.status).toBe(201)
    const taskChainId = ((await chain.json()) as { id: string }).id
    const dispatch = await env.send(`/api/groups/${env.first.groupId}/dispatches`, {
      accounts: accountPick(env.accountId),
      taskChainId,
    })
    expect(dispatch.status).toBe(201)
    const dispatchId = ((await dispatch.json()) as { id: string }).id
    const started = await env.send(`/api/groups/${env.first.groupId}/dispatches/start`, {
      ids: [dispatchId],
    })
    expect(started.status).toBe(200)
    const { failedId, laterId } = await failFirstStage(env.sql)
    const before = await env.sql<{ n: number }[]>`select count(*)::int as n from execution_task`
    const kept = await env.send(
      `/api/groups/${env.first.groupId}/dispatch-records/${failedId}/replay`,
      { choices: [{ kind: "proxy", mode: "keep" }] },
    )
    expect(kept.status).toBe(403)
    expect(await kept.json()).toEqual({ error: "manual_replay_disabled" })
    const after = await env.sql<{ n: number }[]>`select count(*)::int as n from execution_task`
    expect(after[0]?.n).toBe(before[0]?.n)
    const later = await env.sql<{ status: string }[]>`
      select status from execution_task where id = ${laterId}::uuid`
    expect(later[0]?.status).toBe("cancelled")
    const cleared = await env.send(`/api/groups/${env.first.groupId}/dispatch-records/clear`, {
      deviceIds: [env.device.id],
      unassigned: false,
    })
    expect(cleared.status).toBe(200)
    const left = await env.sql<
      { n: number }[]
    >`select count(*)::int as n from operation_stage_replay`
    expect(left[0]?.n).toBe(0)
  })

  pgTest("refuses a manual proxy redraw and a manual text redraw", async () => {
    const env = await setup()
    const cipher = createSecretCipher("12345678901234567890123456789012")
    const proxies = await env.sql<{ id: string; name: string }[]>`
      insert into operation_proxy (group_id, name, endpoint, encrypted_credentials, configuration)
      values
        (${env.first.groupId}::uuid, '代理甲', '10.0.0.8:1080', ${cipher.encrypt("user:pass")}, ${env.sql.json({ host: "10.0.0.8", port: 1080 })}),
        (${env.first.groupId}::uuid, '代理乙', '10.0.0.9:1080', ${cipher.encrypt("user:pass")}, ${env.sql.json({ host: "10.0.0.9", port: 1080 })})
      returning id::text as id, name`
    const firstProxy = proxies.find((item) => item.name === "代理甲")?.id
    if (firstProxy === undefined) throw new Error("missing proxy")
    await env.sql`update operation_account set proxy_id = ${firstProxy}::uuid where identifier = 'user-a'`
    const proxy = await env.send("/api/behavior-chains", {
      name: "代理",
      origin: "rpa",
      steps: [
        {
          api: "SetProxy",
          delayMs: 0,
          guards: [],
          params: { ip: "", port: "", pwd: "", type: "1", usr: "" },
          scopes: {
            ip: "external",
            port: "external",
            pwd: "external",
            type: "internal",
            usr: "external",
          },
          sources: {
            ip: "proxy.host",
            port: "proxy.port",
            pwd: "proxy.password",
            type: "literal",
            usr: "proxy.username",
          },
        },
      ],
    })
    expect(proxy.status).toBe(201)
    const proxyChain = ((await proxy.json()) as { id: string }).id
    const chain = await env.send("/api/task-chains", {
      name: "只代理",
      stages: [{ chainId: proxyChain }],
    })
    const taskChainId = ((await chain.json()) as { id: string }).id
    const dispatch = await env.send(`/api/groups/${env.first.groupId}/dispatches`, {
      accounts: accountPick(env.accountId),
      taskChainId,
    })
    expect(dispatch.status).toBe(201)
    const dispatchId = ((await dispatch.json()) as { id: string }).id
    expect(
      (await env.send(`/api/groups/${env.first.groupId}/dispatches/start`, { ids: [dispatchId] }))
        .status,
    ).toBe(200)
    const { failedId } = await failFirstStage(env.sql)
    const redrawn = await env.send(
      `/api/groups/${env.first.groupId}/dispatch-records/${failedId}/replay`,
      { choices: [{ kind: "proxy", mode: "redraw" }] },
    )
    expect(redrawn.status).toBe(403)
    expect(await redrawn.json()).toEqual({ error: "manual_replay_disabled" })
    const host = await env.sql<{ ip: string; proxy: string }[]>`
      select s.parameters->>'ip' as ip, i.proxy_id::text as proxy
      from operation_dispatch_step s
      join operation_dispatch_item i on i.id = s.item_id
      where i.dispatch_id = ${dispatchId}::uuid and s.sequence = 0`
    expect(host[0]?.proxy).toBe(firstProxy)

    const text = await env.send("/api/behavior-chains", {
      name: "文案",
      origin: "rpa",
      steps: [
        {
          api: "SendText",
          delayMs: 0,
          guards: [],
          params: { text: "" },
          scopes: { text: "external" },
          sources: { text: "pool.text" },
        },
      ],
    })
    expect(text.status).toBe(201)
    const textChain = ((await text.json()) as { id: string }).id
    const resource = (
      await env.sql<{ id: string }[]>`
        insert into operation_resource (group_id, name, category)
        values (${env.first.groupId}::uuid, '原文', '文案')
        returning id::text as id`
    )[0]
    if (resource === undefined) throw new Error("missing text")
    const textTask = await env.send("/api/task-chains", {
      name: "只文案",
      stages: [{ chainId: textChain }],
    })
    const textChainId = ((await textTask.json()) as { id: string }).id
    const textDispatch = await env.send(`/api/groups/${env.first.groupId}/dispatches`, {
      accounts: accountPick(env.accountId),
      taskChainId: textChainId,
      texts: [
        { ids: [resource.id], keyword: "", mode: "and", sequence: 0, stage: 0, tags: ["文案"] },
      ],
    })
    expect(textDispatch.status).toBe(201)
    const textDispatchId = ((await textDispatch.json()) as { id: string }).id
    expect(
      (
        await env.send(`/api/groups/${env.first.groupId}/dispatches/start`, {
          ids: [textDispatchId],
        })
      ).status,
    ).toBe(200)
    await env.sql`delete from operation_resource where group_id = ${env.first.groupId}::uuid`
    const textTasks = await env.sql<{ id: string }[]>`
      select id::text as id from execution_task
      where idempotency_key like 'dispatch:%:0:0' and name = '文案'`
    const textFailed = textTasks[0]?.id
    if (textFailed === undefined) throw new Error("missing text task")
    await env.sql`update execution_task set status = 'failed' where id = ${textFailed}::uuid`
    const before = await env.sql<{ n: number }[]>`select count(*)::int as n from execution_task`
    const empty = await env.send(
      `/api/groups/${env.first.groupId}/dispatch-records/${textFailed}/replay`,
      { choices: [{ kind: "text", mode: "redraw", sequence: 0 }] },
    )
    expect(empty.status).toBe(403)
    expect(((await empty.json()) as { error: string }).error).toBe("manual_replay_disabled")
    const after = await env.sql<{ n: number }[]>`select count(*)::int as n from execution_task`
    expect(after[0]?.n).toBe(before[0]?.n)
  })

  pgTest("claims a cut-in task before an older queued task", async () => {
    const env = await setup()
    const requester = env.first.userId
    const insert = async (name: string, priority: number, age: string) => {
      const id = crypto.randomUUID()
      await env.sql`
        insert into execution_task (
          id, group_id, requester_id, device_id, idempotency_key, fingerprint, name,
          executor_key, parameters, status, queue_priority, created_at
        ) values (
          ${id}::uuid, ${env.first.groupId}::uuid, ${requester}::uuid, ${env.device.id}::uuid,
          ${name}, ${name}, ${name}, 'box-agent', '[]'::jsonb, 'queued', ${priority},
          now() - ${age}::interval
        )`
      await env.sql`
        insert into execution_task_step (
          id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters, status
        ) values (
          ${crypto.randomUUID()}::uuid, ${id}::uuid, ${env.first.groupId}::uuid, 0, ${`${name}:0`}, ${name},
          'OpenApp', '{"indexNum":1}'::jsonb, '{"pkg":"com.demo"}'::jsonb, 'pending'
        )`
    }
    await insert("普通", 0, "2 hours")
    await insert("插队", 1, "1 hour")
    const claim = await env.send("/agent/tasks/claim?boxId=box-one&wait=0", undefined, "agent")
    expect(claim.status).toBe(200)
    const body = (await claim.json()) as { name: string }
    expect(body.name.startsWith("插队")).toBe(true)
  })
})
