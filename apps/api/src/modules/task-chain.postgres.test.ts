import { afterEach, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"

import { createApp } from "../app"
import {
  createMigratedTestDatabase,
  getTestDatabaseUrl,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../db/test-database"
import { createSecretCipher } from "../lib/crypto"
import { createPostgresAccountRepository } from "./accounts/repository"
import { createAccountService } from "./accounts/service"
import { createPostgresAuditRepository } from "./audit/service"
import { createPostgresAuthRepository } from "./auth/postgres-repository"
import { createAuthService } from "./auth/service"
import { registerBoxLink } from "./box-link"
import { createDispatchRepository } from "./dispatch/repository"
import { registerDispatchRoutes } from "./dispatch/routes"
import { applyInitializerSnapshot } from "./initializer-sync/repository"
import type { InitializerSnapshot } from "./initializer-sync/source"
import { createPostgresMemberRepository } from "./members/repository"

const pgTest = hasConfiguredTestDatabase ? it : it.skip
const secret = "task-chain-test-password"
const token = "task-chain-agent-token"
const hash = (value: string) => createHash("sha256").update(value).digest("hex")

let database: MigratedTestDatabase | undefined
let boxRuntime: ReturnType<typeof registerBoxLink> | undefined

afterEach(async () => {
  await boxRuntime?.close()
  boxRuntime = undefined
  await database?.close()
  database = undefined
})

const step = (api: string, params: Record<string, string> = {}) => ({
  api,
  delayMs: 0,
  guards: [],
  params,
  scopes: Object.fromEntries(Object.keys(params).map((key) => [key, "internal"])),
  sources: Object.fromEntries(Object.keys(params).map((key) => [key, "literal"])),
})

const setup = async () => {
  database = await createMigratedTestDatabase()
  const sql = database.client
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
  const mappings = await sql<{ groupId: string; sourceId: string; userId: string }[]>`
    select source_id as "sourceId", user_id as "userId", group_id as "groupId"
    from init_admin_mapping order by source_id`
  const first = mappings.find((row) => row.sourceId === "first")
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
  const accountService = createAccountService({
    auditRepository,
    cipher: createSecretCipher("12345678901234567890123456789012"),
    repository: createPostgresAccountRepository(sql),
  })
  const app = createApp({
    accessGroupRepository: createPostgresMemberRepository(sql),
    accountService,
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
  const login = async (email: string) => {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: secret }),
    })
    return response.headers.get("set-cookie") ?? ""
  }
  const cookie = await login("first@example.test")
  const secondCookie = await login("second@example.test")
  const send = (
    path: string,
    body: unknown,
    as: "user" | "agent" | "other" = "user",
    method = "POST",
  ) =>
    app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(as === "agent"
          ? { authorization: `Bearer ${token}` }
          : { cookie: as === "other" ? secondCookie : cookie }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  return { accountId: account.id, app, cookie, device, first, secondCookie, send, sql }
}

const accountPick = (id: string) => ({
  groups: ["一组"],
  ids: [id],
  keyword: "",
  mode: "and" as const,
  tags: [] as string[],
  ungrouped: false,
})

describe("task chains", () => {
  pgTest(
    "saves a chain, publishes repeats once, and stops the later stages",
    async () => {
      const env = await setup()
      const chain = async (name: string, steps: ReturnType<typeof step>[]) => {
        const response = await env.send("/api/behavior-chains", { name, origin: "rpa", steps })
        expect(response.status).toBe(201)
        return ((await response.json()) as { id: string }).id
      }
      const login = await chain("登录", [
        step("JumpNodes", { jumpWhen: "success", steps: "10", text: "Home" }),
        step("DumpNodeXmlEx"),
        step("DumpNodeXmlEx"),
      ])
      const warm = await chain("养号", [step("DumpNodeXmlEx")])
      const post = await chain("发布", [step("DumpNodeXmlEx")])
      const invalid = await env.send("/api/task-chains", {
        name: "坏的",
        stages: [{ chainId: login, repeatCount: 2 }],
      })
      expect(invalid.status).toBe(400)
      expect(await invalid.json()).toEqual({ error: "invalid_task_chain" })
      const created = await env.send("/api/task-chains", {
        name: "重复",
        stages: [{ chainId: warm }, { chainId: warm }],
      })
      expect(created.status).toBe(201)
      const duplicated = (await created.json()) as { stages: { chainId: string }[] }
      expect(duplicated.stages.map((item) => item.chainId)).toEqual([warm, warm])
      expect(JSON.stringify(duplicated)).not.toContain("repeatCount")
      const published = await env.send("/api/task-chains", {
        name: "早班",
        stages: [{ chainId: login }, { chainId: warm }, { chainId: post }],
      })
      expect(published.status).toBe(201)
      const taskChain = (await published.json()) as { id: string; stages: { chainId: string }[] }
      expect(taskChain.stages.map((item) => item.chainId)).toEqual([login, warm, post])
      const other = await env.app.request("/api/task-chains", {
        headers: { cookie: env.secondCookie },
      })
      expect(other.status).toBe(200)
      expect(await other.json()).toEqual([])

      const dispatch = await env.send(`/api/groups/${env.first.groupId}/dispatches`, {
        accounts: accountPick(env.accountId),
        repeats: [{ stage: 1, count: 3 }],
        taskChainId: taskChain.id,
      })
      expect(dispatch.status).toBe(201)
      const dispatchId = ((await dispatch.json()) as { id: string }).id
      const saved = await env.sql<{ name: string; repeatPlan: unknown }[]>`
      select name, repeat_plan as "repeatPlan" from operation_dispatch where id = ${dispatchId}::uuid`
      expect(saved[0]?.name).toContain("养号 ×3")
      expect(saved[0]?.name.includes("–")).toBe(false)
      expect(saved[0]?.repeatPlan).toEqual([
        { count: 1, mode: "fixed", stage: 0 },
        { count: 3, mode: "fixed", stage: 1 },
        { count: 1, mode: "fixed", stage: 2 },
      ])
      const started = await env.send(`/api/groups/${env.first.groupId}/dispatches/start`, {
        ids: [dispatchId],
      })
      expect(started.status).toBe(200)
      const tasks = await env.sql<
        {
          idempotencyKey: string
          name: string
          predecessor: string | null
          repeatCount: number
          repeatIndex: number
          stageCount: number
          stagePosition: number
        }[]
      >`
      select name, stage_position as "stagePosition", stage_count as "stageCount",
        repeat_index as "repeatIndex", repeat_count as "repeatCount",
        predecessor_task_id::text as predecessor, idempotency_key as "idempotencyKey"
      from execution_task
      where task_chain_id = ${taskChain.id}::uuid
      order by stage_position, repeat_index`
      expect(
        tasks.map((item) => [item.name, item.stagePosition, item.repeatIndex, item.repeatCount]),
      ).toEqual([
        ["登录", 0, 0, 1],
        ["养号", 1, 0, 3],
        ["养号", 1, 1, 3],
        ["养号", 1, 2, 3],
        ["发布", 2, 0, 1],
      ])
      expect(tasks.every((item) => item.stageCount === 3)).toBe(true)
      expect(tasks[0]?.predecessor).toBeNull()
      expect(tasks[1]?.predecessor).toBeTruthy()
      expect(tasks[2]?.predecessor).toBeTruthy()
      const itemId = tasks[0]?.idempotencyKey.slice("dispatch:".length).split(":")[0]
      expect(tasks.map((item) => item.idempotencyKey)).toEqual([
        `dispatch:${itemId}:0:0`,
        `dispatch:${itemId}:1:0`,
        `dispatch:${itemId}:1:1`,
        `dispatch:${itemId}:1:2`,
        `dispatch:${itemId}:2:0`,
      ])
      const again = await env.send(`/api/groups/${env.first.groupId}/dispatches/start`, {
        ids: [dispatchId],
      })
      expect(again.status).toBe(200)
      const count = await env.sql<
        { n: number }[]
      >`select count(*)::int as n from execution_task where task_chain_id = ${taskChain.id}::uuid`
      expect(count[0]?.n).toBe(5)

      const chainRemoved = await env.send(
        `/api/behavior-chains/${login}`,
        undefined,
        "user",
        "DELETE",
      )
      expect(chainRemoved.status).toBe(409)
      const beforeSteps = await env.sql<
        { n: number }[]
      >`select count(*)::int as n from operation_dispatch_step`
      const edited = await env.send(
        `/api/task-chains/${taskChain.id}`,
        {
          name: "早班改",
          stages: [{ chainId: post }],
        },
        "user",
        "PUT",
      )
      expect(edited.status).toBe(200)
      const afterSteps = await env.sql<
        { n: number }[]
      >`select count(*)::int as n from operation_dispatch_step`
      expect(afterSteps[0]?.n).toBe(beforeSteps[0]?.n)

      const removed = await env.send(
        `/api/task-chains/${taskChain.id}`,
        undefined,
        "user",
        "DELETE",
      )
      expect(removed.status).toBe(409)
      const listed = await env.app.request(`/api/groups/${env.first.groupId}/dispatches`, {
        headers: { cookie: env.cookie },
      })
      const rows = ((await listed.json()) as { items: { chainName: string }[] }).items
      expect(rows.some((item) => item.chainName === "登录 → 养号 ×3 → 发布")).toBe(true)

      const claim = async () => {
        const response = await env.send("/agent/tasks/claim?boxId=box-one&wait=0", {}, "agent")
        if (response.status === 204) return null
        return (await response.json()) as {
          name: string
          repeatCount: number
          repeatIndex: number
          stageCount: number
          stagePosition: number
          task_id: string
          checkpoint: { step_id: string }
        }
      }
      const firstClaim = await claim()
      expect(firstClaim?.name).toBe("登录")
      expect(firstClaim?.stagePosition).toBe(1)
      expect(firstClaim?.stageCount).toBe(3)
      expect(firstClaim?.repeatIndex).toBe(1)
      expect(firstClaim?.repeatCount).toBe(1)
      const logs = async () =>
        env.sql<{ text: string }[]>`select text from operation_log order by created_at`
      expect((await logs()).filter((item) => item.text.includes("领取"))).toHaveLength(1)
      expect((await claim()) === null).toBe(true)
      if (firstClaim === undefined || firstClaim === null) throw new Error("missing claim")
      const jumped = await env.send(
        `/agent/tasks/${firstClaim.task_id}/status`,
        {
          status: "succeeded",
          checkpoint: { step_id: firstClaim.checkpoint.step_id, outputs: { count: "1" } },
        },
        "agent",
      )
      expect(jumped.status).toBe(200)
      const loginSteps = await env.sql<{ status: string }[]>`
      select status from execution_task_step where task_id = ${firstClaim.task_id}::uuid order by sequence`
      expect(loginSteps.map((item) => item.status)).toEqual(["succeeded", "skipped", "skipped"])
      const warmClaim = await claim()
      expect(warmClaim?.name).toBe("养号")
      expect(warmClaim?.repeatIndex).toBe(1)
      expect(warmClaim?.repeatCount).toBe(3)
      if (warmClaim === undefined || warmClaim === null) throw new Error("missing warm")
      expect(
        (
          await env.send(
            `/agent/tasks/${warmClaim.task_id}/status`,
            {
              status: "succeeded",
              checkpoint: { step_id: warmClaim.checkpoint.step_id, outputs: {} },
            },
            "agent",
          )
        ).status,
      ).toBe(200)
      const secondWarm = await claim()
      expect(secondWarm?.repeatIndex).toBe(2)
      if (secondWarm === undefined || secondWarm === null) throw new Error("missing second")
      const beforeEvents = (await logs()).length
      const claimedEvent = await env.send(
        "/agent/events",
        [{ box_id: "box-one", event: "task.claimed", msg: "claimed", task_id: secondWarm.task_id }],
        "agent",
      )
      expect(claimedEvent.status).toBe(200)
      expect((await logs()).length).toBe(beforeEvents)
      const stepEvent = await env.send(
        "/agent/events",
        [{ box_id: "box-one", event: "step.ok", msg: "ok", task_id: secondWarm.task_id }],
        "agent",
      )
      expect(stepEvent.status).toBe(200)
      expect((await logs()).length).toBe(beforeEvents + 1)
      const failed = await env.send(
        `/agent/tasks/${secondWarm.task_id}/status`,
        {
          status: "failed",
          error_code: "exec",
          checkpoint: { step_id: secondWarm.checkpoint.step_id, outputs: { error: "down" } },
        },
        "agent",
      )
      expect(failed.status).toBe(200)
      const rest = await env.sql<{ name: string; reason: string | null; status: string }[]>`
      select name, status, terminal_reason as reason from execution_task
      where task_chain_id = ${taskChain.id}::uuid
      order by stage_position, repeat_index`
      expect(rest.slice(3).map((item) => [item.name, item.status, item.reason])).toEqual([
        ["养号", "cancelled", "previous_stage_stopped"],
        ["发布", "cancelled", "previous_stage_stopped"],
      ])
      const text = (await logs()).map((item) => item.text)
      expect(
        text.some((item) => item.includes("「养号」第 3/3 次已取消，因为「养号」第 2/3 次未完成")),
      ).toBe(true)
      expect(
        text.some((item) => item.includes("「发布」已取消，因为「养号」第 2/3 次未完成")),
      ).toBe(true)

      const legacyChain = await chain("单链", [step("DumpNodeXmlEx")])
      const legacy = await env.send(`/api/groups/${env.first.groupId}/dispatches`, {
        accounts: accountPick(env.accountId),
        chainId: legacyChain,
      })
      expect(legacy.status).toBe(201)
      const legacyId = ((await legacy.json()) as { id: string }).id
      const legacyStarted = await env.send(`/api/groups/${env.first.groupId}/dispatches/start`, {
        ids: [legacyId],
      })
      expect(legacyStarted.status).toBe(200)
      const legacyTasks = await env.sql<
        {
          key: string
          repeatCount: number
          repeatIndex: number
          stageCount: number
          stagePosition: number
        }[]
      >`
      select idempotency_key as key, stage_position as "stagePosition", stage_count as "stageCount",
        repeat_index as "repeatIndex", repeat_count as "repeatCount"
      from execution_task where idempotency_key like 'dispatch:%' and task_chain_id is null
      order by created_at desc limit 1`
      expect(legacyTasks[0]?.key.startsWith("dispatch:")).toBe(true)
      expect(legacyTasks[0]?.key.split(":").length).toBe(2)
      expect(legacyTasks[0]).toMatchObject({
        repeatCount: 1,
        repeatIndex: 0,
        stageCount: 1,
        stagePosition: 0,
      })
      const legacyClaim = await claim()
      expect(legacyClaim).toMatchObject({
        name: "单链",
        repeatCount: 1,
        repeatIndex: 1,
        stageCount: 1,
        stagePosition: 1,
      })
      const listedAgain = await env.app.request(`/api/groups/${env.first.groupId}/dispatches`, {
        headers: { cookie: env.cookie },
      })
      const names = ((await listedAgain.json()) as { items: { chainName: string }[] }).items.map(
        (item) => item.chainName,
      )
      expect(names).toContain("单链")

      await env.sql`
      insert into execution_task (
        group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters
      ) values (
        ${env.first.groupId}::uuid, ${env.first.userId}::uuid, ${env.device.id}::uuid,
        'old-shape', 'old-shape', '旧任务', 'box-agent', '[]'::jsonb
      )`
      const old = await env.sql<
        { predecessor: string | null; repeatCount: number; stageCount: number }[]
      >`
      select predecessor_task_id::text as predecessor, stage_count as "stageCount", repeat_count as "repeatCount"
      from execution_task where idempotency_key = 'old-shape'`
      expect(old[0]).toEqual({ predecessor: null, repeatCount: 1, stageCount: 1 })
      let rejected = false
      try {
        await env.sql`insert into operation_dispatch (group_id, requester_id, name, selection) values (${env.first.groupId}::uuid, ${env.first.userId}::uuid, '空', '{}'::jsonb)`
      } catch {
        rejected = true
      }
      expect(rejected).toBe(true)
    },
    60000,
  )

  pgTest(
    "draws a separate repeat count for each account",
    async () => {
      const env = await setup()
      await env.sql`
      insert into operation_account(group_id, identifier, name, encrypted_secret, tags)
      values (${env.first.groupId}::uuid, 'user-b', 'user-b', 'x', ${env.sql.array(["一组"])})`
      const chain = async (name: string) => {
        const response = await env.send("/api/behavior-chains", {
          name,
          origin: "rpa",
          steps: [step("DumpNodeXmlEx")],
        })
        expect(response.status).toBe(201)
        return ((await response.json()) as { id: string }).id
      }
      const login = await chain("登录")
      const warm = await chain("养号")
      const created = await env.send("/api/task-chains", {
        name: "随机",
        stages: [{ chainId: login }, { chainId: warm }],
      })
      expect(created.status).toBe(201)
      const taskChainId = ((await created.json()) as { id: string }).id
      const draws = [0, 0.999]
      let cursor = 0
      const cipher = createSecretCipher("12345678901234567890123456789012")
      const selection = {
        accountIds: [] as string[],
        accountNote: "",
        accounts: { by: "group" as const, name: "一组" },
        boxIds: [] as string[],
        boxes: null,
        files: [],
        instances: [],
        pitIndexes: [] as number[],
        pitRange: [],
        poolId: "",
        proxies: null,
        proxyIds: [] as string[],
        language: "",
        proxyTag: null,
        region: "",
        repeats: [{ max: 5, min: 2, mode: "range" as const, stage: 1 }],
        texts: [],
      }
      const ranged = await createDispatchRepository(
        env.sql,
        cipher,
        () => draws[cursor++] ?? 0,
      ).create(
        env.first.groupId,
        env.first.userId,
        env.first.userId,
        { chainId: null, taskChainId },
        selection,
      )
      expect(ranged.kind).toBe("created")
      if (ranged.kind !== "created") return
      expect(ranged.name).toContain("养号 ×2–5")
      expect(cursor).toBe(2)
      const plan = await env.sql<
        {
          repeatPlan: { count?: number; max?: number; min?: number; mode: string; stage: number }[]
        }[]
      >`
      select repeat_plan as "repeatPlan" from operation_dispatch where id = ${ranged.id}::uuid`
      expect(plan[0]?.repeatPlan[1]).toEqual({ max: 5, min: 2, mode: "range", stage: 1 })
      expect(plan[0]?.repeatPlan[1]).not.toHaveProperty("count")
      const rows = await env.sql<{ count: number; identifier: string; parameters: unknown }[]>`
      select a.identifier, s.repeat_count as count, s.parameters
      from operation_dispatch_step s
      join operation_dispatch_item i on i.id = s.item_id
      join operation_account a on a.id = i.account_id
      where i.dispatch_id = ${ranged.id}::uuid and s.stage_position = 1
      order by a.identifier, s.repeat_index`
      const byAccount = new Map<string, { count: number; parameters: unknown }[]>()
      for (const row of rows) {
        const list = byAccount.get(row.identifier) ?? []
        list.push(row)
        byAccount.set(row.identifier, list)
      }
      expect(byAccount.get("user-a")?.map((row) => row.count)).toEqual([2, 2])
      expect(byAccount.get("user-b")?.map((row) => row.count)).toEqual([5, 5, 5, 5, 5])
      expect(
        new Set(byAccount.get("user-a")?.map((row) => JSON.stringify(row.parameters))).size,
      ).toBe(1)
      expect(
        new Set(byAccount.get("user-b")?.map((row) => JSON.stringify(row.parameters))).size,
      ).toBe(1)
      let calls = 0
      const collapsed = await createDispatchRepository(env.sql, cipher, () => {
        calls += 1
        return 0
      }).create(
        env.first.groupId,
        env.first.userId,
        env.first.userId,
        { chainId: null, taskChainId },
        {
          ...selection,
          repeats: [{ max: 2, min: 2, mode: "range", stage: 1 }],
        },
      )
      expect(collapsed.kind).toBe("created")
      if (collapsed.kind !== "created") return
      expect(calls).toBe(0)
      const collapsedPlan = await env.sql<{ repeatPlan: unknown }[]>`
      select repeat_plan as "repeatPlan" from operation_dispatch where id = ${collapsed.id}::uuid`
      expect(collapsedPlan[0]?.repeatPlan).toEqual([
        { count: 1, mode: "fixed", stage: 0 },
        { count: 2, mode: "fixed", stage: 1 },
      ])
      const collapsedCounts = await env.sql<{ count: number }[]>`
      select distinct s.repeat_count as count
      from operation_dispatch_step s
      join operation_dispatch_item i on i.id = s.item_id
      where i.dispatch_id = ${collapsed.id}::uuid and s.stage_position = 1`
      expect(collapsedCounts).toEqual([{ count: 2 }])
    },
    60000,
  )

  pgTest(
    "clears a started chain after its execution tasks",
    async () => {
      const env = await setup()
      const chain = async (name: string) => {
        const response = await env.send("/api/behavior-chains", {
          name,
          origin: "rpa",
          steps: [step("DumpNodeXmlEx")],
        })
        expect(response.status).toBe(201)
        return ((await response.json()) as { id: string }).id
      }
      const login = await chain("登录")
      const warm = await chain("养号")
      const created = await env.send("/api/task-chains", {
        name: "早班",
        stages: [{ chainId: login }, { chainId: warm }],
      })
      expect(created.status).toBe(201)
      const taskChainId = ((await created.json()) as { id: string }).id
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
      await env.sql`
      insert into execution_task (
        group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters
      ) values (
        ${env.first.groupId}::uuid, ${env.first.userId}::uuid, ${env.device.id}::uuid,
        'studio', 'studio', 'JumpNodes', 'box-agent', '[]'::jsonb
      )`
      const cleared = await env.send(`/api/groups/${env.first.groupId}/dispatch-records/clear`, {
        deviceIds: [env.device.id],
      })
      expect(cleared.status).toBe(200)
      expect(await cleared.json()).toEqual({ removed: 3 })
      expect(
        await env.sql`select id from execution_task where group_id = ${env.first.groupId}::uuid`,
      ).toHaveLength(0)
      expect(
        await env.sql`select id from operation_dispatch_item where group_id = ${env.first.groupId}::uuid`,
      ).toHaveLength(0)
      expect(
        await env.sql`select id from operation_dispatch where id = ${dispatchId}::uuid`,
      ).toHaveLength(0)
    },
    60000,
  )

  pgTest(
    "updates a saved behavior chain in place",
    async () => {
      const env = await setup()
      const created = await env.send("/api/behavior-chains", {
        name: "安装",
        origin: "rpa",
        steps: [step("DumpNodeXmlEx")],
      })
      expect(created.status).toBe(201)
      const id = ((await created.json()) as { id: string }).id
      const beforeUpdate = await env.sql`select id from behavior_chain`
      const updated = await env.send(
        `/api/behavior-chains/${id}`,
        {
          anchor: null,
          name: "安装TK",
          steps: [step("OpenApp", { pkg: "com.zhiliaoapp.musically" })],
        },
        "user",
        "PUT",
      )
      expect(updated.status).toBe(200)
      const body = (await updated.json()) as {
        id: string
        name: string
        origin: string
        steps: { api: string; params: Record<string, string> }[]
      }
      expect(body).toMatchObject({
        id,
        name: "安装TK",
        origin: "rpa",
        steps: [{ api: "OpenApp", params: { pkg: "com.zhiliaoapp.musically" } }],
      })
      const listed = await env.app.request("/api/behavior-chains", {
        headers: { cookie: env.cookie },
      })
      const rows = (await listed.json()) as { id: string; name: string }[]
      expect(rows.find((row) => row.id === id)?.name).toBe("安装TK")
      expect(await env.sql`select id from behavior_chain`).toHaveLength(beforeUpdate.length)
      const foreign = await env.send(
        `/api/behavior-chains/${id}`,
        { anchor: null, name: "别人", steps: [step("DumpNodeXmlEx")] },
        "other",
        "PUT",
      )
      expect(foreign.status).toBe(404)
      const duplicate = await env.send("/api/behavior-chains", {
        anchor: null,
        name: "安装TK",
        origin: "rpa",
        steps: [],
      })
      expect(duplicate.status).toBe(409)
      expect(await duplicate.json()).toEqual({ error: "chain_name_taken" })
      const createdEmpty = await env.send("/api/behavior-chains", {
        anchor: null,
        name: "空链",
        origin: "rpa",
        steps: [],
      })
      expect(createdEmpty.status).toBe(201)
      const empty = (await createdEmpty.json()) as { id: string; name: string; steps: unknown[] }
      expect(empty).toMatchObject({ name: "空链", steps: [] })
      const renameClash = await env.send(
        `/api/behavior-chains/${empty.id}`,
        { anchor: null, name: "安装TK", steps: [step("DumpNodeXmlEx")] },
        "user",
        "PUT",
      )
      expect(renameClash.status).toBe(409)
      expect(await env.sql`select id from behavior_chain where name = '空链'`).toHaveLength(1)
    },
    60000,
  )
})
