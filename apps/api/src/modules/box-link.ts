import { createHash, randomUUID } from "node:crypto"

import type { Hono } from "hono"
import postgres, { type Sql, type TransactionSql } from "postgres"
import { z } from "zod"

import { canDeletePage, canViewPage } from "../lib/authorization"
import type { SecretCipher } from "../lib/crypto"
import { PageKey } from "../lib/pages"
import {
  accountAnchorCatalog,
  type ChainAnchor,
  readAnchor,
  readStepSources,
} from "./account-anchor"
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
import { markBoxesWithoutHeartbeat, presenceHolder, sqlState, tryAcquirePresenceLease } from "./box-presence"
import { registerTaskChains } from "./task-chains"
import {
  administratorFor,
  businessGroupInUse,
  lockBusinessLabel,
  registerBusinessLabels,
} from "./business-labels"
import { refreshDeviceHosts } from "./dispatch/fill"
import { readFrameBody } from "./frame-body"
import { type GuardCode, guardCatalog, normalizeGuards, xmlHasText } from "./guards"
import { clickChanceReady, clickJumpPassed, jumpFoundCount, jumpNodesShouldSkip, jumpWhenMode, jumpWriteBack, jumpWriteKeys, jumpWriteSideReady, statusShouldJump } from "./jump-nodes"
import { registerMailCode } from "./mail-code"
import { mixedBatchRejected } from "./pit-chain"
import { registerShareFiles } from "./share-files"
import { backupPhone } from "./share-path"
import { registerNasAgentRoutes } from "./storage/agent-routes"
import { createPostgresStorageRepository } from "./storage/repository"

const guardLabel = (code: string): string =>
  code === "ad" || code === "transcode" ? guardCatalog[code].label : code

import { type SkillSpec, skillCatalog } from "./skills"
import { nodeNameOf, readChainName, readRemark, stepLogTitle } from "./step-remark"
import {
  agentSkillStep,
  isCatalogPullSkill,
  isSharedVideoSkill,
  sharedPullCommand,
  sharedVideoCommand,
  stageShareAction,
  stageShareCode,
  stageShareReady,
  transferShareCode,
  transferShareReady,
} from "./video-share"

const unassignedGroup = "00000000-0000-4000-8000-000000000001"

type Skill = SkillSpec

const skills: readonly Skill[] = skillCatalog

const skillByCode = new Map(skills.map((item) => [item.code, item]))

const skillNodeName = (skill: string): string => nodeNameOf(skill, skillByCode.get(skill)?.name)

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

const fileBrowserFromHost = (host: string): string => {
  const trimmed = host.trim()
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(trimmed) || trimmed.startsWith("127.")) return ""
  const parts = trimmed.split(".")
  if (parts.some((part) => Number(part) > 255)) return ""
  return `http://${trimmed}:18791`
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
type ChainSource = Record<string, string>

type ChainRow = {
  readonly anchorKey: string
  readonly anchorTable: string
  readonly delays: number[]
  readonly guards: GuardCode[][]
  readonly id: string
  readonly lastTestedAt: Date | null
  readonly name: string
  readonly origin: string
  readonly parameters: ChainParameter[]
  readonly paramScopes: ChainScope[]
  readonly paramSources: ChainSource[]
  readonly remarks: string[] | null
  readonly updatedAt: Date
}

const chainColumns = `id::text as id, name, origin, parameters, param_scopes as "paramScopes",
  param_sources as "paramSources", anchor_table as "anchorTable", anchor_key as "anchorKey",
  guards, delays, remarks, last_tested_at as "lastTestedAt", updated_at as "updatedAt"`

const chainView = (row: ChainRow) => {
  const stored =
    row.anchorTable === "" && row.anchorKey === ""
      ? null
      : readAnchor({ key: row.anchorKey, table: row.anchorTable })
  return {
    anchor: stored === "invalid" ? null : stored,
    id: row.id,
    lastTestedAt: row.lastTestedAt,
    name: row.name,
    origin: row.origin,
    steps: (row.parameters ?? []).map((item, index) => {
      const scopes = row.paramScopes?.[index] ?? {}
      const stored = row.paramSources?.[index] ?? {}
      const sources: ChainSource = {}
      for (const key of Object.keys(item.input ?? {})) {
        const value = stored[key]
        sources[key] =
          typeof value === "string" && value.length > 0
            ? value
            : scopes[key] === "external"
              ? ""
              : "literal"
      }
      return {
        api: item.skill,
        delayMs: row.delays?.[index] ?? 0,
        guards: row.guards?.[index] ?? [],
        id: index,
        remark: row.remarks?.[index] ?? "",
        params: item.input ?? {},
        scopes,
        sources,
      }
    }),
    updatedAt: row.updatedAt,
  }
}

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

const invalidChain = { ok: false as const, error: "invalid_chain" as const }

const readChainSteps = (
  raw: unknown,
  anchor: ChainAnchor | null,
):
  | {
      ok: true
      delays: number[]
      guards: GuardCode[][]
      parameters: ChainParameter[]
      paramScopes: ChainScope[]
      paramSources: ChainSource[]
      remarks: string[]
    }
  | { ok: false; error: "invalid_chain" | "备注过长" | "备注无效" } => {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) return invalidChain
  const parameters: ChainParameter[] = []
  const paramScopes: ChainScope[] = []
  const paramSources: ChainSource[] = []
  const guards: GuardCode[][] = []
  const delays: number[] = []
  const remarks: string[] = []
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return invalidChain
    const step = item as {
      api?: unknown
      delayMs?: unknown
      guards?: unknown
      params?: unknown
      remark?: unknown
      scopes?: unknown
      sources?: unknown
    }
    const noted = readRemark(step.remark)
    if (!noted.ok) return noted
    const stepGuards = normalizeGuards(step.guards)
    const delayMs = readDelay(step.delayMs)
    if (stepGuards === null || delayMs === null) return invalidChain
    const skill = typeof step.api === "string" ? step.api : ""
    if (!skillByCode.has(skill)) return invalidChain
    if (step.params === null || typeof step.params !== "object" || Array.isArray(step.params))
      return invalidChain
    if (
      step.scopes !== undefined &&
      (step.scopes === null || typeof step.scopes !== "object" || Array.isArray(step.scopes))
    ) {
      return invalidChain
    }
    const input: Record<string, string> = {}
    for (const [key, value] of Object.entries(step.params as Record<string, unknown>)) {
      if (typeof value !== "string") return invalidChain
      input[key] = value
    }
    const scopes: ChainScope = {}
    const rawScopes = (step.scopes ?? {}) as Record<string, unknown>
    for (const key of Object.keys(input)) {
      scopes[key] = rawScopes[key] === "external" ? "external" : "internal"
    }
    if (nodeJumpKind(skill) && !jumpNodesReady(input)) return invalidChain
    if (skill === "ClickJumpNodes" && !clickChanceReady(input?.["clickChance"])) return invalidChain
    if (skill === "CheckLive" && !checkLiveReady(input)) return invalidChain
    const sources = readStepSources(input, scopes, step.sources, anchor, skill)
    if (sources === null) return invalidChain
    parameters.push({ input, skill })
    paramScopes.push(scopes)
    paramSources.push(sources)
    guards.push(stepGuards)
    delays.push(delayMs)
    remarks.push(noted.remark)
  }
  return { ok: true, delays, guards, parameters, paramScopes, paramSources, remarks }
}

const jumpStepCount = (raw: unknown): number | null => {
  if (typeof raw !== "string" || !/^(0|[1-9]\d?)$/.test(raw)) return null
  return Number(raw)
}

const nodeJumpKind = (kind: string): boolean => kind === "JumpNodes" || kind === "ClickJumpNodes"

const jumpNodesReady = (input: Record<string, string> | null | undefined): boolean => {
  if (jumpStepCount(input?.["steps"]) === null) return false
  if (jumpWhenMode(input?.["jumpWhen"]) === null) return false
  if (
    !jumpWriteSideReady(input, "writeOnSuccessField", "writeOnSuccessValue", "tagOnSuccess") ||
    !jumpWriteSideReady(input, "writeOnFailureField", "writeOnFailureValue", "tagOnFailure")
  ) {
    return false
  }
  return ["text", "contentDesc", "resourceId", "className", "pkg"].some(
    (key) => (input?.[key] ?? "").trim() !== "",
  )
}

