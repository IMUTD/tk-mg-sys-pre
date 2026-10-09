import { createHash, randomUUID } from "node:crypto"

import type { Hono } from "hono"
import postgres, { type Sql, type TransactionSql } from "postgres"
import { z } from "zod"

import { canDeletePage, canViewPage } from "../lib/authorization"
import { PageKey } from "../lib/pages"
import type { AuditRepository } from "./audit/service"
import { writeAuditEvent } from "./audit/service"
import type { AuthService } from "./auth/service"
import {
  EnqueueSchema,
  EventsSchema,
  fingerprint,
  GuardSchema,
  HeartbeatSchema,
  LabelsSchema,
  RegisterSchema,
  StatusSchema,
  WatchSchema,
} from "./box-contract"
import {
  administratorFor,
  businessGroupInUse,
  lockBusinessLabel,
  registerBusinessLabels,
} from "./business-labels"
import { type GuardCode, guardCatalog, normalizeGuards, xmlHasText } from "./guards"

const guardLabel = (code: string): string =>
  code === "ad" || code === "transcode" ? guardCatalog[code].label : code
import { type SkillSpec, skillCatalog } from "./skills"
import { agentSkillStep, isSharedVideoSkill, sharedVideoCommand } from "./video-share"

const unassignedGroup = "00000000-0000-4000-8000-000000000001"
const noBatch = new Set([
  "CreateAndroid",
  "BoxStart",
  "BoxStop",
  "BoxRestart",
  "BoxDelete",
  "RandomizeDevice",
  "SetProxy",
  "IndependentV5S5",
  "TestIndependentProxy",
  "Uninstall",
  "ClearData",
  "FileDelete",
  "CreateAndroidContainerV2",
  "ResetAndroidContainer",
  "ResetAndroidContainerV2",
  "RenameAndroidContainer",
  "SwitchAndroidImage",
  "SwitchAndroidImageV2",
  "SwitchAndroidPhoneModel",
  "SetMacvlan",
  "PullAndroidImage",
  "RemoveAndroidImage",
  "RemoveAndroidImageTar",
  "ExportAndroidImage",
  "ImportAndroidImage",
  "ExportAndroidContainer",
  "ImportAndroidContainer",
  "AndroidPruneAllImages",
  "RemovePhoneModelBackup",
])

type Skill = SkillSpec

const skills: readonly Skill[] = skillCatalog

const skillByCode = new Map(skills.map((item) => [item.code, item]))

type FrameHit = { readonly at: number; readonly bytes: Uint8Array; readonly groupId: string }
type Query = Sql | TransactionSql

export const recoverBoxTasks = async (sql: Sql): Promise<void> => {
  await sql.begin(async (tx) => {
    const tasks = await tx<{ id: string }[]>`
      select t.id from execution_task t where t.executor_key = 'box-agent'
        and t.status in ('queued','dispatching','running','ood')
        and exists (select 1 from execution_task_run r where r.task_id = t.id
          and r.status in ('claimed','running') and r.claim_expires_at <= now())
      for update of t skip locked
    `
    for (const task of tasks) {
      await tx`update execution_task set status = 'needs_reconciliation',
        terminal_reason = 'box_agent_outcome_unknown', updated_at = now() where id = ${task.id}`
      await tx`update execution_task_run set status = 'recovered', recovery_reason = 'outcome_unknown',
        finished_at = now() where task_id = ${task.id} and status in ('claimed','running')`
    }
    await tx`update execution_task_device_lease l set released_at = now(), recovery_reason = 'terminal_confirmed'
      where l.released_at is null and exists (select 1 from execution_task t
        where t.id = l.task_id and t.executor_key = 'box-agent'
          and t.status in ('succeeded','failed','cancelled','timed_out'))`
  })
}
const stripNull = (value: unknown): unknown => {
  if (typeof value === "string") return value.replaceAll("\u0000", "")
  if (Array.isArray(value)) return value.map(stripNull)
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>))
      out[key] = stripNull(item)
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

type AgentDevice = {
  readonly deviceId: string
  readonly externalId: string
  readonly groupId: string
  readonly host: string
}

const agentDevice = async (
  sql: Query,
  token: string,
  boxId: string,
): Promise<AgentDevice | null> => {
  const rows = await sql<AgentDevice[]>`
    select d.id as "deviceId", d.external_id as "externalId", d.group_id as "groupId", d.host
    from device_agent a
    join device d on d.id = a.device_id
    where a.token_hash = ${hashToken(token)} and d.external_id = ${boxId} and d.enabled = true
  `
  return rows[0] ?? null
}

