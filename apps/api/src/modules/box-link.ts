import { createHash, randomUUID } from "node:crypto"

import type { Hono } from "hono"
import postgres, { type Sql } from "postgres"

import { guardCatalog, normalizeGuards, xmlHasText, type GuardCode } from "./guards"

const guardLabel = (code: string): string =>
  code === "ad" || code === "transcode" ? guardCatalog[code].label : code
import { skillCatalog, type SkillSpec } from "./skills"
import { agentSkillStep, isSharedVideoSkill, sharedVideoCommand } from "./video-share"

const unassignedGroup = "00000000-0000-4000-8000-000000000001"
const noBatch = new Set(["CreateAndroid", "BoxStart", "BoxStop", "BoxRestart", "BoxDelete", "RandomizeDevice", "SetProxy", "IndependentV5S5", "TestIndependentProxy", "Uninstall", "ClearData", "FileDelete", "CreateAndroidContainerV2", "ResetAndroidContainer", "ResetAndroidContainerV2", "RenameAndroidContainer", "SwitchAndroidImage", "SwitchAndroidImageV2", "SwitchAndroidPhoneModel", "SetMacvlan", "PullAndroidImage", "RemoveAndroidImage", "RemoveAndroidImageTar", "ExportAndroidImage", "ImportAndroidImage", "ExportAndroidContainer", "ImportAndroidContainer", "AndroidPruneAllImages", "RemovePhoneModelBackup"])

type Skill = SkillSpec

const skills: readonly Skill[] = skillCatalog

const skillByCode = new Map(skills.map((item) => [item.code, item]))

type FrameHit = { readonly at: number; readonly bytes: Uint8Array }
const frames = new Map<string, FrameHit>()
const waiters = new Map<string, Array<() => void>>()

const wake = (deviceId: string): void => {
  const list = waiters.get(deviceId) ?? []
  waiters.delete(deviceId)
  for (const fn of list) fn()
}

const stripNull = (value: unknown): unknown => {
  if (typeof value === "string") return value.replaceAll("\u0000", "")
  if (Array.isArray(value)) return value.map(stripNull)
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = stripNull(item)
    return out
  }
  return value
}

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex")

const bearer = (header: string | undefined): string => {
  const value = header ?? ""
  return value.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : ""
}

const parseWait = (raw: string | undefined): number => {
  if (raw === undefined || raw === "") return 25_000
  const matched = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(raw.trim())
  if (matched === null) return 25_000
  const amount = Number(matched[1])
  const unit = matched[2] ?? "s"
  const ms = unit === "ms" ? amount : unit === "m" ? amount * 60_000 : amount * 1000
  return Math.min(Math.max(ms, 0), 25_000)
}

type AgentDevice = { readonly deviceId: string; readonly externalId: string; readonly groupId: string; readonly host: string }

const agentDevice = async (sql: Sql, token: string, boxId: string): Promise<AgentDevice | null> => {
  const rows = await sql<AgentDevice[]>`
    select d.id as "deviceId", d.external_id as "externalId", d.group_id as "groupId", d.host
    from device_agent a
    join device d on d.id = a.device_id
    where a.token_hash = ${hashToken(token)} and d.external_id = ${boxId} and d.enabled = true
  `
  return rows[0] ?? null
}

const sessionUser = async (sql: Sql, token: string): Promise<string | null> => {
  const rows = await sql<{ id: string }[]>`
    select u.id
    from app_session s
    join app_user u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)}
      and s.revoked_at is null
      and s.expires_at > now()
      and u.enabled = true
  `
  return rows[0]?.id ?? null
}

const userFromRequest = async (sql: Sql, request: Request): Promise<string | null> => {
  const header = request.headers.get("cookie") ?? ""
  const matched = /(?:^|;\s*)tk_mg_session=([^;]+)/.exec(header)
  const token = matched === null ? "" : decodeURIComponent(matched[1] ?? "")
  if (token === "") return null
  return sessionUser(sql, token)
}

const administratorFor = async (sql: Sql, userId: string): Promise<string | null> => {
  const rows = await sql<{ id: string }[]>`
    select a.id
    from app_user a
    where a.enabled = true
      and a.role = 'administrator'
      and a.provisioned_by = 'init-tool'
      and (
        a.id = ${userId}::uuid
        or exists (
          select 1 from user_group mine
          join user_group theirs on theirs.group_id = mine.group_id
          where mine.user_id = ${userId}::uuid and theirs.user_id = a.id
        )
      )
    order by (a.id = ${userId}::uuid) desc
    limit 1
  `
  return rows[0]?.id ?? null
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "23505"

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const sharedGroup = async (sql: Sql, userId: string, administratorId: string): Promise<string | null> => {
  const rows = await sql<{ id: string }[]>`
    select mine.group_id::text as id
    from user_group mine
    join user_group admin_group
      on admin_group.group_id = mine.group_id
     and admin_group.user_id = ${administratorId}::uuid
    where mine.user_id = ${userId}::uuid
    limit 1
  `
  return rows[0]?.id ?? null
}

type ChainParameter = { readonly input: Record<string, string>; readonly skill: string }
type ChainScope = Record<string, "external" | "internal">

type ChainRow = {
  readonly delays: number[]
  readonly guards: GuardCode[][]
  readonly id: string
  readonly lastTestedAt: Date | null
  readonly name: string
  readonly origin: string
  readonly parameters: ChainParameter[]
  readonly paramScopes: ChainScope[]
  readonly updatedAt: Date
}

const chainView = (row: ChainRow) => ({
  id: row.id,
  lastTestedAt: row.lastTestedAt,
  name: row.name,
  origin: row.origin,
  steps: (row.parameters ?? []).map((item, index) => ({
    api: item.skill,
    delayMs: row.delays?.[index] ?? 0,
    id: index,
    guards: row.guards?.[index] ?? [],
    params: item.input ?? {},
    scopes: row.paramScopes?.[index] ?? {},
  })),
  updatedAt: row.updatedAt,
})

const readDelay = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return 0
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 60000) return null
  return parsed
}