const checkLiveReady = (input: Record<string, string> | null | undefined): boolean => {
  if (
    input !== undefined &&
    input !== null &&
    jumpWriteKeys.some((key) => key in input)
  ) {
    return false
  }
  const when = jumpWhenMode(input?.["jumpWhen"], "off")
  if (when === null) return false
  const rawSteps = input?.["steps"]
  if (rawSteps === undefined || rawSteps === "") return when === "off"
  return jumpStepCount(rawSteps) !== null
}

const skipLaterSteps = async (
  sql: Query,
  taskId: string,
  stepId: string,
  sequence: number,
  steps: number,
): Promise<number> => {
  const skipped = await sql<{ id: string }[]>`
    update execution_task_step
    set status = 'skipped', finished_at = now(), result = ${sql.json({ skippedBy: stepId })}
    where id in (
      select id from execution_task_step
      where task_id = ${taskId}::uuid and status = 'pending' and sequence > ${sequence}
      order by sequence
      limit ${steps}
    )
    returning id
  `
  return skipped.length
}

const claimedSkillStep = (
  kind: string,
  parameters: Record<string, string> | null | undefined,
): { readonly input: Record<string, string>; readonly skill: string } => {
  if (kind === "FetchMailCode") {
    const input = { ...(parameters ?? {}) }
    delete input["email"]
    delete input["clientId"]
    delete input["refreshToken"]
    return { input, skill: kind }
  }
  if (!nodeJumpKind(kind) && kind !== "CheckLive") return agentSkillStep(kind, parameters)
  const input = { ...(parameters ?? {}) }
  if (kind === "CheckLive") {
    delete input["steps"]
    delete input["jumpWhen"]
    for (const key of jumpWriteKeys) delete input[key]
  }
  return { input, skill: kind }
}