const sessionUser = async (sql: Query, token: string): Promise<string | null> => {
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

const userFromRequest = async (sql: Query, request: Request): Promise<string | null> => {
  const header = request.headers.get("cookie") ?? ""
  const matched = /(?:^|;\s*)tk_mg_session=([^;]+)/.exec(header)
  let token = ""
  try {
    token = matched === null ? "" : decodeURIComponent(matched[1] ?? "")
  } catch {
    return null
  }
  if (token === "") return null
  return sessionUser(sql, token)
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "23505"

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const sharedGroup = async (
  sql: Sql,
  userId: string,
  administratorId: string,
): Promise<string | null> => {
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
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 60000) return null
  return parsed
}

const readChainSteps = (
  raw: unknown,
): {
  delays: number[]
  guards: GuardCode[][]
  parameters: ChainParameter[]
  paramScopes: ChainScope[]
} | null => {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) return null
  const parameters: ChainParameter[] = []
  const paramScopes: ChainScope[] = []
  const guards: GuardCode[][] = []
  const delays: number[] = []
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null
    const step = item as {
      api?: unknown
      delayMs?: unknown
      guards?: unknown
      params?: unknown
      scopes?: unknown
    }
    const stepGuards = normalizeGuards(step.guards)
    const delayMs = readDelay(step.delayMs)
    if (stepGuards === null || delayMs === null) return null
    const skill = typeof step.api === "string" ? step.api : ""
    if (!skillByCode.has(skill)) return null
    if (step.params === null || typeof step.params !== "object" || Array.isArray(step.params))
      return null
    if (
      step.scopes !== undefined &&
      (step.scopes === null || typeof step.scopes !== "object" || Array.isArray(step.scopes))
    ) {
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

const ownedDevice = async (sql: Query, userId: string, deviceId: string) => {
  const rows = await sql<
    {
      deviceId: string
      externalId: string
      groupId: string
      host: string
      firmware: string
      status: string
      lastSeenAt: Date | null
    }[]
  >`
    select d.id as "deviceId", d.external_id as "externalId", d.group_id as "groupId", d.host,
      d.firmware, d.status, d.last_seen_at as "lastSeenAt"
    from device d
    where d.id = ${deviceId}::uuid
      and d.enabled = true
      and d.assignment_pending = false
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

const writeLog = async (
  sql: Query,
  groupId: string,
  deviceId: string | null,
  level: string,
  text: string,
  actorId?: string,
) => {
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
      const allowed = await tx`select id from device
        where id = ${device.deviceId}::uuid and enabled = true and assignment_pending = false
          and assignee_user_id in (select id from app_user where enabled and role = 'administrator')
        for update`
      if (allowed.length === 0) return null
      const rows = await tx<ClaimRow[]>`
        select t.id as "taskId", t.group_id as "groupId", s.id as "stepId", s.kind, s.sequence,
          s.parameters, s.after_ms as "afterMs", s.instance_id as "instanceId", s.guards, s.phase, s.role,
          s.guard_code as "guardCode", s.parent_step_id::text as "parentStepId",
          d.external_id as "externalId", d.host,
           coalesce(di.instance_index, (s.target->>'indexNum')::int) as "indexNum", coalesce(di.api_port, 0) as "apiPort",
          coalesce(di.rpa_port, 0) as "rpaPort", di.label
        from execution_task t
        join execution_task_step s on s.task_id = t.id and s.group_id = t.group_id
        join device d on d.id = t.device_id
        left join device_instance di on di.id = s.instance_id
        where d.id = ${device.deviceId}::uuid
          and t.status in ('queued', 'dispatching', 'ood')
          and t.executor_key = 'box-agent' and t.cancel_requested_at is null
          and s.status = 'pending'
          and not exists (select 1 from execution_task_step active
            where active.task_id = t.id and active.status in ('claimed', 'running'))
          and not exists (select 1 from device_command command
            where command.device_id = t.device_id and command.status in ('queued', 'running')
              and (command.instance_id is null or s.instance_id is null or command.instance_id = s.instance_id))
          and s.sequence = (
            select min(sequence) from execution_task_step
            where task_id = t.id and status = 'pending'
          )
          and not exists (
            select 1 from execution_task_device_lease l
            where l.device_id = t.device_id
              and l.released_at is null
              and (l.instance_id is null or s.instance_id is null or l.instance_id = s.instance_id)
          )
        order by t.created_at
        for update of t skip locked
        limit 1
      `
      const row = rows[0]
      if (row === undefined) return null
      const lease = randomUUID()
      await tx`
        update execution_task_step set status = 'claimed', started_at = now(), submit_started_at = now() where id = ${row.stepId}::uuid
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
  } catch (error) {
    if (isUniqueViolation(error)) return null
    throw error
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
    steps: [
      {
        ...(row.afterMs > 0 ? { afterMs: row.afterMs } : {}),
        id: row.stepId,
        ...agentSkillStep(row.kind, row.parameters),
      },
    ],
    version: "1",
  },
})