const readChainSteps = (
  raw: unknown,
): { delays: number[]; guards: GuardCode[][]; parameters: ChainParameter[]; paramScopes: ChainScope[] } | null => {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) return null
  const parameters: ChainParameter[] = []
  const paramScopes: ChainScope[] = []
  const guards: GuardCode[][] = []
  const delays: number[] = []
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null
    const step = item as { api?: unknown; delayMs?: unknown; guards?: unknown; params?: unknown; scopes?: unknown }
    const stepGuards = normalizeGuards(step.guards)
    const delayMs = readDelay(step.delayMs)
    if (stepGuards === null || delayMs === null) return null
    const skill = typeof step.api === "string" ? step.api : ""
    if (!skillByCode.has(skill)) return null
    if (step.params === null || typeof step.params !== "object" || Array.isArray(step.params)) return null
    if (step.scopes !== undefined && (step.scopes === null || typeof step.scopes !== "object" || Array.isArray(step.scopes))) {
      return null
    }
    const input: Record<string, string> = {}
    for (const [key, value] of Object.entries(step.params as Record<string, unknown>)) {
      if (typeof value !== "string") return null
      input[key] = value
    }
    const scopes: ChainScope = {}
    const rawScopes = (step.scopes ?? {}) as Record<string, unknown>
    for (const key of Object.keys(input)) {
      scopes[key] = rawScopes[key] === "external" ? "external" : "internal"
    }
    parameters.push({ input, skill })
    paramScopes.push(scopes)
    guards.push(stepGuards)
    delays.push(delayMs)
  }
  return { delays, guards, parameters, paramScopes }
}

const ownedDevice = async (sql: Sql, userId: string, deviceId: string) => {
  const rows = await sql<{ deviceId: string; externalId: string; groupId: string; host: string; firmware: string; status: string; lastSeenAt: Date | null }[]>`
    select d.id as "deviceId", d.external_id as "externalId", d.group_id as "groupId", d.host,
      d.firmware, d.status, d.last_seen_at as "lastSeenAt"
    from device d
    where d.id = ${deviceId}::uuid
      and d.enabled = true
      and d.external_id is not null
      and d.group_id <> ${unassignedGroup}::uuid
      and d.assignee_user_id in (
        select a.id from app_user a
        where a.enabled = true
          and a.role = 'administrator'
          and a.provisioned_by = 'init-tool'
          and (
            a.id = ${userId}::uuid
            or exists (
              select 1 from user_group mine
              join user_group theirs on theirs.group_id = mine.group_id
              where mine.user_id = ${userId}::uuid and theirs.user_id = a.id
            )
          )
      )
  `
  return rows[0] ?? null
}

const writeLog = async (sql: Sql, groupId: string, deviceId: string | null, level: string, text: string, actorId?: string) => {
  await sql`
    insert into operation_log (group_id, actor_id, device_id, level, text)
    values (${groupId}, ${actorId && actorId.length > 0 ? actorId : null}, ${deviceId}, ${level}, ${text})
  `
}

type ClaimRow = {
  readonly afterMs: number
  readonly apiPort: number
  readonly externalId: string
  readonly groupId: string
  readonly guardCode: string | null
  readonly guards: GuardCode[]
  readonly host: string
  readonly indexNum: number | null
  readonly instanceId: string | null
  readonly kind: string
  readonly label: string | null
  readonly parameters: Record<string, string>
  readonly parentStepId: string | null
  readonly phase: string
  readonly role: string
  readonly rpaPort: number
  readonly sequence: number
  readonly stepId: string
  readonly taskId: string
}

const claimOnce = async (sql: Sql, device: AgentDevice): Promise<ClaimRow | null> => {
  try {
    return await sql.begin(async (tx) => {
      const rows = await tx<ClaimRow[]>`
        select t.id as "taskId", t.group_id as "groupId", s.id as "stepId", s.kind, s.sequence,
          s.parameters, s.after_ms as "afterMs", s.instance_id as "instanceId", s.guards, s.phase, s.role,
          s.guard_code as "guardCode", s.parent_step_id::text as "parentStepId",
          d.external_id as "externalId", d.host,
          di.instance_index as "indexNum", coalesce(di.api_port, 0) as "apiPort",
          coalesce(di.rpa_port, 0) as "rpaPort", di.label
        from execution_task t
        join execution_task_step s on s.task_id = t.id and s.group_id = t.group_id
        join device d on d.id = t.device_id
        left join device_instance di on di.id = s.instance_id
        where d.id = ${device.deviceId}::uuid
          and t.status in ('queued', 'dispatching', 'ood')
          and s.status = 'pending'
          and s.sequence = (
            select min(sequence) from execution_task_step
            where task_id = t.id and status = 'pending'
          )
          and not exists (
            select 1 from execution_task_device_lease l
            where l.device_id = t.device_id
              and l.released_at is null
              and l.expires_at > now()
              and l.instance_id is not distinct from s.instance_id
          )
        order by t.created_at
        for update of t skip locked
        limit 1
      `
      const row = rows[0]
      if (row === undefined) return null
      const lease = randomUUID()
      await tx`
        update execution_task_step set status = 'claimed', started_at = now() where id = ${row.stepId}::uuid
      `
      await tx`
        update execution_task
        set status = 'dispatching', started_at = coalesce(started_at, now()), updated_at = now()
        where id = ${row.taskId}::uuid
      `
      await tx`
        insert into execution_task_run (
          id, task_id, group_id, step_id, attempt, status, worker_id, claim_token, claim_expires_at, heartbeat_at
        ) values (
          ${randomUUID()}::uuid, ${row.taskId}::uuid, ${row.groupId}::uuid, ${row.stepId}::uuid,
          1, 'claimed', ${device.externalId}, ${lease}, now() + interval '45 seconds', now()
        )
      `
      await tx`
        insert into execution_task_device_lease (
          id, task_id, group_id, device_id, instance_id, lease_token, worker_id, expires_at, heartbeat_at
        ) values (
          ${randomUUID()}::uuid, ${row.taskId}::uuid, ${row.groupId}::uuid, ${device.deviceId}::uuid,
          ${row.instanceId}::uuid, ${lease}, ${device.externalId}, now() + interval '45 seconds', now()
        )
      `
      return row
    })
  } catch {
    return null
  }
}