const completeFollowingText = async (
  sql: Query,
  taskId: string,
  sequence: number,
  code: string,
): Promise<void> => {
  const rows = await sql<{ id: string; parameters: Record<string, string> | null }[]>`
    select id::text as id, parameters from execution_task_step
    where task_id = ${taskId}::uuid and sequence = ${sequence + 1} and status = 'pending' and kind = 'SendText'
    for update
  `
  const next = rows[0]
  if (next === undefined || (next.parameters?.["text"] ?? "").length > 0) return
  await sql`
    update execution_task_step
    set status = 'succeeded', finished_at = now(), error_code = null,
      result = ${sql.json({ text: code })}
    where id = ${next.id}::uuid
  `
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

const writeJumpAccount = async (
  sql: Query,
  row: {
    readonly accountId: string | null
    readonly deviceId: string
    readonly externalId: string
    readonly groupId: string
    readonly parameters: Record<string, string> | null
  },
  count: unknown,
  logTitle = "",
) => {
  const chosen = jumpWriteBack(count, row.parameters)
  if (chosen === null) return
  const outcome = chosen.hit ? "命中" : "未命中"
  const title = logTitle.trim()
  const prefix = title.length > 0 ? `${row.externalId} ${title} ${outcome}` : `${row.externalId} 节点跳跃${outcome}`
  if (row.accountId === null || row.accountId.length === 0) {
    await writeLog(sql, row.groupId, row.deviceId, "ok", `${prefix}，任务没有账号，未写回`)
    return
  }
  const locked = await sql<{ id: string }[]>`
    select id::text as id from operation_account
    where group_id = ${row.groupId}::uuid and id = ${row.accountId}::uuid and deleted = false
    for update
  `
  if (locked.length === 0) {
    await writeLog(sql, row.groupId, row.deviceId, "ok", `${prefix}，账号已删除，未写回`)
    return
  }
  const value = chosen.value
  const accountId = row.accountId
  const groupId = row.groupId
  const updated =
    chosen.field === "tags"
      ? await sql<{ id: string }[]>`
          update operation_account
          set tags = (
            select coalesce(array_agg(item order by pos), '{}'::text[])
            from (
              select coalesce(tags[1], '') as item, 1 as pos
              union all
              select tag, (ord + 1)::int
              from unnest(
                case when coalesce(cardinality(tags), 0) > 1
                  then tags[2:cardinality(tags)] else '{}'::text[] end
              ) with ordinality as bucket(tag, ord)
              union all
              select tag, (100000 + ord)::int
              from unnest(${[value]}::text[]) with ordinality as incoming(tag, ord)
              where not (tag = any(coalesce(tags, '{}'::text[])))
            ) merged
          ),
          updated_at = now()
          where group_id = ${groupId}::uuid and id = ${accountId}::uuid and deleted = false
          returning id::text as id
        `
      : chosen.field === "follower"
        ? await sql<{ id: string }[]>`
            update operation_account set follower = ${value}::bigint, updated_at = now()
            where group_id = ${groupId}::uuid and id = ${accountId}::uuid and deleted = false
            returning id::text as id
          `
        : chosen.field === "following"
          ? await sql<{ id: string }[]>`
              update operation_account set following = ${value}::bigint, updated_at = now()
              where group_id = ${groupId}::uuid and id = ${accountId}::uuid and deleted = false
              returning id::text as id
            `
          : chosen.field === "favorite"
            ? await sql<{ id: string }[]>`
                update operation_account set favorite = ${value}::bigint, updated_at = now()
                where group_id = ${groupId}::uuid and id = ${accountId}::uuid and deleted = false
                returning id::text as id
              `
            : chosen.field === "region"
              ? await sql<{ id: string }[]>`
                  update operation_account set region = ${value}, updated_at = now()
                  where group_id = ${groupId}::uuid and id = ${accountId}::uuid and deleted = false
                  returning id::text as id
                `
              : chosen.field === "note"
                ? await sql<{ id: string }[]>`
                    update operation_account set note = ${value}, updated_at = now()
                    where group_id = ${groupId}::uuid and id = ${accountId}::uuid and deleted = false
                    returning id::text as id
                  `
                : chosen.field === "platformUid"
                  ? await sql<{ id: string }[]>`
                      update operation_account set platform_uid = ${value}, updated_at = now()
                      where group_id = ${groupId}::uuid and id = ${accountId}::uuid and deleted = false
                      returning id::text as id
                    `
                  : chosen.field === "name"
                    ? await sql<{ id: string }[]>`
                        update operation_account set name = ${value}, updated_at = now()
                        where group_id = ${groupId}::uuid and id = ${accountId}::uuid and deleted = false
                        returning id::text as id
                      `
                    : await sql<{ id: string }[]>`
                        update operation_account set avatar = ${value}, updated_at = now()
                        where group_id = ${groupId}::uuid and id = ${accountId}::uuid and deleted = false
                        returning id::text as id
                      `
  await writeLog(
    sql,
    row.groupId,
    row.deviceId,
    "ok",
    updated.length === 0
      ? `${prefix}，账号已删除，未写回`
      : `${prefix}，账号写回${chosen.label} ${value}`,
  )
}

const cloudMachineName = (raw: string): string | null => {
  const name = raw.trim()
  if (name.length === 0 || name.length > 200 || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return null
  }
  const phone = backupPhone(name).phoneName
  return phone.length === 0 ? null : phone
}

const writeBackupName = async (
  sql: Query,
  row: {
    readonly accountId: string | null
    readonly deviceId: string
    readonly externalId: string
    readonly groupId: string
  },
  exportName: string,
) => {
  const prefix = `${row.externalId} 导出云机成功`
  const name = cloudMachineName(exportName)
  if (name === null) {
    await writeLog(sql, row.groupId, row.deviceId, "ok", `${prefix}，没有云机名，未写回`)
    return
  }
  if (row.accountId === null || row.accountId.length === 0) {
    await writeLog(sql, row.groupId, row.deviceId, "ok", `${prefix}，任务没有账号，未写回`)
    return
  }
  const locked = await sql<{ id: string }[]>`
    select id::text as id from operation_account
    where group_id = ${row.groupId}::uuid and id = ${row.accountId}::uuid and deleted = false
    for update
  `
  if (locked.length === 0) {
    await writeLog(sql, row.groupId, row.deviceId, "ok", `${prefix}，账号已删除，未写回`)
    return
  }
  await sql`
    update operation_account set backup_name = ${name}, updated_at = now()
    where group_id = ${row.groupId}::uuid and id = ${row.accountId}::uuid and deleted = false
  `
  await writeLog(sql, row.groupId, row.deviceId, "ok", `${prefix}，账号写回云机名字 ${name}`)
}

const repeatMark = (index: number, count: number): string =>
  count > 1 ? `第 ${index + 1}/${count} 次` : ""

const stageQuote = (name: string, index: number, count: number): string => {
  const repeat = repeatMark(index, count)
  return repeat.length > 0 ? `「${name}」${repeat}` : `「${name}」`
}

const claimLogText = (row: {
  readonly externalId: string
  readonly indexNum: number | null
  readonly repeatCount: number
  readonly repeatIndex: number
  readonly stageCount: number
  readonly stagePosition: number
  readonly taskName: string
}): string => {
  const repeat = repeatMark(row.repeatIndex, row.repeatCount)
  const extra = repeat.length > 0 ? `，${repeat}` : ""
  return `${row.externalId} 领取「${row.taskName}」第 ${row.stagePosition + 1}/${row.stageCount} 段${extra}，坑位 ${row.indexNum ?? 0}`
}

const progressLogText = (
  row: {
    readonly externalId: string
    readonly kind: string
    readonly repeatCount: number
    readonly repeatIndex: number
    readonly taskName: string
  },
  value: "failed" | "cancelled" | "continue" | "done",
  logTitle = "",
): string => {
  const quoted = stageQuote(row.taskName, row.repeatIndex, row.repeatCount)
  const title = logTitle.trim()
  if (value === "continue") {
    return title.length > 0
      ? `${row.externalId} ${title} 完成，继续下一步`
      : `${row.externalId} ${quoted}步骤 ${row.kind} 完成，继续下一步`
  }
  const tail = value === "done" ? "完成" : value === "failed" ? "失败" : "取消"
  return `${row.externalId} ${quoted}${tail}`
}

const cancelLaterStages = async (
  sql: Query,
  taskId: string,
  groupId: string,
  deviceId: string,
  externalId: string,
  cause: { readonly name: string; readonly repeatCount: number; readonly repeatIndex: number },
): Promise<void> => {
  const stopped = await sql<
    { id: string; name: string; repeatCount: number; repeatIndex: number }[]
  >`
    with recursive later as (
      select id, name, repeat_index, repeat_count
      from execution_task
      where predecessor_task_id = ${taskId}::uuid
        and status in ('queued', 'dispatching', 'ood')
      union all
      select t.id, t.name, t.repeat_index, t.repeat_count
      from execution_task t
      join later on t.predecessor_task_id = later.id
      where t.status in ('queued', 'dispatching', 'ood')
    )
    update execution_task task
    set status = 'cancelled', terminal_reason = 'previous_stage_stopped',
      finished_at = now(), updated_at = now()
    from later
    where task.id = later.id
    returning later.id::text as id, later.name, later.repeat_index as "repeatIndex",
      later.repeat_count as "repeatCount"
  `
  if (stopped.length === 0) return
  const ids = stopped.map((item) => item.id)
  await sql`
    update execution_task_step
    set status = 'cancelled', finished_at = now()
    where task_id = any(${ids}::uuid[]) and status in ('pending', 'held', 'claimed')
  `
  const because = stageQuote(cause.name, cause.repeatIndex, cause.repeatCount)
  for (const item of stopped) {
    await writeLog(
      sql,
      groupId,
      deviceId,
      "ok",
      `${externalId} ${stageQuote(item.name, item.repeatIndex, item.repeatCount)}已取消，因为${because}未完成`,
    )
  }
}

type ClaimRow = {
  readonly afterMs: number
  readonly apiPort: number
  readonly backupHost: string | null
  readonly chainName: string
  readonly deviceId: string
  readonly dispatchItemId: string | null
  readonly externalId: string
  readonly groupId: string
  readonly guardCode: string | null
  readonly guards: GuardCode[]
  readonly host: string
  readonly indexNum: number | null
  readonly instanceId: string | null
  readonly kind: string
  readonly label: string | null
  readonly needsMail: boolean
  readonly nodeName: string
  readonly parameters: Record<string, string>
  readonly parentStepId: string | null
  readonly phase: string
  readonly role: string
  readonly remark: string
  readonly repeatCount: number
  readonly repeatIndex: number
  readonly rpaPort: number
  readonly sequence: number
  readonly sources: unknown
  readonly stageCount: number
  readonly stagePosition: number
  readonly stepCount: number
  readonly stepId: string
  readonly taskChainId: string | null
  readonly taskChainName: string
  readonly taskId: string
  readonly taskName: string
}

const failStage = async (tx: TransactionSql, row: ClaimRow): Promise<void> => {
  await tx`
    update execution_task_step
    set status = 'failed', finished_at = now(), error_code = 'stage_failed'
    where id = ${row.stepId}::uuid and status = 'pending'`
  await tx`
    update execution_task
    set status = 'failed', updated_at = now(), error_code = 'stage_failed'
    where id = ${row.taskId}::uuid and status in ('queued', 'dispatching')`
}

const stageShareClaim = async (
  tx: TransactionSql,
  row: ClaimRow,
): Promise<
  | { readonly kind: "keep" }
  | { readonly kind: "stop" }
  | { readonly kind: "rewrite"; readonly skill: string }
> => {
  if (row.kind !== stageShareCode) return { kind: "keep" }
  const path = (row.parameters["路径"] ?? "").trim()
  const sourceHost = (row.parameters["源主机"] ?? "").trim()
  if (!stageShareReady(row.parameters)) {
    await failStage(tx, row)
    return { kind: "stop" }
  }
  const source = await tx<{ deviceId: string; groupId: string; sha256: string; size: string }[]>`
    select d.id::text as "deviceId", d.group_id::text as "groupId", e.sha256, e.size_bytes::text as size
    from device d
    left join box_share_entry e on e.device_id = d.id and e.kind = 'file'
      and e.bucket || '/' || e.relative_path = ${path}
    where d.group_id = ${row.groupId}::uuid and d.host = ${sourceHost} and d.enabled
    order by e.sha256 desc nulls last
    limit 1`
  const found = source[0]
  const local = await tx<{ sha256: string }[]>`
    select sha256 from box_share_entry
    where device_id = ${row.deviceId}::uuid and kind = 'file'
      and bucket || '/' || relative_path = ${path}
    limit 1`
  const moveKey = `stage:${row.taskId}:${row.stepId}`
  const move = await tx<{ status: string }[]>`
    select status from execution_task
    where group_id = ${row.groupId}::uuid and idempotency_key = ${moveKey}`
  const action = stageShareAction({
    localHost: row.host,
    localSha: local[0]?.sha256 ?? "",
    moveStatus: move[0]?.status ?? null,
    path,
    size: Number(found?.size ?? 0),
    sourceHost,
    sourceSha: found?.sha256 ?? "",
  })
  if (action.action === "fail") {
    await failStage(tx, row)
    return { kind: "stop" }
  }
  if (action.action === "pull") return { kind: "rewrite", skill: action.skill }
  if (found === undefined) {
    await failStage(tx, row)
    return { kind: "stop" }
  }
  const requester = await tx<{ id: string }[]>`
    select requester_id::text as id from execution_task where id = ${row.taskId}::uuid`
  if (requester[0] === undefined) {
    await failStage(tx, row)
    return { kind: "stop" }
  }
  const input = {
    files: JSON.stringify([
      { bucket: action.bucket, path: action.relative, sha256: action.sha256, size: action.size },
    ]),
    targetDeviceId: row.deviceId,
    targetDirectory: action.targetDirectory,
    targetHost: row.host,
  }
  const taskId = randomUUID()
  const fingerprint = hashToken(moveKey)
  await tx`
    insert into execution_task (
      id, group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters, status
    ) values (
      ${taskId}::uuid, ${found.groupId}::uuid, ${requester[0].id}::uuid, ${found.deviceId}::uuid,
      ${moveKey}, ${fingerprint}, 'MoveShare', 'box-agent', ${tx.json([{ input, skill: "MoveShare" }])}, 'queued'
    ) on conflict (group_id, idempotency_key) do nothing`
  await tx`
    insert into execution_task_step (
      id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters, status, guards, after_ms
    )
    select ${randomUUID()}::uuid, t.id, t.group_id, 0, ${`${moveKey}:0`}, ${fingerprint},
      'MoveShare', ${tx.json({ indexNum: 0 })}, ${tx.json(input)}, 'pending', ${tx.json([])}, 0
    from execution_task t
    where t.group_id = ${found.groupId}::uuid and t.idempotency_key = ${moveKey}
      and not exists (select 1 from execution_task_step s where s.task_id = t.id)`
  await tx`select pg_notify('agent_task', ${found.deviceId})`
  return { kind: "stop" }
}

const claimPending = async (sql: Sql, deviceId: string): Promise<boolean> => {
  const rows = await sql`
    select id from execution_task
    where device_id = ${deviceId}::uuid
      and executor_key = 'box-agent'
      and status in ('queued', 'dispatching', 'ood')
      and cancel_requested_at is null
    limit 1`
  return rows.length > 0
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
        select t.id as "taskId", t.group_id as "groupId", t.name as "taskName",
          coalesce(t.chain_name, '') as "chainName",
          t.task_chain_id::text as "taskChainId",
          t.dispatch_item_id::text as "dispatchItemId",
          coalesce(tc.name, '') as "taskChainName",
          t.stage_position as "stagePosition", t.stage_count as "stageCount",
          (select count(*)::int from execution_task_step counted where counted.task_id = t.id) as "stepCount",
          exists (
            select 1 from execution_task_step mail_step
            where mail_step.task_id = t.id and mail_step.kind = 'FetchMailCode'
          ) as "needsMail",
          t.repeat_index as "repeatIndex", t.repeat_count as "repeatCount",
          s.id as "stepId", s.kind, s.sequence,
          coalesce(s.remark, '') as remark, coalesce(s.node_name, '') as "nodeName",
          s.parameters, s.after_ms as "afterMs", s.instance_id as "instanceId", s.guards, s.phase, s.role,
          s.guard_code as "guardCode", s.parent_step_id::text as "parentStepId",
          d.id::text as "deviceId", d.external_id as "externalId", d.host,
           coalesce(di.instance_index, (s.target->>'indexNum')::int) as "indexNum", coalesce(di.api_port, 0) as "apiPort",
          coalesce(di.rpa_port, 0) as "rpaPort", di.label,
          coalesce(
            (
              select ds.sources from operation_dispatch_step ds
              where t.dispatch_item_id is not null
                and ds.item_id = t.dispatch_item_id
                and ds.stage_position = t.stage_position
                and ds.repeat_index = t.repeat_index
                and ds.sequence = s.sequence
              limit 1
            ),
            (
              select ds.sources from operation_dispatch_item item
              join operation_dispatch_step ds on ds.item_id = item.id and ds.sequence = s.sequence
              where item.execution_task_id = t.id
              limit 1
            )
          ) as sources,
          (
            select backup.host from operation_account account
            left join device backup on backup.id = account.backup_device_id
            where account.id = t.account_id
          ) as "backupHost"
        from execution_task t
        join execution_task_step s on s.task_id = t.id and s.group_id = t.group_id
        join device d on d.id = t.device_id
        left join task_chain tc on tc.id = t.task_chain_id
        left join device_instance di on di.id = s.instance_id
        where d.id = ${device.deviceId}::uuid
          and t.status in ('queued', 'dispatching', 'ood')
          and t.executor_key = 'box-agent' and t.cancel_requested_at is null
          and (
            t.predecessor_task_id is null
            or exists (
              select 1 from execution_task previous
              where previous.id = t.predecessor_task_id and previous.status = 'succeeded'
            )
          )
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
              and not (
                s.kind in ('ScanShare', 'MoveShare', 'TransferShare', 'ListNas', 'MoveShareToNas', 'DeleteNasShare', 'DeleteNasDir') and l.instance_id is not null
              )
              and not (
                s.instance_id is not null
                and exists (
                  select 1 from execution_task_step box_step
                  where box_step.task_id = l.task_id
                    and box_step.kind in ('ScanShare', 'MoveShare', 'TransferShare', 'ListNas', 'MoveShareToNas', 'DeleteNasShare', 'DeleteNasDir')
                )
              )
          )
          and not (
            s.kind = 'StageShare'
            and exists (
              select 1 from execution_task move
              where move.group_id = t.group_id
                and move.idempotency_key = 'stage:' || t.id::text || ':' || s.id::text
                and move.status in ('queued', 'dispatching', 'running')
            )
          )
        order by t.queue_priority desc, t.created_at, t.stage_position, t.repeat_index, t.id
        for update of t skip locked
        limit 1
      `
      const row = rows[0]
      if (row === undefined) return null
      const staged = await stageShareClaim(tx, row)
      if (staged.kind === "stop") return null
      const claimKind = staged.kind === "rewrite" ? staged.skill : row.kind
      const refreshed = refreshDeviceHosts(row.parameters ?? {}, row.sources, {
        backupHost: row.backupHost ?? "",
        deviceHost: row.host,
      })
      const parameters = { ...refreshed.parameters }
      if (row.kind === transferShareCode) {
        const targetHost = (parameters["目标主机"] ?? "").trim()
        const found = await tx<{ id: string }[]>`
          select dest.id::text as id
          from device dest
          join device source on source.id = ${device.deviceId}::uuid
          where dest.host = ${targetHost}
            and dest.enabled and not dest.assignment_pending
            and dest.group_id <> ${unassignedGroup}::uuid
            and dest.assignee_user_id = source.assignee_user_id
        `
        parameters["目标盒子"] = found[0]?.id ?? ""
      }
      if (refreshed.changed || parameters["目标盒子"] !== refreshed.parameters["目标盒子"]) {
        await tx`
          update execution_task_step set parameters = ${tx.json(parameters)}
          where id = ${row.stepId}::uuid
        `
      }
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
          1, 'claimed', ${device.externalId}, ${lease}, now() + interval '90 seconds', now()
        )
      `
      await tx`
        insert into execution_task_device_lease (
          id, task_id, group_id, device_id, instance_id, lease_token, worker_id, expires_at, heartbeat_at
        ) values (
          ${randomUUID()}::uuid, ${row.taskId}::uuid, ${row.groupId}::uuid, ${device.deviceId}::uuid,
          ${row.instanceId}::uuid, ${lease}, ${device.externalId}, now() + interval '90 seconds', now()
        )
      `
      const earlier = await tx<{ n: number }[]>`
        select count(*)::int as n from execution_task_step
        where task_id = ${row.taskId}::uuid and id <> ${row.stepId}::uuid and status <> 'pending'
      `
      if ((earlier[0]?.n ?? 0) === 0) {
        await writeLog(tx, row.groupId, row.deviceId, "info", claimLogText(row))
      }
      return { ...row, kind: claimKind, parameters }
    })
  } catch (error) {
    if (isUniqueViolation(error)) return null
    throw error
  }
}