export const registerBoxLink = (
  app: Hono,
  sql: Sql,
  databaseUrl: string,
  authService: AuthService,
  auditRepository: AuditRepository,
) => {
  registerBusinessLabels(app, sql, authService, auditRepository)
  const frames = new Map<string, FrameHit>()
  const waiters = new Map<string, Set<() => void>>()
  const wake = (deviceId: string): void => {
    const list = waiters.get(deviceId)
    waiters.delete(deviceId)
    for (const fn of list ?? []) fn()
  }
  const listen = postgres(databaseUrl, { max: 1 })
  let stopping = false
  const listening = listen.listen("agent_task", wake)
  void listening.catch(() => {
    console.error("agent_task listen failed")
  })
  const cleanup = setInterval(() => {
    const now = Date.now()
    for (const [key, frame] of frames) if (now - frame.at > 15000) frames.delete(key)
    void sql`update device set status = 'offline' where external_id is not null and status = 'online'
      and last_seen_at < now() - interval '45 seconds'`.catch(() => {})
    void recoverBoxTasks(sql).catch(() => {
      console.error("box task recovery failed")
    })
  }, 5000)

  app.use("/agent/*", async (context, next) => {
    const token = bearer(context.req.header("authorization"))
    const valid =
      token === ""
        ? []
        : await sql`select a.device_id from device_agent a
      join device d on d.id = a.device_id where a.token_hash = ${hashToken(token)} and d.enabled = true`
    if (valid.length === 0) return context.body(null, 401)
    return next()
  })
  app.use("/api/*", async (context, next) => {
    const path = context.req.path
    let pages: readonly string[] = []
    if (path === "/api/skills" || path.startsWith("/api/behavior-chains"))
      pages = [PageKey.Behaviors]
    else if (path.startsWith("/api/box-") || path === "/api/devices/labels")
      pages = [PageKey.Devices]
    else if (
      path.startsWith("/api/devices") ||
      path.startsWith("/api/tasks") ||
      path === "/api/frames"
    )
      pages = [PageKey.Devices, PageKey.Behaviors]
    else if (path === "/api/operation-logs")
      pages = [PageKey.WorkLogs, PageKey.Devices, PageKey.Behaviors]
    if (pages.length === 0) return next()
    const cookie =
      /(?:^|;\s*)tk_mg_session=([^;]+)/.exec(context.req.header("cookie") ?? "")?.[1] ?? ""
    const principal = await authService.session(cookie)
    if (principal === null) return context.json({ error: "authentication_required" }, 401)
    const view = pages.some((page) => canViewPage(principal.scope, page))
    const remove =
      context.req.method !== "DELETE" || pages.some((page) => canDeletePage(principal.scope, page))
    const catalogDelete =
      context.req.method === "DELETE" &&
      (path.startsWith("/api/box-remarks/") || path.startsWith("/api/box-groups/"))
    if (!view || !remove || (catalogDelete && principal.scope.role !== "administrator")) {
      await writeAuditEvent(auditRepository, {
        action: "box.access",
        actorId: principal.userId,
        outcome: "denied",
        target: path,
      })
      return context.json({ error: "permission_denied" }, 403)
    }
    return next()
  })
  app.use("*", async (context, next) => {
    const path = context.req.path
    const ids = path.matchAll(
      /\/(?:devices|tasks|behavior-chains|box-remarks|box-groups)\/([^/]+)/g,
    )
    for (const [, id] of ids) {
      if (id !== "claim" && id !== "labels" && !isUuid(id ?? "")) {
        return context.json({ error: "invalid_id" }, 400)
      }
    }
    if (context.req.method === "POST") {
      let schema: z.ZodType | undefined
      if (path === "/agent/register") schema = RegisterSchema
      else if (path === "/agent/heartbeat") schema = HeartbeatSchema
      else if (/^\/agent\/tasks\/[^/]+\/status$/.test(path)) schema = StatusSchema
      else if (/^\/agent\/tasks\/[^/]+\/guard$/.test(path)) schema = GuardSchema
      else if (path === "/agent/events") schema = EventsSchema
      else if (path === "/api/tasks") schema = EnqueueSchema
      else if (path === "/api/devices/labels") schema = LabelsSchema
      else if (/^\/api\/devices\/[^/]+\/watch$/.test(path)) schema = WatchSchema
      else if (path === "/api/box-remarks" || path === "/api/box-groups")
        schema = z.object({ name: z.string().trim().min(1).max(40) })
      if (schema !== undefined) {
        const raw = await context.req.text()
        if (raw.length > 3 * 1024 * 1024) return context.json({ error: "invalid_payload" }, 413)
        let body: unknown
        try {
          body = JSON.parse(raw)
        } catch {
          return context.json({ error: "invalid_payload" }, 400)
        }
        if (!schema.safeParse(body).success) return context.json({ error: "invalid_payload" }, 400)
      }
    }
    return next()
  })

  app.post("/agent/register", async (context) => {
    const token = bearer(context.req.header("authorization"))
    const body = (await context.req.json().catch(() => null)) as {
      boxId?: string
      version?: string
    } | null
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
    const body = (await context.req.json().catch(() => null)) as {
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
      const index = Number(slot["indexNum"] ?? 0)
      if (index < 1 || index > 5) continue
      const running = String(slot["status"] ?? "") === "running"
      await sql`
        insert into device_instance (id, device_id, instance_index, label, enabled, status, container_id, api_port, rpa_port, width, height)
        values (
          ${randomUUID()}::uuid, ${device.deviceId}::uuid, ${index}, ${String(slot["name"] ?? "")}, true,
          ${running ? "online" : "offline"}, ${String(slot["id"] ?? "")}, ${Number(slot["apiPort"] ?? 0)},
          ${Number(slot["rpaPort"] ?? 0)}, ${String(slot["width"] ?? "")}, ${String(slot["height"] ?? "")}
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
        const done = () => {
          clearTimeout(timer)
          context.req.raw.signal.removeEventListener("abort", done)
          const list = waiters.get(device.deviceId)
          list?.delete(done)
          if (list?.size === 0) waiters.delete(device.deviceId)
          resolve()
        }
        const timer = setTimeout(done, waitMs)
        const list = waiters.get(device.deviceId) ?? new Set<() => void>()
        list.add(done)
        waiters.set(device.deviceId, list)
        context.req.raw.signal.addEventListener("abort", done, { once: true })
        if (context.req.raw.signal.aborted) done()
      })
      if (stopping || context.req.raw.signal.aborted) return context.body(null, 204)
      const second = await claimOnce(sql, device)
      if (second !== null) return context.json(taskPointer(second))
    }
    return context.body(null, 204)
  })

  app.post("/agent/tasks/:id/status", async (context) => {
    const token = bearer(context.req.header("authorization"))
    const taskId = context.req.param("id")
    const body = (await context.req.json().catch(() => null)) as {
      status?: string
      error_code?: string
      checkpoint?: { outputs?: Record<string, string>; step_id?: string }
    } | null
    const reportedStep = body?.checkpoint?.step_id ?? ""
    const rows = await sql<
      {
        deviceId: string
        externalId: string
        groupId: string
        kind: string
        parentStepId: string | null
        role: string
        stepId: string
      }[]
    >`
      select d.id as "deviceId", d.external_id as "externalId", t.group_id as "groupId", s.kind, s.id as "stepId",
        s.role, s.parent_step_id::text as "parentStepId"
      from execution_task t
      join device d on d.id = t.device_id
      join device_agent a on a.device_id = d.id
      join execution_task_step s on s.task_id = t.id and s.status in ('claimed', 'running')
      where t.id = ${taskId}::uuid and a.token_hash = ${hashToken(token)}
        and t.executor_key = 'box-agent' and t.status in ('queued','dispatching','running','ood')
        and exists (select 1 from execution_task_run r where r.task_id = t.id and r.step_id = s.id
          and r.status in ('claimed','running') and r.claim_expires_at > now())
        and (${reportedStep} = '' or s.id::text = ${reportedStep})
      order by s.sequence
      limit 1
    `
    const row = rows[0]
    if (row === undefined) {
      if (reportedStep !== "") {
        const prior = await sql<{ status: string }[]>`
          select s.status from execution_task_step s
          join execution_task t on t.id = s.task_id
          join device_agent a on a.device_id = t.device_id
          where s.task_id = ${taskId}::uuid and s.id::text = ${reportedStep} and a.token_hash = ${hashToken(token)}
        `
        if (
          prior[0]?.status === body?.status &&
          ["succeeded", "failed", "cancelled"].includes(body?.status ?? "")
        )
          return context.json({})
        if (
          prior[0] !== undefined &&
          ["succeeded", "failed", "cancelled"].includes(prior[0].status)
        )
          return context.json({ error: "conflicting_terminal_report" }, 409)
      }
      return context.body(null, 404)
    }
    const status = body?.status ?? ""
    if (status === "succeeded" || status === "failed" || status === "cancelled") {
      const stepStatus = status
      const outputs = stripNull(body?.checkpoint?.outputs ?? {}) as Record<string, string>
      const outcome = await sql.begin(async (tx) => {
        // Match claim/synchronization lock order before writing device-linked history.
        await tx`select id from device where id = ${row.deviceId}::uuid for update`
        await tx`select id from execution_task where id = ${taskId}::uuid for update`
        const finish = async (value: "failed" | "cancelled" | "continue" | "done") => {
          await tx`select pg_notify('agent_task', ${row.deviceId})`
          await writeLog(
            tx,
            row.groupId,
            row.deviceId,
            value === "failed" ? "error" : "ok",
            value === "continue"
              ? `${row.externalId} 步骤 ${row.kind} 完成，继续下一步`
              : `${row.externalId} ${value === "done" ? "succeeded" : value}`,
          )
          return value
        }
        const active = await tx`select id from execution_task_step where id = ${row.stepId}::uuid
          and status in ('claimed','running')
          and exists (select 1 from execution_task t where t.id = ${taskId}::uuid
            and t.status in ('queued','dispatching','running','ood'))
          and exists (select 1 from execution_task_run r where r.task_id = ${taskId}::uuid
            and r.step_id = ${row.stepId}::uuid and r.status in ('claimed','running')
            and r.claim_expires_at > now()) for update`
        if (active.length === 0) {
          const completed =
            await tx`select id from execution_task_step where id = ${row.stepId}::uuid
            and status = ${status} and status in ('succeeded','failed','cancelled')`
          return completed.length > 0 ? "duplicate" : "stale"
        }
        if (status === "succeeded" && row.role === "native") {
          const incomplete =
            await tx`select id from execution_task_step where id = ${row.stepId}::uuid
            and guard_index < jsonb_array_length(guards)`
          if (incomplete.length > 0) return "guard_incomplete"
        }
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
        if (status === "succeeded" && row.role === "ood" && row.parentStepId) {
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
                  guard_probe_index = null, guard_response = null,
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
        if (status === "failed" || status === "cancelled") {
          await tx`
            update execution_task_step
            set status = 'cancelled', finished_at = now()
            where task_id = ${taskId}::uuid and status in ('pending', 'held')
          `
          await tx`
            update execution_task
            set status = ${status}, finished_at = now(), updated_at = now(), error_code = ${body?.error_code ?? null}
            where id = ${taskId}::uuid
          `
          return finish(status)
        }
        const cancellation = await tx`select id from execution_task where id = ${taskId}::uuid
          and cancel_requested_at is not null`
        if (cancellation.length > 0) {
          await tx`update execution_task_step set status = 'cancelled', finished_at = now()
            where task_id = ${taskId}::uuid and status in ('pending','held')`
          await tx`update execution_task set status = 'cancelled', finished_at = now(), updated_at = now(),
            terminal_reason = 'stopped_between_steps' where id = ${taskId}::uuid`
          return finish("cancelled")
        }
        const rest = await tx<{ n: number }[]>`
          select count(*)::int as n from execution_task_step
          where task_id = ${taskId}::uuid and status in ('pending','claimed','running','held')
        `
        if ((rest[0]?.n ?? 0) > 0) {
          await tx`
            update execution_task
            set status = 'queued', finished_at = null, updated_at = now(), error_code = null
            where id = ${taskId}::uuid
          `
          return finish("continue")
        }
        await tx`
          update execution_task
          set status = 'succeeded', finished_at = now(), updated_at = now(), error_code = null
          where id = ${taskId}::uuid
        `
        return finish("done")
      })
      if (outcome === "stale") return context.json({ error: "stale_execution" }, 409)
      if (outcome === "guard_incomplete") return context.json({ error: "guard_incomplete" }, 409)
      if (outcome === "duplicate") return context.json({})
      wake(row.deviceId)
      return context.json({})
    }
    const updated = await sql.begin(async (tx) => {
      await tx`select id from execution_task where id = ${taskId}::uuid for update`
      const current = await tx`select s.id from execution_task_step s
        join execution_task t on t.id = s.task_id
        where s.id = ${row.stepId}::uuid and s.status in ('claimed','running')
          and t.status in ('dispatching','running','ood')
          and exists (select 1 from execution_task_run r where r.step_id = s.id
            and r.status in ('claimed','running') and r.claim_expires_at > now())`
      if (current.length === 0) return false
      await tx`update execution_task set status = 'running', updated_at = now() where id = ${taskId}::uuid`
      await tx`update execution_task_step set status = 'running' where id = ${row.stepId}::uuid`
      return true
    })
    return updated ? context.json({}) : context.json({ error: "stale_execution" }, 409)
  })

  app.post("/agent/tasks/:id/guard", async (context) => {
    return sql.begin(async (sql) => {
      const token = bearer(context.req.header("authorization"))
      const taskId = context.req.param("id")
      const body = (await context.req.json().catch(() => null)) as {
        output?: unknown
        stepId?: string
      } | null
      const stepId = body?.stepId ?? ""
      const reported = body !== null && Object.hasOwn(body, "output")
      const output = typeof body?.output === "string" ? body.output.replaceAll("\u0000", "") : ""
      if (token === "" || stepId === "") return context.json({ error: "invalid_guard" }, 400)
      await sql`select d.id from device d join execution_task t on t.device_id = d.id
        join device_agent a on a.device_id = d.id
        where t.id = ${taskId}::uuid and a.token_hash = ${hashToken(token)} for update of d`
      await sql`select t.id from execution_task t join device_agent a on a.device_id = t.device_id
      where t.id = ${taskId}::uuid and a.token_hash = ${hashToken(token)} for update of t`
      const rows = await sql<
        {
          deviceId: string
          externalId: string
          groupId: string
          guardIndex: number
          guards: GuardCode[]
          id: string
          instanceId: string | null
          sequence: number
          target: Record<string, unknown> | null
          probeIndex: number | null
          guardResponse: Record<string, unknown> | null
        }[]
      >`
      select s.id::text as id, s.group_id::text as "groupId", s.sequence, s.guards,
        s.guard_index as "guardIndex", s.instance_id::text as "instanceId", s.target,
         d.id::text as "deviceId", d.external_id as "externalId",
         s.guard_probe_index as "probeIndex", s.guard_response as "guardResponse"
      from execution_task_step s
      join execution_task t on t.id = s.task_id and t.group_id = s.group_id
      join device d on d.id = t.device_id
      join device_agent a on a.device_id = d.id
      where t.id = ${taskId}::uuid and s.id = ${stepId}::uuid
        and a.token_hash = ${hashToken(token)}
         and s.role = 'native'
         and t.executor_key = 'box-agent' and t.status in ('dispatching','running','ood')
        and s.status in ('claimed', 'running', 'held')
        and (s.status = 'held' or exists (select 1 from execution_task_run r
          where r.step_id = s.id and r.status in ('claimed','running') and r.claim_expires_at > now()))
    `
      const step = rows[0]
      if (step === undefined) return context.json({ error: "not_found" }, 404)
      if (step.guardResponse !== null && step.guardResponse["action"] === "ood")
        return context.json(step.guardResponse)
      if (reported && step.guardResponse !== null) return context.json(step.guardResponse)
      const codes = step.guards ?? []
      if (step.guardIndex >= codes.length) return context.json({ action: "pass", pending: false })
      const code = codes[step.guardIndex]
      if (code !== "ad" && code !== "transcode")
        return context.json({ error: "invalid_guard" }, 400)
      const spec = guardCatalog[code]
      if (!reported) {
        await sql`update execution_task_step set guard_probe_index = ${step.guardIndex},
        guard_response = null where id = ${step.id}::uuid`
        return context.json({
          action: "probe",
          guard: code,
          input: spec.probe.input,
          label: spec.label,
          pending: true,
          skill: spec.probe.skill,
        })
      }
      if (step.probeIndex !== step.guardIndex)
        return context.json({ error: "guard_probe_required" }, 409)
      if (!xmlHasText(output, spec.marker)) {
        const next = step.guardIndex + 1
        const response = {
          action: "pass",
          guard: code,
          label: spec.label,
          pending: next < codes.length,
        }
        await sql`update execution_task_step set guard_index = ${next}, guard_response = ${sql.json(response)}
        where id = ${step.id}::uuid`
        return context.json(response)
      }
      const existing = await sql<{ id: string }[]>`
      select id::text as id from execution_task_step
      where parent_step_id = ${step.id}::uuid and guard_code = ${code} and status = 'pending'
    `
      if (existing[0] !== undefined) {
        return context.json({
          action: "ood",
          guard: code,
          insertedStepId: existing[0].id,
          label: spec.label,
          pending: true,
        })
      }
      const insertedId = randomUUID()
      const input = { index: "0", text: spec.marker }
      const tx = sql
      await tx`update execution_task_step set sequence = sequence + 100000 where task_id = ${taskId}::uuid and sequence > ${step.sequence}`
      await tx`update execution_task_step set sequence = sequence - 99999 where task_id = ${taskId}::uuid and sequence > 100000`
      if (step.instanceId) {
        await tx`
          insert into execution_task_step (
            id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters, status,
            role, phase, guards, guard_code, guard_index, parent_step_id, instance_id
          ) values (
            ${insertedId}::uuid, ${taskId}::uuid, ${step.groupId}::uuid, ${step.sequence + 1},
            ${`${taskId}:ood:${insertedId}`}, ${insertedId}, 'ClickNode', ${tx.json(z.json().parse(step.target ?? {}))}, ${tx.json(input)}, 'pending',
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
            ${`${taskId}:ood:${insertedId}`}, ${insertedId}, 'ClickNode', ${tx.json(z.json().parse(step.target ?? {}))}, ${tx.json(input)}, 'pending',
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
      const response = {
        action: "ood",
        guard: code,
        insertedStepId: insertedId,
        label: spec.label,
        pending: true,
      }
      await sql`update execution_task_step set guard_response = ${sql.json(response)} where id = ${step.id}::uuid`
      await writeLog(
        sql,
        step.groupId,
        step.deviceId,
        "info",
        `守护 ${spec.label} 发现 ${spec.marker}，插入点击`,
      )
      await sql`select pg_notify('agent_task', ${step.deviceId})`
      wake(step.deviceId)
      return context.json(response)
    })
  })

  app.post("/agent/events", async (context) => {
    return sql.begin(async (sql) => {
      const token = bearer(context.req.header("authorization"))
      const body = (await context.req.json().catch(() => null)) as ReadonlyArray<{
        box_id?: string
        event?: string
        msg?: string
        task_id?: string
      }> | null
      if (!Array.isArray(body) || token === "") return context.body(null, 401)
      const logs: { groupId: string; deviceId: string; name: string; message: string }[] = []
      for (const event of body) {
        const device = await agentDevice(sql, token, event.box_id ?? "")
        if (device === null) return context.body(null, 401)
        let groupId = device.groupId
        if (event.task_id) {
          const task = (
            await sql<{ groupId: string }[]>`select group_id as "groupId"
            from execution_task where id = ${event.task_id}::uuid
              and device_id = ${device.deviceId}::uuid and executor_key = 'box-agent'`
          )[0]
          if (task === undefined) return context.body(null, 404)
          groupId = task.groupId
        }
        const name = event.event ?? ""
        if (
          name === "step.ok" ||
          name === "step.fail" ||
          name === "task.succeeded" ||
          name === "task.failed"
        ) {
          logs.push({
            groupId,
            deviceId: device.deviceId,
            name,
            message: String(stripNull(event.msg || name)),
          })
        }
      }
      for (const log of logs)
        await writeLog(
          sql,
          log.groupId,
          log.deviceId,
          log.name.endsWith("ok") || log.name.endsWith("succeeded") ? "ok" : "error",
          log.message,
        )
      return context.json({})
    })
  })

  app.post("/agent/frames", async (context) => {
    const token = bearer(context.req.header("authorization"))
    const boxId = context.req.query("boxId") ?? ""
    const index = Number(context.req.query("indexNum") ?? "0")
    if (!Number.isInteger(index) || index < 1 || index > 5)
      return context.json({ error: "invalid_index" }, 400)
    const device = token === "" || boxId === "" ? null : await agentDevice(sql, token, boxId)
    if (device === null) return context.body(null, 401)
    const watching = await sql<{ n: number }[]>`
      select count(*)::int as n from device_watch
      where device_id = ${device.deviceId}::uuid and instance_index = ${index} and expires_at > now()
    `
    if ((watching[0]?.n ?? 0) === 0) return context.body(null, 204)
    const reader = context.req.raw.body?.getReader()
    if (reader === undefined) return context.body(null, 204)
    const chunks: Uint8Array[] = []
    let length = 0
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > 2 * 1024 * 1024) {
        await reader.cancel()
        return context.body(null, 204)
      }
      chunks.push(chunk.value)
    }
    if (length === 0) return context.body(null, 204)
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    frames.set(`${device.deviceId}#${index}`, { at: Date.now(), bytes, groupId: device.groupId })
    return context.body(null, 204)
  })

  app.get("/agent/templates/:id/:ver", (context) =>
    context.json({
      id: context.req.param("id"),
      pack: "1",
      scene: "box",
      steps: [],
      version: context.req.param("ver"),
    }),
  )
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
       where d.enabled = true and d.external_id is not null and d.assignment_pending = false
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
    if (administratorId === null)
      return context.json({ administratorId: null, groups: [], remarks: [] })
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
    const body = (await context.req.json().catch(() => null)) as { name?: string } | null
    const name = body?.name?.trim() ?? ""
    if (administratorId === null || name === "" || name.length > 40)
      return context.json({ error: "invalid_label" }, 400)
    try {
      const rows = await sql`
        insert into business_label (administrator_id, scope, kind, name) values (${administratorId}::uuid, 'device', 'remark', ${name})
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
      delete from business_label where scope = 'device' and kind = 'remark' and id = ${context.req.param("id")}::uuid and administrator_id = ${administratorId}::uuid
      returning id
    `
    if (removed.length === 0) return context.json({ error: "not_found" }, 404)
    return context.body(null, 204)
  })

  app.post("/api/box-groups", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const body = (await context.req.json().catch(() => null)) as { name?: string } | null
    const name = body?.name?.trim() ?? ""
    if (administratorId === null || name === "" || name.length > 40)
      return context.json({ error: "invalid_label" }, 400)
    try {
      const rows = await sql`
        insert into business_label (administrator_id, scope, kind, name) values (${administratorId}::uuid, 'device', 'group', ${name})
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
    return sql.begin(async (tx) => {
      const identity = await tx<{ name: string }[]>`
        select name from business_label where scope = 'device' and kind = 'group'
          and id = ${context.req.param("id")}::uuid and administrator_id = ${administratorId}::uuid`
      if (identity[0] === undefined) return context.json({ error: "not_found" }, 404)
      await lockBusinessLabel(tx, administratorId, "device", "group", identity[0].name)
      const rows = await tx<{ name: string }[]>`
        select name from business_label where scope = 'device' and kind = 'group'
          and id = ${context.req.param("id")}::uuid and administrator_id = ${administratorId}::uuid for update`
      if (rows[0] === undefined) return context.json({ error: "not_found" }, 404)
      if (await businessGroupInUse(tx, administratorId, "device", rows[0].name))
        return context.json({ error: "label_in_use" }, 409)
      await tx`delete from business_label where id = ${context.req.param("id")}::uuid`
      return context.body(null, 204)
    })
  })

  app.post("/api/devices/labels", async (context) => {
    return sql.begin(async (sql) => {
      const user = await userFromRequest(sql, context.req.raw)
      if (user === null) return context.json({ error: "authentication_required" }, 401)
      const administratorId = await administratorFor(sql, user)
      const body = (await context.req.json().catch(() => null)) as {
        boxGroupId?: string | null
        deviceIds?: string[]
        remarkId?: string | null
      } | null
      const deviceIds = body?.deviceIds ?? []
      if (administratorId === null || deviceIds.length === 0 || body === null)
        return context.json({ error: "invalid_label" }, 400)
      const setsRemark = Object.hasOwn(body, "remarkId")
      const setsGroup = Object.hasOwn(body, "boxGroupId")
      if (setsRemark && body.remarkId !== null && body.remarkId !== undefined) {
        const found =
          await sql`select id from box_remark where id = ${body.remarkId}::uuid and administrator_id = ${administratorId}::uuid`
        if (found.length === 0) return context.json({ error: "not_found" }, 404)
      }
      if (setsGroup && body.boxGroupId !== null && body.boxGroupId !== undefined) {
        const found =
          await sql`select id from box_group where id = ${body.boxGroupId}::uuid and administrator_id = ${administratorId}::uuid`
        if (found.length === 0) return context.json({ error: "not_found" }, 404)
      }
      const owned = await sql<{ id: string }[]>`
      select id from device
      where id = any(${deviceIds}::uuid[]) and assignee_user_id = ${administratorId}::uuid
        and external_id is not null and enabled and not assignment_pending
      for update
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
  })

  app.get("/api/devices/:deviceId/slots", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    const device =
      user === null ? null : await ownedDevice(sql, user, context.req.param("deviceId"))
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
    if (user === null) return context.json({ error: "not_found" }, 404)
    return sql.begin(async (sql) => {
      await sql`select id from device where id = ${context.req.param("deviceId")}::uuid for update`
      const device = await ownedDevice(sql, user, context.req.param("deviceId"))
      if (device === null || user === null) return context.json({ error: "not_found" }, 404)
      const body = (await context.req.json().catch(() => null)) as { indexNums?: number[] } | null
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
  })

  app.get("/api/frames", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    const deviceId = context.req.query("deviceId") ?? ""
    if (!isUuid(deviceId)) return context.json({ error: "invalid_id" }, 400)
    const index = Number(context.req.query("index") ?? "0")
    if (!Number.isInteger(index) || index < 1 || index > 5)
      return context.json({ error: "invalid_index" }, 400)
    const device = user === null ? null : await ownedDevice(sql, user, deviceId)
    if (device === null || user === null) return context.json({ error: "not_found" }, 404)
    const watching = await sql<{ n: number }[]>`
      select count(*)::int as n from device_watch
      where device_id = ${device.deviceId}::uuid and instance_index = ${index}
        and user_id = ${user}::uuid and expires_at > now()
    `
    const hit = frames.get(`${device.deviceId}#${index}`)
    if (
      (watching[0]?.n ?? 0) === 0 ||
      hit === undefined ||
      hit.groupId !== device.groupId ||
      Date.now() - hit.at > 15_000
    )
      return context.body(null, 204)
    return new Response(hit.bytes, {
      headers: { "content-type": "image/jpeg", "cache-control": "no-store" },
    })
  })

  app.post("/api/tasks", async (context) => {
    try {
      const user = await userFromRequest(sql, context.req.raw)
      if (user === null) return context.json({ error: "authentication_required" }, 401)
      const key = context.req.header("idempotency-key") ?? ""
      if (key === "" || key.length > 200)
        return context.json({ error: "idempotency_key_required" }, 400)
      const rawBody = await context.req.text()
      const body = JSON.parse(rawBody) as {
        deviceId?: string
        indexNum?: number
        steps?: ReadonlyArray<{
          afterMs?: unknown
          guards?: unknown
          input?: Record<string, string>
          skill?: string
        }>
      }
      const device = await ownedDevice(sql, user, body?.deviceId ?? "")
      if (device === null) return context.json({ error: "not_found" }, 404)
      const steps = body?.steps ?? []
      if (steps.length === 0) return context.json({ error: "steps_required" }, 400)
      const guards = steps.map((step) => normalizeGuards(step.guards))
      const delays = steps.map((step) => readDelay(step.afterMs))
      if (guards.some((item) => item === null) || delays.some((item) => item === null))
        return context.json({ error: "skill_rejected" }, 400)
      if (
        steps.some(
          (step) =>
            !skillByCode.has(step.skill ?? "") ||
            (noBatch.has(step.skill ?? "") && steps.length > 1),
        )
      ) {
        return context.json({ error: "skill_rejected" }, 400)
      }
      if (
        steps.some(
          (step) =>
            isSharedVideoSkill(step.skill ?? "") &&
            sharedVideoCommand(step.skill ?? "", step.input ?? {}) === null,
        )
      ) {
        return context.json({ error: "video_path_rejected" }, 400)
      }
      const parameters = steps.map((step) => ({ input: step.input ?? {}, skill: step.skill ?? "" }))
      const indexNum = Number(body?.indexNum ?? 0)
      const hash = hashToken(
        fingerprint({ deviceId: device.deviceId, indexNum, parameters, guards, delays }),
      )
      const existing = await sql<{ id: string; status: string; fingerprint: string }[]>`
       select id::text as id, status, fingerprint from execution_task
      where group_id = ${device.groupId}::uuid and idempotency_key = ${key}
    `
      if (existing[0] !== undefined)
        return existing[0].fingerprint === hash
          ? context.json({ status: existing[0].status, taskId: existing[0].id })
          : context.json({ error: "idempotency_conflict" }, 409)
      const taskId = randomUUID()
      const instance =
        indexNum < 1
          ? []
          : await sql<{ id: string }[]>`
      select id::text as id from device_instance
      where device_id = ${device.deviceId} and instance_index = ${indexNum}
    `
      const created = await sql.begin(async (tx) => {
        const current = await tx`select d.id from device d
         where d.id = ${device.deviceId}::uuid and d.group_id = ${device.groupId}::uuid
           and d.enabled and not d.assignment_pending
           and d.assignee_user_id in (select a.id from app_user a where a.enabled
             and a.role = 'administrator' and a.provisioned_by = 'init-tool'
             and (a.id = ${user}::uuid or exists (select 1 from user_group mine
               join user_group theirs on theirs.group_id = mine.group_id
               where mine.user_id = ${user}::uuid and theirs.user_id = a.id)))
         for update of d`
        if (current.length === 0) return { kind: "not_found" as const }
        const inserted = await tx`
        insert into execution_task (
          id, group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters, status
        ) values (
           ${taskId}::uuid, ${device.groupId}::uuid, ${user}::uuid, ${device.deviceId}::uuid, ${key}, ${hash},
          ${steps[0]?.skill ?? "task"}, 'box-agent', ${tx.json(parameters)}, 'queued'
         ) on conflict(group_id, idempotency_key) do nothing returning id
       `
        if (inserted.length === 0) {
          const prior = (
            await tx<{ id: string; status: string; fingerprint: string }[]>`
           select id::text, status, fingerprint from execution_task
           where group_id = ${device.groupId}::uuid and idempotency_key = ${key}
         `
          )[0]
          return prior?.fingerprint === hash
            ? { kind: "existing" as const, taskId: prior.id, status: prior.status }
            : { kind: "conflict" as const }
        }
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
        await writeLog(
          tx,
          device.groupId,
          device.deviceId,
          "info",
          `已下发 ${steps.map((step) => step.skill).join(",")}`,
          user,
        )
        return { kind: "created" as const }
      })
      if (created.kind === "not_found") return context.json({ error: "not_found" }, 404)
      if (created.kind === "conflict") return context.json({ error: "idempotency_conflict" }, 409)
      if (created.kind === "existing")
        return context.json({ status: created.status, taskId: created.taskId })
      wake(device.deviceId)
      return context.json({ status: "queued", taskId }, 201)
    } catch (error) {
      console.error("box task submission failed", error instanceof Error ? error.name : "Error")
      return context.json({ error: "task_submission_failed" }, 500)
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
    const steps = await sql<
      {
        errorCode: string | null
        kind: string
        result: Record<string, string> | null
        sequence: number
        status: string
      }[]
    >`
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
    if (administratorId === null || groupId === null)
      return context.json({ error: "not_found" }, 404)
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
    return rows[0] === undefined
      ? context.json({ error: "not_found" }, 404)
      : context.json({ ok: true })
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
    return rows[0] === undefined
      ? context.json({ error: "not_found" }, 404)
      : context.json({ ok: true })
  })
  return {
    checkReadiness: async () => {
      await listening
    },
    close: async () => {
      stopping = true
      clearInterval(cleanup)
      for (const deviceId of waiters.keys()) wake(deviceId)
      frames.clear()
      await listen.end({ timeout: 5 })
    },
  }
}