const taskPointer = (row: ClaimRow) => ({
  bindings: {
    apiPort: row.apiPort,
    boxId: row.externalId,
    boxIp: row.host,
    indexNum: row.indexNum ?? 0,
    rpaPort: row.rpaPort,
  },
  checkpoint: { cursor: 0, step_id: row.stepId },
  guardCode: row.guardCode ?? "",
  guardLabel: row.role === "ood" ? guardLabel(row.guardCode ?? "") : "",
  guards: row.role === "ood" ? [] : (row.guards ?? []),
  parentStepId: row.parentStepId ?? "",
  phase: row.phase || "skill",
  role: row.role || "native",
  task_id: row.taskId,
  template: `${row.taskId}@1`,
  templateDoc: {
    id: row.taskId,
    pack: "1",
    scene: "box",
    steps: [{
      ...(row.afterMs > 0 ? { afterMs: row.afterMs } : {}),
      id: row.stepId,
      ...agentSkillStep(row.kind, row.parameters),
    }],
    version: "1",
  },
})

export const registerBoxLink = (app: Hono, sql: Sql, databaseUrl: string): void => {
  const listen = postgres(databaseUrl, { max: 1 })
  void listen.listen("agent_task", (payload) => wake(payload)).catch((error: unknown) => {
    console.error("agent_task listen failed", error)
  })

  app.post("/agent/register", async (context) => {
    const token = bearer(context.req.header("authorization"))
    const body = await context.req.json().catch(() => null) as { boxId?: string; version?: string } | null
    const boxId = body?.boxId ?? ""
    const device = token === "" || boxId === "" ? null : await agentDevice(sql, token, boxId)
    if (device === null) return context.body(null, 401)
    await sql`
      update device_agent set registered_at = now(), agent_version = ${body?.version ?? ""}
      where device_id = ${device.deviceId}::uuid
    `
    await sql`update device set status = 'online', last_seen_at = now(), updated_at = now() where id = ${device.deviceId}::uuid`
    return context.json({})
  })

  app.post("/agent/heartbeat", async (context) => {
    const token = bearer(context.req.header("authorization"))
    const body = await context.req.json().catch(() => null) as {
      box?: {
        disk?: string
        diskPct?: number
        firmware?: string
        memory?: string
        model?: string
        version?: string
      }
      boxId?: string
      fileBrowserUrl?: string
      slots?: ReadonlyArray<Record<string, unknown>>
    } | null
    const boxId = body?.boxId ?? ""
    const device = token === "" || boxId === "" ? null : await agentDevice(sql, token, boxId)
    if (device === null) return context.body(null, 401)
    const facts = body?.box ?? {}
    const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "")
    const diskPct = Number(facts.diskPct ?? 0)
    const reportedPct = Number.isFinite(diskPct) && diskPct > 0 ? Math.round(diskPct) : 0
    const fileBrowserUrl = text(body?.fileBrowserUrl)
    await sql`
      update device_agent set
        last_heartbeat_at = now(),
        file_browser_url = case when ${fileBrowserUrl} <> '' then ${fileBrowserUrl} else file_browser_url end
      where device_id = ${device.deviceId}::uuid
    `
    await sql`
      update device set
        status = 'online',
        last_seen_at = now(),
        updated_at = now(),
        model = case when ${text(facts.model)} <> '' then ${text(facts.model)} else model end,
        version = case when ${text(facts.version)} <> '' then ${text(facts.version)} else version end,
        firmware = case when ${text(facts.firmware)} <> '' then ${text(facts.firmware)} else firmware end,
        memory = case when ${text(facts.memory)} <> '' then ${text(facts.memory)} else memory end,
        disk = case when ${text(facts.disk)} <> '' then ${text(facts.disk)} else disk end,
        disk_pct = case when ${reportedPct} > 0 then ${reportedPct} else disk_pct end
      where id = ${device.deviceId}::uuid
    `
    await sql`
      update execution_task_device_lease
      set expires_at = now() + interval '45 seconds', heartbeat_at = now()
      where device_id = ${device.deviceId}::uuid and released_at is null and expires_at > now()
    `
    await sql`
      update execution_task_run
      set claim_expires_at = now() + interval '45 seconds', heartbeat_at = now()
      where finished_at is null and status in ('claimed', 'running') and claim_expires_at > now()
        and task_id in (select id from execution_task where device_id = ${device.deviceId}::uuid)
    `
    for (const slot of body?.slots ?? []) {
      const index = Number(slot.indexNum ?? 0)
      if (index < 1 || index > 5) continue
      const running = String(slot.status ?? "") === "running"
      await sql`
        insert into device_instance (id, device_id, instance_index, label, enabled, status, container_id, api_port, rpa_port, width, height)
        values (
          ${randomUUID()}::uuid, ${device.deviceId}::uuid, ${index}, ${String(slot.name ?? "")}, true,
          ${running ? "online" : "offline"}, ${String(slot.id ?? "")}, ${Number(slot.apiPort ?? 0)},
          ${Number(slot.rpaPort ?? 0)}, ${String(slot.width ?? "")}, ${String(slot.height ?? "")}
        )
        on conflict (device_id, instance_index) do update set
          label = case when excluded.label <> '' then excluded.label else device_instance.label end,
          enabled = true,
          status = excluded.status,
          container_id = case when excluded.container_id <> '' then excluded.container_id else device_instance.container_id end,
          api_port = case when excluded.api_port > 0 then excluded.api_port else device_instance.api_port end,
          rpa_port = case when excluded.rpa_port > 0 then excluded.rpa_port else device_instance.rpa_port end,
          width = case when excluded.width <> '' then excluded.width else device_instance.width end,
          height = case when excluded.height <> '' then excluded.height else device_instance.height end,
          updated_at = now()
      `
    }
    await sql`delete from device_watch where expires_at < now()`
    const watches = await sql<{ indexNum: number }[]>`
      select instance_index as "indexNum" from device_watch
      where device_id = ${device.deviceId}::uuid and expires_at > now()
    `
    const cancel = await sql<{ id: string }[]>`
      select id::text as id from execution_task
      where device_id = ${device.deviceId}::uuid and cancel_requested_at is not null
        and status in ('queued', 'dispatching', 'running', 'ood')
    `
    const held = await sql<{ heldStepId: string; taskId: string }[]>`
      select t.id::text as "taskId", s.id::text as "heldStepId"
      from execution_task t
      join execution_task_step s on s.task_id = t.id and s.status = 'held'
      where t.device_id = ${device.deviceId}::uuid and t.status = 'ood'
    `
    const ood = []
    for (const item of held) {
      const steps = await sql<{ id: string; input: Record<string, string>; skill: string }[]>`
        select id::text as id, kind as skill, parameters as input
        from execution_task_step
        where task_id = ${item.taskId}::uuid and role = 'ood' and status = 'pending'
        order by sequence
      `
      ood.push({ heldStepId: item.heldStepId, steps, taskId: item.taskId })
    }
    return context.json({
      cancel: cancel.map((item) => item.id),
      ood,
      watch: watches.map((item) => ({ boxIp: device.host, indexNum: item.indexNum })),
    })
  })

  app.post("/agent/tasks/claim", async (context) => {
    const token = bearer(context.req.header("authorization"))
    const boxId = context.req.query("boxId") ?? ""
    const device = token === "" || boxId === "" ? null : await agentDevice(sql, token, boxId)
    if (device === null) return context.body(null, 401)
    const first = await claimOnce(sql, device)
    if (first !== null) return context.json(taskPointer(first))
    const waitMs = parseWait(context.req.query("wait"))
    if (waitMs > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, waitMs)
        const list = waiters.get(device.deviceId) ?? []
        list.push(() => {
          clearTimeout(timer)
          resolve()
        })
        waiters.set(device.deviceId, list)
      })
      const second = await claimOnce(sql, device)
      if (second !== null) return context.json(taskPointer(second))
    }
    return context.body(null, 204)
  })

  app.post("/agent/tasks/:id/status", async (context) => {
    const token = bearer(context.req.header("authorization"))
    const taskId = context.req.param("id")
    const body = await context.req.json().catch(() => null) as { status?: string; error_code?: string; checkpoint?: { outputs?: Record<string, string>; step_id?: string } } | null
    const reportedStep = body?.checkpoint?.step_id ?? ""
    const rows = await sql<{
      deviceId: string
      externalId: string
      groupId: string
      kind: string
      parentStepId: string | null
      role: string
      stepId: string
    }[]>`
      select d.id as "deviceId", d.external_id as "externalId", t.group_id as "groupId", s.kind, s.id as "stepId",
        s.role, s.parent_step_id::text as "parentStepId"
      from execution_task t
      join device d on d.id = t.device_id
      join device_agent a on a.device_id = d.id
      join execution_task_step s on s.task_id = t.id and s.status in ('claimed', 'running')
      where t.id = ${taskId}::uuid and a.token_hash = ${hashToken(token)}
        and (${reportedStep} = '' or s.id::text = ${reportedStep})
      order by s.sequence
      limit 1
    `
    const row = rows[0]
    if (row === undefined) {
      if (reportedStep !== "") {
        const prior = await sql<{ status: string }[]>`
          select status from execution_task_step where task_id = ${taskId}::uuid and id::text = ${reportedStep}
        `
        if (prior[0]?.status === "succeeded" || prior[0]?.status === "failed" || prior[0]?.status === "cancelled") return context.json({})
      }
      return context.body(null, 404)
    }
    const status = body?.status ?? ""
    if (status === "succeeded" || status === "failed") {
      const stepStatus = status === "succeeded" ? "succeeded" : "failed"
      const outputs = stripNull(body?.checkpoint?.outputs ?? {}) as Record<string, string>
      const outcome = await sql.begin(async (tx) => {
        await tx`
          update execution_task_step
          set status = ${stepStatus}, finished_at = now(), result = ${tx.json(outputs)},
            error_code = ${body?.error_code ?? null}
          where id = ${row.stepId}::uuid
        `
        await tx`
          update execution_task_device_lease set released_at = now()
          where task_id = ${taskId}::uuid and released_at is null
        `
        await tx`
          update execution_task_run set status = ${stepStatus}, finished_at = now()
          where task_id = ${taskId}::uuid and finished_at is null
        `
        if (row.role === "ood" && row.parentStepId) {
          const parents = await tx<{ guardIndex: number; guards: GuardCode[] }[]>`
            select guards, guard_index as "guardIndex"
            from execution_task_step
            where id = ${row.parentStepId}::uuid and status = 'held'
            for update
          `
          const parent = parents[0]
          if (parent !== undefined) {
            const nextIndex = parent.guardIndex + 1
            if (nextIndex < parent.guards.length) {
              await tx`
                update execution_task_step
                set guard_index = ${nextIndex}, status = 'pending', phase = 'guard',
                  started_at = null, finished_at = null, result = null
                where id = ${row.parentStepId}::uuid
              `
            } else {
              await tx`
                update execution_task_step
                set guard_index = ${nextIndex}, status = 'succeeded', phase = 'guard', finished_at = now()
                where id = ${row.parentStepId}::uuid
              `
            }
          }
        }
        if (status === "failed") {
          await tx`
            update execution_task_step
            set status = 'cancelled', finished_at = now()
            where task_id = ${taskId}::uuid and status in ('pending', 'held')
          `
          await tx`
            update execution_task
            set status = 'failed', finished_at = now(), updated_at = now(), error_code = ${body?.error_code ?? null}
            where id = ${taskId}::uuid
          `
          return "failed"
        }
        const rest = await tx<{ n: number }[]>`
          select count(*)::int as n from execution_task_step
          where task_id = ${taskId}::uuid and status = 'pending'
        `
        if ((rest[0]?.n ?? 0) > 0) {
          await tx`
            update execution_task
            set status = 'queued', finished_at = null, updated_at = now(), error_code = null
            where id = ${taskId}::uuid
          `
          return "continue"
        }
        await tx`
          update execution_task
          set status = 'succeeded', finished_at = now(), updated_at = now(), error_code = null
          where id = ${taskId}::uuid
        `
        return "done"
      })
      await sql`select pg_notify('agent_task', ${row.deviceId})`
      wake(row.deviceId)
      const text = outcome === "continue"
        ? `${row.externalId} 步骤 ${row.kind} 完成，继续下一步`
        : `${row.externalId} ${outcome === "failed" ? "failed" : "succeeded"}`
      await writeLog(sql, row.groupId, row.deviceId, outcome === "failed" ? "error" : "ok", text)
      return context.json({})
    }
    await sql`
      update execution_task set status = 'running', updated_at = now() where id = ${taskId}::uuid and status in ('queued', 'dispatching', 'ood')
    `
    await sql`update execution_task_step set status = 'running' where id = ${row.stepId}::uuid and status = 'claimed'`
    return context.json({})
  })

  app.post("/agent/tasks/:id/guard", async (context) => {
    const token = bearer(context.req.header("authorization"))
    const taskId = context.req.param("id")
    const body = await context.req.json().catch(() => null) as { output?: unknown; stepId?: string } | null
    const stepId = body?.stepId ?? ""
    const reported = body !== null && Object.prototype.hasOwnProperty.call(body, "output")
    const output = typeof body?.output === "string" ? body.output.replaceAll("\u0000", "") : ""
    if (token === "" || stepId === "") return context.json({ error: "invalid_guard" }, 400)
    const rows = await sql<{
      deviceId: string
      externalId: string
      groupId: string
      guardIndex: number
      guards: GuardCode[]
      id: string
      instanceId: string | null
      sequence: number
      target: Record<string, unknown> | null
    }[]>`
      select s.id::text as id, s.group_id::text as "groupId", s.sequence, s.guards,
        s.guard_index as "guardIndex", s.instance_id::text as "instanceId", s.target,
        d.id::text as "deviceId", d.external_id as "externalId"
      from execution_task_step s
      join execution_task t on t.id = s.task_id and t.group_id = s.group_id
      join device d on d.id = t.device_id
      join device_agent a on a.device_id = d.id
      where t.id = ${taskId}::uuid and s.id = ${stepId}::uuid
        and a.token_hash = ${hashToken(token)}
        and s.role = 'native'
        and s.status in ('claimed', 'running', 'held')
    `
    const step = rows[0]
    if (step === undefined) return context.json({ error: "not_found" }, 404)
    const codes = step.guards ?? []
    if (step.guardIndex >= codes.length) return context.json({ action: "pass", pending: false })
    const code = codes[step.guardIndex]
    if (code !== "ad" && code !== "transcode") return context.json({ error: "invalid_guard" }, 400)
    const spec = guardCatalog[code]
    if (!reported) {
      return context.json({
        action: "probe",
        guard: code,
        input: spec.probe.input,
        label: spec.label,
        pending: true,
        skill: spec.probe.skill,
      })
    }
    if (!xmlHasText(output, spec.marker)) {
      const next = step.guardIndex + 1
      await sql`update execution_task_step set guard_index = ${next} where id = ${step.id}::uuid`
      return context.json({ action: "pass", guard: code, label: spec.label, pending: next < codes.length })
    }
    const existing = await sql<{ id: string }[]>`
      select id::text as id from execution_task_step
      where parent_step_id = ${step.id}::uuid and guard_code = ${code} and status = 'pending'
    `
    if (existing[0] !== undefined) {
      return context.json({ action: "ood", guard: code, insertedStepId: existing[0].id, label: spec.label, pending: true })
    }
    const insertedId = randomUUID()
    const input = { index: "0", text: spec.marker }
    await sql.begin(async (tx) => {
      await tx`update execution_task_step set sequence = sequence + 100000 where task_id = ${taskId}::uuid and sequence > ${step.sequence}`
      await tx`update execution_task_step set sequence = sequence - 99999 where task_id = ${taskId}::uuid and sequence > 100000`
      if (step.instanceId) {
        await tx`
          insert into execution_task_step (
            id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters, status,
            role, phase, guards, guard_code, guard_index, parent_step_id, instance_id
          ) values (
            ${insertedId}::uuid, ${taskId}::uuid, ${step.groupId}::uuid, ${step.sequence + 1},
            ${`${taskId}:ood:${insertedId}`}, ${insertedId}, 'ClickNode', ${tx.json(step.target ?? {})}, ${tx.json(input)}, 'pending',
            'ood', 'skill', ${tx.json([])}, ${code}, 0, ${step.id}::uuid, ${step.instanceId}::uuid
          )
        `
      } else {
        await tx`
          insert into execution_task_step (
            id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters, status,
            role, phase, guards, guard_code, guard_index, parent_step_id
          ) values (
            ${insertedId}::uuid, ${taskId}::uuid, ${step.groupId}::uuid, ${step.sequence + 1},
            ${`${taskId}:ood:${insertedId}`}, ${insertedId}, 'ClickNode', ${tx.json(step.target ?? {})}, ${tx.json(input)}, 'pending',
            'ood', 'skill', ${tx.json([])}, ${code}, 0, ${step.id}::uuid
          )
        `
      }
      await tx`update execution_task_step set status = 'held', phase = 'guard' where id = ${step.id}::uuid`
      await tx`update execution_task set status = 'ood', updated_at = now(), finished_at = null where id = ${taskId}::uuid`
      await tx`update execution_task_device_lease set released_at = now() where task_id = ${taskId}::uuid and released_at is null`
      await tx`
        update execution_task_run
        set status = 'cancelled', finished_at = now(), recovery_reason = 'ood'
        where task_id = ${taskId}::uuid and finished_at is null
      `
    })
    await writeLog(sql, step.groupId, step.deviceId, "info", `守护 ${spec.label} 发现 ${spec.marker}，插入点击`)
    await sql`select pg_notify('agent_task', ${step.deviceId})`
    wake(step.deviceId)
    return context.json({ action: "ood", guard: code, insertedStepId: insertedId, label: spec.label, pending: true })
  })

  app.post("/agent/events", async (context) => {
    const token = bearer(context.req.header("authorization"))
    const body = await context.req.json().catch(() => null) as ReadonlyArray<{ box_id?: string; event?: string; msg?: string; task_id?: string }> | null
    if (!Array.isArray(body) || token === "") return context.body(null, 401)
    for (const event of body) {
      const device = await agentDevice(sql, token, event.box_id ?? "")
      if (device === null) return context.body(null, 401)
      const name = event.event ?? ""
      if (name === "step.ok" || name === "step.fail" || name === "task.succeeded" || name === "task.failed") {
        await writeLog(sql, device.groupId, device.deviceId, name.endsWith("ok") || name.endsWith("succeeded") ? "ok" : "error", String(stripNull(event.msg || name)))
      }
    }
    return context.json({})
  })

  app.post("/agent/frames", async (context) => {
    const token = bearer(context.req.header("authorization"))
    const boxId = context.req.query("boxId") ?? ""
    const index = Number(context.req.query("indexNum") ?? "0")
    const device = token === "" || boxId === "" ? null : await agentDevice(sql, token, boxId)
    if (device === null) return context.body(null, 401)
    const watching = await sql<{ n: number }[]>`
      select count(*)::int as n from device_watch
      where device_id = ${device.deviceId}::uuid and instance_index = ${index} and expires_at > now()
    `
    if ((watching[0]?.n ?? 0) === 0) return context.body(null, 204)
    const bytes = new Uint8Array(await context.req.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024) return context.body(null, 204)
    frames.set(`${device.deviceId}#${index}`, { at: Date.now(), bytes })
    return context.body(null, 204)
  })

  app.get("/agent/templates/:id/:ver", (context) => context.json({ id: context.req.param("id"), pack: "1", scene: "box", steps: [], version: context.req.param("ver") }))
  app.get("/agent/packs/:ver", (context) => context.json({ version: context.req.param("ver") }))

  app.get("/api/skills", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    return context.json(skills)
  })

  app.get("/api/operation-logs", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const after = Number(context.req.query("after") ?? "0")
    const rows = await sql<{ at: Date; id: string; level: string; text: string }[]>`
      select id::text as id, level, text, created_at as at
      from operation_log
      where id > ${Number.isFinite(after) ? after : 0}
        and group_id in (select group_id from user_group where user_id = ${user}::uuid)
      order by id
      limit 200
    `
    return context.json({ items: rows })
  })

  app.get("/api/devices", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const rows = await sql`
      select d.id, d.external_id as "externalId", d.host, d.name, d.model, d.version, d.firmware,
        d.memory, d.disk, d.disk_pct as "diskPct", d.enabled, d.status,
        d.last_seen_at as "lastSeenAt", d.updated_at as "updatedAt", d.group_id as "groupId",
        r.id as "remarkId", r.name as "remarkName", g.id as "boxGroupId", g.name as "boxGroupName"
      from device d
      left join box_remark r on r.id = d.remark_id
      left join box_group g on g.id = d.box_group_id
      where d.enabled = true and d.external_id is not null
        and d.group_id <> ${unassignedGroup}::uuid
        and d.assignee_user_id in (
          select a.id from app_user a
          where a.enabled = true
            and a.role = 'administrator'
            and a.provisioned_by = 'init-tool'
            and (
              a.id = ${user}::uuid
              or exists (
                select 1 from user_group mine
                join user_group theirs on theirs.group_id = mine.group_id
                where mine.user_id = ${user}::uuid and theirs.user_id = a.id
              )
            )
        )
      order by d.host
    `
    return context.json(rows)
  })

  app.get("/api/box-labels", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    if (administratorId === null) return context.json({ administratorId: null, groups: [], remarks: [] })
    const remarks = await sql`
      select id, administrator_id as "administratorId", name from box_remark
      where administrator_id = ${administratorId}::uuid order by name
    `
    const groups = await sql`
      select id, administrator_id as "administratorId", name from box_group
      where administrator_id = ${administratorId}::uuid order by name
    `
    return context.json({ administratorId, groups, remarks })
  })

  app.post("/api/box-remarks", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const body = await context.req.json().catch(() => null) as { name?: string } | null
    const name = body?.name?.trim() ?? ""
    if (administratorId === null || name === "" || name.length > 40) return context.json({ error: "invalid_label" }, 400)
    try {
      const rows = await sql`
        insert into box_remark (administrator_id, name) values (${administratorId}::uuid, ${name})
        returning id, administrator_id as "administratorId", name
      `
      return context.json(rows[0], 201)
    } catch (error) {
      if (isUniqueViolation(error)) return context.json({ error: "duplicate_label" }, 409)
      throw error
    }
  })

  app.delete("/api/box-remarks/:id", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    if (administratorId === null) return context.json({ error: "not_found" }, 404)
    const removed = await sql`
      delete from box_remark where id = ${context.req.param("id")}::uuid and administrator_id = ${administratorId}::uuid
      returning id
    `
    if (removed.length === 0) return context.json({ error: "not_found" }, 404)
    return context.body(null, 204)
  })

  app.post("/api/box-groups", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const body = await context.req.json().catch(() => null) as { name?: string } | null
    const name = body?.name?.trim() ?? ""
    if (administratorId === null || name === "" || name.length > 40) return context.json({ error: "invalid_label" }, 400)
    try {
      const rows = await sql`
        insert into box_group (administrator_id, name) values (${administratorId}::uuid, ${name})
        returning id, administrator_id as "administratorId", name
      `
      return context.json(rows[0], 201)
    } catch (error) {
      if (isUniqueViolation(error)) return context.json({ error: "duplicate_label" }, 409)
      throw error
    }
  })

  app.delete("/api/box-groups/:id", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    if (administratorId === null) return context.json({ error: "not_found" }, 404)
    const removed = await sql`
      delete from box_group where id = ${context.req.param("id")}::uuid and administrator_id = ${administratorId}::uuid
      returning id
    `
    if (removed.length === 0) return context.json({ error: "not_found" }, 404)
    return context.body(null, 204)
  })

  app.post("/api/devices/labels", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const body = await context.req.json().catch(() => null) as {
      boxGroupId?: string | null
      deviceIds?: string[]
      remarkId?: string | null
    } | null
    const deviceIds = body?.deviceIds ?? []
    if (administratorId === null || deviceIds.length === 0 || body === null) return context.json({ error: "invalid_label" }, 400)
    const setsRemark = Object.hasOwn(body, "remarkId")
    const setsGroup = Object.hasOwn(body, "boxGroupId")
    if (setsRemark && body.remarkId !== null && body.remarkId !== undefined) {
      const found = await sql`select id from box_remark where id = ${body.remarkId}::uuid and administrator_id = ${administratorId}::uuid`
      if (found.length === 0) return context.json({ error: "not_found" }, 404)
    }
    if (setsGroup && body.boxGroupId !== null && body.boxGroupId !== undefined) {
      const found = await sql`select id from box_group where id = ${body.boxGroupId}::uuid and administrator_id = ${administratorId}::uuid`
      if (found.length === 0) return context.json({ error: "not_found" }, 404)
    }
    const owned = await sql<{ id: string }[]>`
      select id from device
      where id = any(${deviceIds}::uuid[]) and assignee_user_id = ${administratorId}::uuid and external_id is not null
    `
    if (owned.length !== deviceIds.length) return context.json({ error: "not_found" }, 404)
    if (setsRemark) {
      await sql`
        update device set remark_id = ${body.remarkId ?? null}::uuid, updated_at = now()
        where id = any(${deviceIds}::uuid[])
      `
    }
    if (setsGroup) {
      await sql`
        update device set box_group_id = ${body.boxGroupId ?? null}::uuid, updated_at = now()
        where id = any(${deviceIds}::uuid[])
      `
    }
    return context.json({ ok: true })
  })

  app.get("/api/devices/:deviceId/slots", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    const device = user === null ? null : await ownedDevice(sql, user, context.req.param("deviceId"))
    if (device === null) return context.json({ error: "not_found" }, 404)
    const rows = await sql`
      select di.instance_index as index, di.label, di.status, di.width, di.height, di.api_port as "apiPort", di.rpa_port as "rpaPort",
        d.host, coalesce(da.file_browser_url, '') as "fileBrowserUrl",
        exists (
          select 1 from execution_task_device_lease l
          where l.instance_id = di.id and l.released_at is null and l.expires_at > now()
        ) as busy
      from device_instance di
      join device d on d.id = di.device_id
      left join device_agent da on da.device_id = d.id
      where di.device_id = ${device.deviceId}::uuid
      order by di.instance_index
    `
    return context.json(rows)
  })

  app.post("/api/devices/:deviceId/watch", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    const device = user === null ? null : await ownedDevice(sql, user, context.req.param("deviceId"))
    if (device === null || user === null) return context.json({ error: "not_found" }, 404)
    const body = await context.req.json().catch(() => null) as { indexNums?: number[] } | null
    for (const index of body?.indexNums ?? []) {
      if (index < 1 || index > 5) continue
      await sql`
        insert into device_watch (device_id, instance_index, user_id, expires_at)
        values (${device.deviceId}::uuid, ${index}, ${user}::uuid, now() + interval '15 seconds')
        on conflict (device_id, instance_index, user_id) do update set expires_at = excluded.expires_at
      `
    }
    return context.json({ ok: true })
  })

  app.get("/api/frames", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    const deviceId = context.req.query("deviceId") ?? ""
    const index = Number(context.req.query("index") ?? "0")
    const device = user === null ? null : await ownedDevice(sql, user, deviceId)
    if (device === null || user === null) return context.json({ error: "not_found" }, 404)
    const watching = await sql<{ n: number }[]>`
      select count(*)::int as n from device_watch
      where device_id = ${device.deviceId}::uuid and instance_index = ${index}
        and user_id = ${user}::uuid and expires_at > now()
    `
    const hit = frames.get(`${device.deviceId}#${index}`)
    if ((watching[0]?.n ?? 0) === 0 || hit === undefined || Date.now() - hit.at > 15_000) return context.body(null, 204)
    return new Response(hit.bytes, { headers: { "content-type": "image/jpeg" } })
  })

  app.post("/api/tasks", async (context) => {
    let debug: unknown = null
    try {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const key = context.req.header("idempotency-key") ?? ""
    if (key === "") return context.json({ error: "idempotency_key_required" }, 400)
    const rawBody = await context.req.text()
    const body = JSON.parse(rawBody) as { deviceId?: string; indexNum?: number; steps?: ReadonlyArray<{ afterMs?: unknown; guards?: unknown; input?: Record<string, string>; skill?: string }> }
    if (!body.deviceId) return context.json({ rawBody }, 400)
    const device = await ownedDevice(sql, user, body?.deviceId ?? "")
    if (device === null) return context.json({ error: "not_found" }, 404)
    if (!device.groupId || !device.deviceId) return context.json({ device, keys: Object.keys(device) }, 500)
    const steps = body?.steps ?? []
    if (steps.length === 0) return context.json({ error: "steps_required" }, 400)
    const guards = steps.map((step) => normalizeGuards(step.guards))
    const delays = steps.map((step) => readDelay(step.afterMs))
    if (guards.some((item) => item === null) || delays.some((item) => item === null)) return context.json({ error: "skill_rejected" }, 400)
    if (steps.some((step) => !skillByCode.has(step.skill ?? "") || (noBatch.has(step.skill ?? "") && steps.length > 1))) {
      return context.json({ error: "skill_rejected" }, 400)
    }
    if (steps.some((step) => isSharedVideoSkill(step.skill ?? "") && sharedVideoCommand(step.skill ?? "", step.input ?? {}) === null)) {
      return context.json({ error: "video_path_rejected" }, 400)
    }
    const parameters = steps.map((step) => ({ input: step.input ?? {}, skill: step.skill ?? "" }))
    const existing = await sql<{ id: string; status: string }[]>`
      select id::text as id, status from execution_task
      where group_id = ${device.groupId}::uuid and idempotency_key = ${key}
    `
    if (existing[0] !== undefined) return context.json({ status: existing[0].status, taskId: existing[0].id })
    const taskId = randomUUID()
    const indexNum = Number(body?.indexNum ?? 0)
    const instance = indexNum < 1 ? [] : await sql<{ id: string }[]>`
      select id::text as id from device_instance
      where device_id = ${device.deviceId} and instance_index = ${indexNum}
    `
    const debugInfo = { deviceId: device.deviceId, groupId: device.groupId, instance: instance[0]?.id ?? null, user }
    debug = debugInfo
    await sql.begin(async (tx) => {
      await tx`
        insert into execution_task (
          id, group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters, status
        ) values (
          ${taskId}::uuid, ${device.groupId}::uuid, ${user}::uuid, ${device.deviceId}::uuid, ${key}, ${key},
          ${steps[0]?.skill ?? "task"}, 'box-agent', ${tx.json(parameters)}, 'queued'
        )
      `
      const instanceId = instance[0]?.id
      for (const [sequence, step] of steps.entries()) {
        if (instanceId === undefined) {
          await tx`
            insert into execution_task_step (
              id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters, status, guards, after_ms
            ) values (
              ${randomUUID()}, ${taskId}, ${device.groupId}, ${sequence}, ${`${key}:${sequence}`}, ${key},
              ${step.skill ?? ""}, ${tx.json({ indexNum })}, ${tx.json(step.input ?? {})}, 'pending', ${tx.json(guards[sequence] ?? [])}, ${delays[sequence] ?? 0}
            )
          `
        } else {
          await tx`
            insert into execution_task_step (
              id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters, status, instance_id, guards, after_ms
            ) values (
              ${randomUUID()}, ${taskId}, ${device.groupId}, ${sequence}, ${`${key}:${sequence}`}, ${key},
              ${step.skill ?? ""}, ${tx.json({ indexNum })}, ${tx.json(step.input ?? {})}, 'pending', ${instanceId}, ${tx.json(guards[sequence] ?? [])}, ${delays[sequence] ?? 0}
            )
          `
        }
      }
      await tx`select pg_notify('agent_task', ${device.deviceId})`
    })
    await writeLog(sql, device.groupId, device.deviceId, "info", `已下发 ${steps.map((step) => step.skill).join(",")}`, user)
    wake(device.deviceId)
    return context.json({ status: "queued", taskId }, 201)
    } catch (error) {
      return context.json({ debug, error: error instanceof Error ? error.message : "failed" }, 500)
    }
  })

  app.get("/api/tasks/:taskId", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const taskId = context.req.param("taskId")
    const tasks = await sql<{ errorCode: string | null; name: string; status: string }[]>`
      select t.name, t.status, t.error_code as "errorCode"
      from execution_task t
      where t.id = ${taskId}::uuid
        and t.group_id in (select group_id from user_group where user_id = ${user}::uuid)
    `
    const task = tasks[0]
    if (task === undefined) return context.json({ error: "not_found" }, 404)
    const steps = await sql<{
      errorCode: string | null
      kind: string
      result: Record<string, string> | null
      sequence: number
      status: string
    }[]>`
      select sequence, kind, status, result, error_code as "errorCode"
      from execution_task_step
      where task_id = ${taskId}::uuid
      order by sequence
    `
    return context.json({ ...task, steps })
  })

  app.get("/api/behavior-chains", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    if (administratorId === null) return context.json([])
    const rows = await sql<ChainRow[]>`
      select id::text as id, name, origin, parameters, param_scopes as "paramScopes", guards, delays,
        last_tested_at as "lastTestedAt", updated_at as "updatedAt"
      from behavior_chain
      where administrator_id = ${administratorId}::uuid
      order by updated_at desc
    `
    return context.json(rows.map(chainView))
  })

  app.post("/api/behavior-chains", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const groupId = administratorId === null ? null : await sharedGroup(sql, user, administratorId)
    if (administratorId === null || groupId === null) return context.json({ error: "not_found" }, 404)
    let body: { name?: unknown; origin?: unknown; steps?: unknown }
    try {
      body = await context.req.json()
    } catch {
      return context.json({ error: "invalid_chain" }, 400)
    }
    const name = typeof body.name === "string" ? body.name.trim() : ""
    const origin = body.origin === "ai" ? "ai" : body.origin === "rpa" ? "rpa" : ""
    const packed = readChainSteps(body.steps)
    if (name.length === 0 || name.length > 80 || origin === "" || packed === null) {
      return context.json({ error: "invalid_chain" }, 400)
    }
    const rows = await sql<ChainRow[]>`
      insert into behavior_chain (
        group_id, administrator_id, created_by, name, origin, executor_key, parameters, param_scopes, guards, delays
      ) values (
        ${groupId}::uuid, ${administratorId}::uuid, ${user}::uuid, ${name}, ${origin}, 'box-agent',
        ${sql.json(packed.parameters)}, ${sql.json(packed.paramScopes)}, ${sql.json(packed.guards)}, ${sql.json(packed.delays)}
      )
      returning id::text as id, name, origin, parameters, param_scopes as "paramScopes", guards, delays,
        last_tested_at as "lastTestedAt", updated_at as "updatedAt"
    `
    const row = rows[0]
    if (row === undefined) return context.json({ error: "invalid_chain" }, 400)
    return context.json(chainView(row), 201)
  })

  app.delete("/api/behavior-chains/:id", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const id = context.req.param("id")
    if (administratorId === null || !isUuid(id)) return context.json({ error: "not_found" }, 404)
    const rows = await sql<{ id: string }[]>`
      delete from behavior_chain
      where id = ${id}::uuid and administrator_id = ${administratorId}::uuid
      returning id::text as id
    `
    return rows[0] === undefined ? context.json({ error: "not_found" }, 404) : context.json({ ok: true })
  })

  app.post("/api/behavior-chains/:id/tested", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const id = context.req.param("id")
    if (administratorId === null || !isUuid(id)) return context.json({ error: "not_found" }, 404)
    const rows = await sql<{ id: string }[]>`
      update behavior_chain
      set last_tested_at = now(), updated_at = now()
      where id = ${id}::uuid and administrator_id = ${administratorId}::uuid
      returning id::text as id
    `
    return rows[0] === undefined ? context.json({ error: "not_found" }, 404) : context.json({ ok: true })
  })
}