const claimTitle = (row: ClaimRow): string => {
  const total = row.stepCount > 0 ? row.stepCount : row.sequence + 1
  const label = skillByCode.get(row.kind)?.name ?? row.kind
  return `${row.taskName} 第 ${row.sequence + 1}/${total} 步 ${label}`
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
  name: claimTitle(row),
  parentStepId: row.parentStepId ?? "",
  phase: row.phase || "skill",
  needsMail: row.needsMail,
  repeatCount: row.repeatCount,
  repeatIndex: row.repeatIndex + 1,
  role: row.role || "native",
  stepOrdinal: row.sequence + 1,
  stepTotal: row.stepCount,
  stageCount: row.stageCount,
  stagePosition: row.stagePosition + 1,
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
        ...claimedSkillStep(row.kind, row.parameters),
        ...(() => {
          const logTitle = stepLogTitle({
            chainName: row.chainName ?? "",
            dispatchItemId: row.dispatchItemId,
            nodeName: row.nodeName ?? "",
            remark: row.remark ?? "",
            skill: row.kind,
            taskChainId: row.taskChainId,
            taskChainName: row.taskChainName ?? "",
            taskName: row.taskName,
          })
          return logTitle.length > 0 ? { logTitle } : {}
        })(),
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
  replayFailedStage: (groupId: string, taskId: string) => Promise<void> = async () => undefined,
  cipher?: SecretCipher,
) => {
  registerBusinessLabels(app, sql, authService, auditRepository)
  registerTaskChains(app, sql, userFromRequest)
  const frames = new Map<string, FrameHit>()
  const waiters = new Map<string, Set<() => void>>()
  const wake = (deviceId: string): void => {
    const list = waiters.get(deviceId)
    waiters.delete(deviceId)
    for (const fn of list ?? []) fn()
  }
  registerShareFiles(app, sql, wake)
  registerNasAgentRoutes(app, sql, cipher, createPostgresStorageRepository(sql))
  const listen = postgres(databaseUrl, { max: 1 })
  let stopping = false
  const listening = listen.listen("agent_task", wake)
  void listening.catch(() => {
    console.error("agent_task listen failed")
  })
  const holder = presenceHolder()
  const cleanup = setInterval(() => {
    const now = Date.now()
    for (const [key, frame] of frames) if (now - frame.at > 15000) frames.delete(key)
    void sql`delete from device_watch where expires_at < now()`.catch((error: unknown) => {
      console.error("device watch cleanup failed", sqlState(error))
    })
    void (async () => {
      if (!(await tryAcquirePresenceLease(sql, holder))) return
      await markBoxesWithoutHeartbeat(sql)
    })().catch((error: unknown) => {
      console.error("box presence update failed", sqlState(error))
    })
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
  registerMailCode(app, sql, cipher)
  app.use("/api/*", async (context, next) => {
    const path = context.req.path
    let pages: readonly string[] = []
    if (
      path === "/api/skills" ||
      path === "/api/behavior-anchors" ||
      path.startsWith("/api/behavior-chains")
    )
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
    await sql`
      update box_share_entry set box_online = (
        select status = 'online' and enabled from device where id = ${device.deviceId}::uuid
      )
      where device_id = ${device.deviceId}::uuid
    `
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
      slotsFresh?: boolean
    } | null
    const boxId = body?.boxId ?? ""
    const device = token === "" || boxId === "" ? null : await agentDevice(sql, token, boxId)
    if (device === null) return context.body(null, 401)
    const facts = body?.box ?? {}
    const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "")
    const hostPort = (value: unknown): number => {
      const parsed = Number(value ?? 0)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return 0
      return parsed
    }
    const diskPct = Number(facts.diskPct ?? 0)
    const reportedPct = Number.isFinite(diskPct) && diskPct > 0 ? Math.round(diskPct) : 0
    const fileBrowserUrl = text(body?.fileBrowserUrl)
    const model = text(facts.model)
    const version = text(facts.version)
    const firmware = text(facts.firmware)
    const memory = text(facts.memory)
    const disk = text(facts.disk)
    await sql`
      with agent as (
        update device_agent set
          last_heartbeat_at = now(),
          file_browser_url = case when ${fileBrowserUrl} <> '' then ${fileBrowserUrl} else file_browser_url end
        where device_id = ${device.deviceId}::uuid
        returning device_id, last_heartbeat_at
      ), dev as (
        update device d set
          status = 'online',
          last_seen_at = agent.last_heartbeat_at,
          updated_at = agent.last_heartbeat_at,
          model = case when ${model} <> '' then ${model} else d.model end,
          version = case when ${version} <> '' then ${version} else d.version end,
          firmware = case when ${firmware} <> '' then ${firmware} else d.firmware end,
          memory = case when ${memory} <> '' then ${memory} else d.memory end,
          disk = case when ${disk} <> '' then ${disk} else d.disk end,
          disk_pct = case when ${reportedPct} > 0 then ${reportedPct} else d.disk_pct end
        from agent
        where d.id = agent.device_id
        returning d.id, d.status, d.enabled
      )
      update box_share_entry e
      set box_online = (dev.status = 'online' and dev.enabled)
      from dev
      where e.device_id = dev.id
    `
    await sql`
      update execution_task_device_lease
      set expires_at = now() + interval '90 seconds', heartbeat_at = now()
      where device_id = ${device.deviceId}::uuid and released_at is null and expires_at > now()
    `
    await sql`
      update execution_task_run
      set claim_expires_at = now() + interval '90 seconds', heartbeat_at = now()
      where finished_at is null and status in ('claimed', 'running') and claim_expires_at > now()
        and task_id in (select id from execution_task where device_id = ${device.deviceId}::uuid)
    `
    const slots = body?.slots
    const stale = Array.isArray(slots) && slots.some((slot) => slot["stale"] === true)
    if (body?.slotsFresh === true && !stale && Array.isArray(slots)) {
      const reported: number[] = []
      for (const slot of slots) {
        if (slot["stale"] === true) continue
        const index = Number(slot["indexNum"] ?? 0)
        if (index < 1 || index > 5) continue
        reported.push(index)
        const running = String(slot["status"] ?? "") === "running"
        const webrtcTcp = hostPort(slot["webrtcTcp"])
        const webrtcUdp = hostPort(slot["webrtcUdp"])
        await sql`
          insert into device_instance (
            id, device_id, instance_index, label, enabled, status, container_id,
            api_port, rpa_port, webrtc_tcp, webrtc_udp, width, height
          )
          values (
            ${randomUUID()}::uuid, ${device.deviceId}::uuid, ${index}, ${String(slot["name"] ?? "")}, true,
            ${running ? "online" : "offline"}, ${String(slot["id"] ?? "")}, ${Number(slot["apiPort"] ?? 0)},
            ${Number(slot["rpaPort"] ?? 0)}, ${webrtcTcp}, ${webrtcUdp},
            ${String(slot["width"] ?? "")}, ${String(slot["height"] ?? "")}
          )
          on conflict (device_id, instance_index) do update set
            label = excluded.label,
            enabled = true,
            status = excluded.status,
            container_id = excluded.container_id,
            api_port = excluded.api_port,
            rpa_port = excluded.rpa_port,
            webrtc_tcp = excluded.webrtc_tcp,
            webrtc_udp = excluded.webrtc_udp,
            width = excluded.width,
            height = excluded.height,
            updated_at = now()
        `
      }
      await sql`
        update device_instance
        set label = '', status = 'unknown', container_id = '', api_port = 0, rpa_port = 0,
          width = '', height = '', updated_at = now()
        where device_id = ${device.deviceId}::uuid
          and instance_index between 1 and 5
          and not (instance_index = any(${reported}::int[]))
          and not (label = '' and status = 'unknown' and container_id = '')
      `
    }
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
    if (await claimPending(sql, device.deviceId)) {
      const first = await claimOnce(sql, device)
      if (first !== null) return context.json(taskPointer(first))
    }
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
      if (await claimPending(sql, device.deviceId)) {
        const second = await claimOnce(sql, device)
        if (second !== null) return context.json(taskPointer(second))
      }
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
        accountId: string | null
        chainName: string
        deviceId: string
        dispatchItemId: string | null
        externalId: string
        groupId: string
        kind: string
        nodeName: string
        parameters: Record<string, string> | null
        parentStepId: string | null
        remark: string
        repeatCount: number
        repeatIndex: number
        role: string
        sequence: number
        stepId: string
        taskChainId: string | null
        taskChainName: string
        taskName: string
      }[]
    >`
      select d.id as "deviceId", d.external_id as "externalId", t.group_id as "groupId", t.name as "taskName",
        coalesce(t.chain_name, '') as "chainName",
        t.task_chain_id::text as "taskChainId",
        t.dispatch_item_id::text as "dispatchItemId",
        coalesce(tc.name, '') as "taskChainName",
        t.account_id::text as "accountId",
        t.repeat_index as "repeatIndex", t.repeat_count as "repeatCount",
        s.kind, s.id as "stepId",
        coalesce(s.remark, '') as remark, coalesce(s.node_name, '') as "nodeName",
        s.sequence, s.parameters, s.role, s.parent_step_id::text as "parentStepId"
      from execution_task t
      join device d on d.id = t.device_id
      join device_agent a on a.device_id = d.id
      join execution_task_step s on s.task_id = t.id and s.status in ('claimed', 'running')
      left join task_chain tc on tc.id = t.task_chain_id
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
    const logTitle = stepLogTitle({
      chainName: row.chainName ?? "",
      dispatchItemId: row.dispatchItemId,
      nodeName: row.nodeName ?? "",
      remark: row.remark ?? "",
      skill: row.kind,
      taskChainId: row.taskChainId,
      taskChainName: row.taskChainName ?? "",
      taskName: row.taskName,
    })
    if (status === "succeeded" || status === "failed" || status === "cancelled") {
      const stepStatus = status
      const outputs = stripNull(body?.checkpoint?.outputs ?? {}) as Record<string, string>
      const outcome = await sql.begin(async (tx) => {
        // Match claim/synchronization lock order before writing device-linked history.
        await tx`select id from device where id = ${row.deviceId}::uuid for update`
        await tx`select id from execution_task where id = ${taskId}::uuid for update`
        const finish = async (value: "failed" | "cancelled" | "continue" | "done", detail = "") => {
          await tx`select pg_notify('agent_task', ${row.deviceId})`
          const quoted = stageQuote(row.taskName, row.repeatIndex, row.repeatCount)
          await writeLog(
            tx,
            row.groupId,
            row.deviceId,
            value === "failed" ? "error" : "ok",
            detail.length > 0 ? `${row.externalId} ${quoted}${detail}` : progressLogText(row, value, logTitle),
          )
          if (value === "failed" || value === "cancelled") {
            await cancelLaterStages(tx, taskId, row.groupId, row.deviceId, row.externalId, {
              name: row.taskName,
              repeatCount: row.repeatCount,
              repeatIndex: row.repeatIndex,
            })
          }
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
        const liveSteps = jumpStepCount(row.parameters?.["steps"])
        const liveSequence = Number(row.sequence)
        const liveFailureJump =
          status === "failed" &&
          row.kind === "CheckLive" &&
          jumpWhenMode(row.parameters?.["jumpWhen"], "off") === "failure" &&
          liveSteps !== null &&
          liveSteps > 0 &&
          Number.isInteger(liveSequence)
        if ((status === "failed" || status === "cancelled") && !liveFailureJump) {
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
        if (liveFailureJump && liveSteps !== null) {
          const skipped = await skipLaterSteps(tx, taskId, row.stepId, liveSequence, liveSteps)
          if (skipped > 0) {
            await writeLog(
              tx,
              row.groupId,
              row.deviceId,
              "ok",
              `${row.externalId} 存活检测失败，跳过 ${skipped} 步`,
            )
          }
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
        const clickPassed = row.kind === "ClickJumpNodes" && clickJumpPassed(outputs["passed"])
        const foundCount =
          nodeJumpKind(row.kind) && !clickPassed ? jumpFoundCount(outputs["count"]) : null
        if (status === "succeeded" && nodeJumpKind(row.kind) && !clickPassed) {
          await writeJumpAccount(tx, row, outputs["count"], logTitle)
        }
        if (status === "succeeded" && row.kind === "ExportAndroidContainer") {
          await writeBackupName(tx, row, outputs["exportName"] ?? "")
        }
        if (
          status === "succeeded" &&
          row.kind === "FetchMailCode" &&
          /^[0-9]{6}$/.test(outputs["code"] ?? "")
        ) {
          await completeFollowingText(tx, taskId, Number(row.sequence), outputs["code"] ?? "")
        }
        if (
          status === "succeeded" &&
          !clickPassed &&
          (nodeJumpKind(row.kind) || row.kind === "CheckLive")
        ) {
          const found = foundCount ?? Number(outputs["count"] ?? "")
          const when = jumpWhenMode(
            row.parameters?.["jumpWhen"],
            row.kind === "CheckLive" ? "off" : "success",
          )
          const steps = jumpStepCount(row.parameters?.["steps"])
          const sequence = Number(row.sequence)
          const should =
            when !== null &&
            (row.kind === "CheckLive"
              ? statusShouldJump(true, when)
              : jumpNodesShouldSkip(found, when))
          if (should && steps !== null && steps > 0 && Number.isInteger(sequence)) {
            const skipped = await skipLaterSteps(tx, taskId, row.stepId, sequence, steps)
            if (skipped > 0) {
              const verb = when === "failure" ? "未命中" : "命中"
              const text =
                row.kind === "CheckLive"
                  ? `${row.externalId} 存活检测成功，跳过 ${skipped} 步`
                  : logTitle.length > 0
                    ? `${row.externalId} ${logTitle} ${verb}，跳过 ${skipped} 步`
                    : `${row.externalId} ${row.kind === "ClickJumpNodes" ? "点击节点跳跃" : "节点跳跃"}${verb}，跳过 ${skipped} 步`
              await writeLog(tx, row.groupId, row.deviceId, "ok", text)
            }
          }
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
      if (outcome === "failed") {
        try {
          await replayFailedStage(row.groupId, taskId)
        } catch (error) {
          console.error("stage auto replay failed", error)
        }
      }
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
            role, phase, guards, guard_code, guard_index, parent_step_id, instance_id, node_name
          ) values (
            ${insertedId}::uuid, ${taskId}::uuid, ${step.groupId}::uuid, ${step.sequence + 1},
            ${`${taskId}:ood:${insertedId}`}, ${insertedId}, 'ClickNode', ${tx.json(z.json().parse(step.target ?? {}))}, ${tx.json(input)}, 'pending',
            'ood', 'skill', ${tx.json([])}, ${code}, 0, ${step.id}::uuid, ${step.instanceId}::uuid, ${skillNodeName("ClickNode")}
          )
        `
      } else {
        await tx`
          insert into execution_task_step (
            id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters, status,
            role, phase, guards, guard_code, guard_index, parent_step_id, node_name
          ) values (
            ${insertedId}::uuid, ${taskId}::uuid, ${step.groupId}::uuid, ${step.sequence + 1},
            ${`${taskId}:ood:${insertedId}`}, ${insertedId}, 'ClickNode', ${tx.json(z.json().parse(step.target ?? {}))}, ${tx.json(input)}, 'pending',
            'ood', 'skill', ${tx.json([])}, ${code}, 0, ${step.id}::uuid, ${skillNodeName("ClickNode")}
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
    const incoming = context.req.raw.body
    if (!Number.isInteger(index) || index < 1 || index > 5) {
      await readFrameBody(incoming)
      return context.json({ error: "invalid_index" }, 400)
    }
    const device = token === "" || boxId === "" ? null : await agentDevice(sql, token, boxId)
    if (device === null) {
      await readFrameBody(incoming)
      return context.body(null, 401)
    }
    const read = await readFrameBody(incoming)
    if (read.kind === "overflow") return context.body(null, 204)
    const watching = await sql<{ n: number }[]>`
      select count(*)::int as n from device_watch
      where device_id = ${device.deviceId}::uuid and instance_index = ${index} and expires_at > now()
    `
    if ((watching[0]?.n ?? 0) === 0 || read.kind !== "bytes") return context.body(null, 204)
    frames.set(`${device.deviceId}#${index}`, {
      at: Date.now(),
      bytes: read.bytes,
      groupId: device.groupId,
    })
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
        d.sequence_no as "sequenceNo", g.id as "boxGroupId", g.name as "boxGroupName",
        coalesce((
          select json_agg(json_build_object('id', r.id, 'name', r.name) order by r.name)
          from device_remark dr
          join box_remark r on r.id = dr.label_id
          where dr.device_id = d.id
        ), '[]'::json) as remarks
      from device d
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
    const id = context.req.param("id")
    return sql.begin(async (tx) => {
      const identity = await tx<{ name: string }[]>`
        select name from business_label where scope = 'device' and kind = 'remark'
          and id = ${id}::uuid and administrator_id = ${administratorId}::uuid`
      if (identity[0] === undefined) return context.json({ error: "not_found" }, 404)
      await lockBusinessLabel(tx, administratorId, "device", "remark", identity[0].name)
      const rows = await tx<{ name: string }[]>`
        select name from business_label where scope = 'device' and kind = 'remark'
          and id = ${id}::uuid and administrator_id = ${administratorId}::uuid for update`
      if (rows[0] === undefined) return context.json({ error: "not_found" }, 404)
      const used = await tx`select 1 from device_remark where label_id = ${id}::uuid limit 1`
      if (used.length > 0) return context.json({ error: "label_in_use" }, 409)
      await tx`delete from business_label where id = ${id}::uuid`
      return context.body(null, 204)
    })
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
      const used =
        await tx`select 1 from device where box_group_id = ${context.req.param("id")}::uuid limit 1`
      if (
        used.length > 0 ||
        (await businessGroupInUse(tx, administratorId, "device", rows[0].name))
      )
        return context.json({ error: "label_in_use" }, 409)
      await tx`delete from business_label where id = ${context.req.param("id")}::uuid`
      return context.body(null, 204)
    })
  })

  app.post("/api/devices/labels", async (context) => {
    try {
      return await sql.begin(async (sql) => {
        const user = await userFromRequest(sql, context.req.raw)
        if (user === null) return context.json({ error: "authentication_required" }, 401)
        const administratorId = await administratorFor(sql, user)
        const body = (await context.req.json().catch(() => null)) as {
          boxGroupId?: string | null
          deviceIds?: string[]
          remarkId?: string | null
          remarkIds?: string[]
          remarkMode?: "add" | "replace"
          sequenceNo?: number | null
        } | null
        const deviceIds = body?.deviceIds ?? []
        if (administratorId === null || deviceIds.length === 0 || body === null)
          return context.json({ error: "invalid_label" }, 400)
        const setsRemarkIds = Object.hasOwn(body, "remarkIds")
        const setsRemarkId = Object.hasOwn(body, "remarkId")
        const remarkIds = setsRemarkIds
          ? (body.remarkIds ?? [])
          : setsRemarkId
            ? body.remarkId === null || body.remarkId === undefined
              ? []
              : [body.remarkId]
            : undefined
        const remarkMode = body.remarkMode === "add" && setsRemarkIds ? "add" : "replace"
        const setsGroup = Object.hasOwn(body, "boxGroupId")
        const setsSequence = Object.hasOwn(body, "sequenceNo")
        const sequenceNo = body.sequenceNo ?? null
        if (
          setsSequence &&
          body.sequenceNo !== null &&
          (typeof body.sequenceNo !== "number" ||
            !Number.isInteger(body.sequenceNo) ||
            body.sequenceNo < 1 ||
            body.sequenceNo > 999)
        )
          return context.json({ error: "invalid_label" }, 400)
        if (remarkIds !== undefined && remarkIds.length > 0) {
          const found = await sql<{ id: string }[]>`
          select id from box_remark
          where administrator_id = ${administratorId}::uuid and id = any(${remarkIds}::uuid[])`
          if (found.length !== new Set(remarkIds).size)
            return context.json({ error: "not_found" }, 404)
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
        if (remarkIds !== undefined && remarkMode === "replace") {
          await sql`delete from device_remark where device_id = any(${deviceIds}::uuid[])`
        }
        if (remarkIds !== undefined && remarkIds.length > 0) {
          await sql`
          insert into device_remark (device_id, label_id)
          select device_id, label_id
          from unnest(${deviceIds}::uuid[]) as device_id
          cross join unnest(${remarkIds}::uuid[]) as label_id
          on conflict do nothing
        `
        }
        if (remarkIds !== undefined && (remarkMode === "replace" || remarkIds.length > 0)) {
          await sql`update device set updated_at = now() where id = any(${deviceIds}::uuid[])`
        }
        if (setsGroup) {
          await sql`
        update device set box_group_id = ${body.boxGroupId ?? null}::uuid, updated_at = now()
        where id = any(${deviceIds}::uuid[])
      `
        }
        if (setsSequence) {
          if (sequenceNo !== null && deviceIds.length > 1)
            return context.json({ error: "duplicate_sequence" }, 409)
          if (sequenceNo !== null) {
            const taken = await sql`
            select id from device
            where assignee_user_id = ${administratorId}::uuid
              and sequence_no = ${sequenceNo}::integer
              and not (id = any(${deviceIds}::uuid[]))
            limit 1
          `
            if (taken.length > 0) return context.json({ error: "duplicate_sequence" }, 409)
          }
          await sql`
          update device set sequence_no = ${sequenceNo}::integer, updated_at = now()
          where id = any(${deviceIds}::uuid[])
        `
        }
        return context.json({ ok: true })
      })
    } catch (error) {
      if (isUniqueViolation(error)) return context.json({ error: "duplicate_sequence" }, 409)
      throw error
    }
  })

  app.get("/api/devices/:deviceId/slots", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    const device =
      user === null ? null : await ownedDevice(sql, user, context.req.param("deviceId"))
    if (device === null) return context.json({ error: "not_found" }, 404)
    const includeEmpty = context.req.query("includeEmpty") === "1"
    const rows = await sql`
      select di.instance_index as index, di.label, di.status, di.width, di.height, di.api_port as "apiPort", di.rpa_port as "rpaPort",
        di.webrtc_tcp as "webrtcTcp", di.webrtc_udp as "webrtcUdp",
        d.host, coalesce(da.file_browser_url, '') as "fileBrowserUrl",
        exists (
          select 1 from execution_task_device_lease l
          where l.instance_id = di.id and l.released_at is null and l.expires_at > now()
        ) as busy
      from device_instance di
      join device d on d.id = di.device_id
      left join device_agent da on da.device_id = d.id
      where di.device_id = ${device.deviceId}::uuid
        and (
          ${includeEmpty}::boolean
          or not (di.label = '' and di.status = 'unknown' and di.container_id = '')
        )
      order by di.instance_index
    `
    return context.json(
      rows.map((row) => {
        const host = String(row["host"] ?? "")
        const current = fileBrowserFromHost(host)
        return { ...row, fileBrowserUrl: current.length > 0 ? current : row["fileBrowserUrl"] }
      }),
    )
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
        chainName?: unknown
        deviceId?: string
        indexNum?: number
        steps?: ReadonlyArray<{
          afterMs?: unknown
          guards?: unknown
          input?: Record<string, string>
          remark?: unknown
          scopes?: unknown
          skill?: string
          sources?: unknown
        }>
      }
      const named = readChainName(body?.chainName)
      if (!named.ok) return context.json({ error: named.error }, 400)
      const remarks = (body?.steps ?? []).map((step) => readRemark(step.remark))
      const rejectedRemark = remarks.find((item) => !item.ok)
      if (rejectedRemark !== undefined && !rejectedRemark.ok) {
        return context.json({ error: rejectedRemark.error }, 400)
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
        steps.some((step) => !skillByCode.has(step.skill ?? "")) ||
        mixedBatchRejected(steps.map((step) => step.skill ?? ""))
      ) {
        return context.json({ error: "skill_rejected" }, 400)
      }
      if (
        steps.some(
          (step) =>
            (isSharedVideoSkill(step.skill ?? "") &&
              sharedVideoCommand(step.skill ?? "", step.input ?? {}) === null) ||
            (isCatalogPullSkill(step.skill ?? "") &&
              sharedPullCommand(step.skill ?? "", step.input ?? {}) === null) ||
            (step.skill === transferShareCode && !transferShareReady(step.input ?? {})) ||
            (step.skill === stageShareCode && !stageShareReady(step.input ?? {})),
        )
      ) {
        return context.json({ error: "video_path_rejected" }, 400)
      }
      if (
        steps.some(
          (step) =>
            (nodeJumpKind(step.skill ?? "") && !jumpNodesReady(step.input)) ||
            (step.skill === "ClickJumpNodes" && !clickChanceReady(step.input?.["clickChance"])) ||
            (step.skill === "CheckLive" && !checkLiveReady(step.input)),
        )
      ) {
        return context.json({ error: "skill_rejected" }, 400)
      }
      const prepared = steps.map((step) => {
        const input = step.input ?? {}
        const skill = step.skill ?? ""
        if (
          step.scopes !== undefined &&
          (step.scopes === null || typeof step.scopes !== "object" || Array.isArray(step.scopes))
        ) {
          return null
        }
        const rawScopes = (step.scopes ?? {}) as Record<string, unknown>
        const scopes: Record<string, "external" | "internal"> = {}
        for (const key of Object.keys(input)) {
          scopes[key] = rawScopes[key] === "external" ? "external" : "internal"
        }
        const sources = readStepSources(input, scopes, step.sources, null, skill)
        if (sources === null) return null
        return { input, scopes, skill, sources }
      })
      if (prepared.some((item) => item === null)) return context.json({ error: "skill_rejected" }, 400)
      if (
        prepared.some(
          (item) =>
            item !== null &&
            item.skill === "ClickJumpNodes" &&
            item.scopes.clickChance === "external" &&
            item.sources.clickChance === "chance.external",
        )
      ) {
        return context.json({ error: "没有外部概率" }, 400)
      }
      if (
        prepared.some(
          (item) =>
            item !== null &&
            item.skill === "SendText" &&
            item.scopes.text === "external" &&
            item.sources.text === "pool.text",
        )
      ) {
        return context.json({ error: "没有文本池" }, 400)
      }
      const parameters = prepared.flatMap((item) =>
        item === null ? [] : [{ input: item.input, scopes: item.scopes, skill: item.skill, sources: item.sources }],
      )
      const indexNum = Number(body?.indexNum ?? 0)
      const hash = hashToken(
        fingerprint({
          chainName: named.name,
          deviceId: device.deviceId,
          delays,
          guards,
          indexNum,
          parameters,
          remarks: remarks.map((item) => (item.ok ? item.remark : "")),
        }),
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
          id, group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters, status, chain_name
        ) values (
           ${taskId}::uuid, ${device.groupId}::uuid, ${user}::uuid, ${device.deviceId}::uuid, ${key}, ${hash},
          ${steps[0]?.skill ?? "task"}, 'box-agent', ${tx.json(parameters)}, 'queued', ${named.name}
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
          const noted = remarks[sequence]
          const remark = noted !== undefined && noted.ok ? noted.remark : ""
          if (instanceId === undefined) {
            await tx`
            insert into execution_task_step (
              id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters, status, guards, after_ms, remark, node_name
            ) values (
              ${randomUUID()}, ${taskId}, ${device.groupId}, ${sequence}, ${`${key}:${sequence}`}, ${key},
              ${step.skill ?? ""}, ${tx.json({ indexNum })}, ${tx.json(step.input ?? {})}, 'pending', ${tx.json(guards[sequence] ?? [])}, ${delays[sequence] ?? 0},
              ${remark}, ${skillNodeName(step.skill ?? "")}
            )
          `
          } else {
            await tx`
            insert into execution_task_step (
              id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters, status, instance_id, guards, after_ms, remark, node_name
            ) values (
              ${randomUUID()}, ${taskId}, ${device.groupId}, ${sequence}, ${`${key}:${sequence}`}, ${key},
              ${step.skill ?? ""}, ${tx.json({ indexNum })}, ${tx.json(step.input ?? {})}, 'pending', ${instanceId}, ${tx.json(guards[sequence] ?? [])}, ${delays[sequence] ?? 0},
              ${remark}, ${skillNodeName(step.skill ?? "")}
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

  app.get("/api/behavior-anchors", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    return context.json(accountAnchorCatalog)
  })

  app.get("/api/behavior-chains", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    if (administratorId === null) return context.json([])
    const rows = await sql<ChainRow[]>`
      select ${sql.unsafe(chainColumns)}
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
    let body: { anchor?: unknown; name?: unknown; origin?: unknown; steps?: unknown }
    try {
      body = await context.req.json()
    } catch {
      return context.json({ error: "invalid_chain" }, 400)
    }
    const name = typeof body.name === "string" ? body.name.trim() : ""
    const origin = body.origin === "ai" ? "ai" : body.origin === "rpa" ? "rpa" : ""
    const anchor = readAnchor(body.anchor)
    if (anchor === "invalid") return context.json({ error: "invalid_chain" }, 400)
    const packed =
      Array.isArray(body.steps) && body.steps.length === 0
        ? {
            ok: true as const,
            delays: [] as number[],
            guards: [] as GuardCode[][],
            parameters: [] as ChainParameter[],
            paramScopes: [] as ChainScope[],
            paramSources: [] as ChainSource[],
            remarks: [] as string[],
          }
        : readChainSteps(body.steps, anchor)
    if (name.length === 0 || name.length > 80 || origin === "") {
      return context.json({ error: "invalid_chain" }, 400)
    }
    if (!packed.ok) return context.json({ error: packed.error }, 400)
    const taken = await sql<{ id: string }[]>`
      select id::text as id from behavior_chain
      where administrator_id = ${administratorId}::uuid and name = ${name}
      limit 1
    `
    if (taken.length > 0) return context.json({ error: "chain_name_taken" }, 409)
    const rows = await sql<ChainRow[]>`
      insert into behavior_chain (
        group_id, administrator_id, created_by, name, origin, executor_key, parameters, param_scopes,
        param_sources, anchor_table, anchor_key, guards, delays, remarks
      ) values (
        ${groupId}::uuid, ${administratorId}::uuid, ${user}::uuid, ${name}, ${origin}, 'box-agent',
        ${sql.json(packed.parameters)}, ${sql.json(packed.paramScopes)}, ${sql.json(packed.paramSources)},
        ${anchor?.table ?? ""}, ${anchor?.key ?? ""}, ${sql.json(packed.guards)}, ${sql.json(packed.delays)},
        ${packed.remarks}::text[]
      )
      returning ${sql.unsafe(chainColumns)}
    `
    const row = rows[0]
    if (row === undefined) return context.json({ error: "invalid_chain" }, 400)
    return context.json(chainView(row), 201)
  })

  app.put("/api/behavior-chains/:id", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const id = context.req.param("id")
    if (administratorId === null || !isUuid(id)) return context.json({ error: "not_found" }, 404)
    let body: { anchor?: unknown; name?: unknown; steps?: unknown }
    try {
      body = await context.req.json()
    } catch {
      return context.json({ error: "invalid_chain" }, 400)
    }
    const name = typeof body.name === "string" ? body.name.trim() : ""
    const anchor = readAnchor(body.anchor)
    if (anchor === "invalid") return context.json({ error: "invalid_chain" }, 400)
    const packed = readChainSteps(body.steps, anchor)
    if (name.length === 0 || name.length > 80) return context.json({ error: "invalid_chain" }, 400)
    if (!packed.ok) return context.json({ error: packed.error }, 400)
    const taken = await sql<{ id: string }[]>`
      select id::text as id from behavior_chain
      where administrator_id = ${administratorId}::uuid and name = ${name} and id <> ${id}::uuid
      limit 1
    `
    if (taken.length > 0) return context.json({ error: "chain_name_taken" }, 409)
    const rows = await sql<ChainRow[]>`
      update behavior_chain
      set name = ${name},
        parameters = ${sql.json(packed.parameters)},
        param_scopes = ${sql.json(packed.paramScopes)},
        param_sources = ${sql.json(packed.paramSources)},
        anchor_table = ${anchor?.table ?? ""},
        anchor_key = ${anchor?.key ?? ""},
        guards = ${sql.json(packed.guards)},
        delays = ${sql.json(packed.delays)},
        remarks = ${packed.remarks}::text[],
        updated_at = now()
      where id = ${id}::uuid and administrator_id = ${administratorId}::uuid
      returning ${sql.unsafe(chainColumns)}
    `
    const row = rows[0]
    return row === undefined
      ? context.json({ error: "not_found" }, 404)
      : context.json(chainView(row))
  })

  app.delete("/api/behavior-chains/:id", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const id = context.req.param("id")
    if (administratorId === null || !isUuid(id)) return context.json({ error: "not_found" }, 404)
    const used = await sql`
      select 1 from task_chain_item where chain_id = ${id}::uuid
      union all
      select 1 from operation_dispatch where chain_id = ${id}::uuid
      limit 1
    `
    if (used.length > 0) return context.json({ error: "chain_in_use" }, 409)
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
