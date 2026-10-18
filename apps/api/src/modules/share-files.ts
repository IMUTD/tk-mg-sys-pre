import { createHash, randomUUID } from "node:crypto"

import type { Hono } from "hono"
import type { Sql } from "postgres"
import { markBoxesWithoutHeartbeat } from "./box-presence"
import { administratorFor } from "./business-labels"
import { directoryOk, fileCategory, isBucket, splitRelative } from "./share-path"

const unassignedGroup = "00000000-0000-4000-8000-000000000001"
const fileBuckets = "share,video,mbp"
const backupBuckets = "backup"

const scanBuckets = (scope: unknown): string | null => {
  if (scope === undefined || scope === null || scope === "" || scope === "files") return fileBuckets
  if (scope === "backup") return backupBuckets
  return null
}

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex")

const bearer = (header: string | undefined): string => {
  const value = header ?? ""
  return value.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : ""
}

const userFromRequest = async (sql: Sql, request: Request): Promise<string | null> => {
  const header = request.headers.get("cookie") ?? ""
  const matched = /(?:^|;\s*)tk_mg_session=([^;]+)/.exec(header)
  let token = ""
  try {
    token = matched === null ? "" : decodeURIComponent(matched[1] ?? "")
  } catch {
    return null
  }
  if (token === "") return null
  const rows = await sql<{ id: string }[]>`
    select u.id from app_session s
    join app_user u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)}
      and s.revoked_at is null and s.expires_at > now() and u.enabled = true
  `
  return rows[0]?.id ?? null
}

type AgentDevice = { readonly deviceId: string; readonly host: string }

const agentDevice = async (sql: Sql, token: string, boxId: string): Promise<AgentDevice | null> => {
  if (token === "" || boxId === "") return null
  const rows = await sql<AgentDevice[]>`
    select d.id as "deviceId", d.host
    from device_agent a
    join device d on d.id = a.device_id
    where a.token_hash = ${hashToken(token)} and d.external_id = ${boxId} and d.enabled = true
  `
  return rows[0] ?? null
}

const expireStaleScans = async (sql: Sql): Promise<void> => {
  await sql`
    update box_share_scan set status = 'failed', error = '扫描中断', finished_at = now()
    where status = 'running' and started_at < now() - interval '10 minutes'
      and not exists (
        select 1 from box_share_entry e
        where e.last_scan_id = box_share_scan.id and e.seen_at > now() - interval '10 minutes'
      )
  `
}

// Share catalog routes. Scan and move tasks are claimed by the box agent.
export const registerShareFiles = (app: Hono, sql: Sql, wake: (deviceId: string) => void): void => {
  app.post("/api/share-scans", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    if (administratorId === null) return context.json({ error: "not_found" }, 404)
    const request = (await context.req.json().catch(() => null)) as { scope?: unknown } | null
    const buckets = scanBuckets(request?.scope)
    if (buckets === null) return context.json({ error: "invalid_payload" }, 400)
    const scope = buckets === backupBuckets ? "backup" : "files"
    await markBoxesWithoutHeartbeat(sql)
    const devices = await sql<
      { deviceId: string; groupId: string; host: string; name: string; status: string }[]
    >`
      select d.id as "deviceId", d.group_id as "groupId", d.host, d.name, d.status
      from device d
      where d.enabled = true and d.assignment_pending = false and d.external_id is not null
        and d.group_id <> ${unassignedGroup}::uuid
        and d.assignee_user_id = ${administratorId}::uuid
      order by d.host
    `
    const scans = []
    for (const device of devices) {
      if (device.status !== "online") {
        scans.push({
          deviceId: device.deviceId,
          host: device.host,
          name: device.name,
          scanId: "",
          status: "offline",
          taskId: null,
        })
        continue
      }
      const active = await sql<
        { buckets: string; id: string; status: string; taskId: string | null }[]
      >`
        select s.id::text as id, s.status, s.buckets,
          (select t.id::text from execution_task t
            where t.device_id = s.device_id and t.name = 'ScanShare' and t.status in ('queued','dispatching','running')
            order by t.created_at desc limit 1) as "taskId"
        from box_share_scan s
        where s.device_id = ${device.deviceId}::uuid and s.status in ('pending', 'running')
        limit 1
      `
      if (active[0] !== undefined && active[0].buckets !== buckets) {
        scans.push({
          deviceId: device.deviceId,
          name: device.name,
          scanId: active[0].id,
          status: "busy",
          taskId: active[0].taskId,
        })
        continue
      }
      if (active[0]?.taskId) {
        scans.push({
          deviceId: device.deviceId,
          name: device.name,
          scanId: active[0].id,
          status: active[0].status,
          taskId: active[0].taskId,
        })
        continue
      }
      if (active[0] !== undefined) {
        await sql`
          update box_share_scan set status = 'failed', error = '扫描未执行', finished_at = now()
          where id = ${active[0].id}::uuid and status in ('pending', 'running')
        `
      }
      const scanId = randomUUID()
      const taskId = randomUUID()
      const key = `share-scan:${scanId}`
      const fingerprint = hashToken(scanId)
      await sql.begin(async (tx) => {
        await tx`
          insert into box_share_scan (id, device_id, status, requested_by, buckets)
          values (${scanId}::uuid, ${device.deviceId}::uuid, 'pending', ${user}::uuid, ${buckets})
        `
        await tx`
          insert into execution_task (
            id, group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters, status
          ) values (
            ${taskId}::uuid, ${device.groupId}::uuid, ${user}::uuid, ${device.deviceId}::uuid, ${key}, ${fingerprint},
            'ScanShare', 'box-agent', ${tx.json([{ input: { scanId, scope }, skill: "ScanShare" }])}, 'queued'
          )
        `
        await tx`
          insert into execution_task_step (
            id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters, status, guards, after_ms
          ) values (
            ${randomUUID()}::uuid, ${taskId}::uuid, ${device.groupId}::uuid, 0, ${`${key}:0`}, ${fingerprint},
            'ScanShare', ${tx.json({ indexNum: 0 })}, ${tx.json({ scanId, scope })}, 'pending', ${tx.json([])}, 0
          )
        `
        await tx`select pg_notify('agent_task', ${device.deviceId})`
      })
      wake(device.deviceId)
      scans.push({
        deviceId: device.deviceId,
        name: device.name,
        scanId,
        status: "pending",
        taskId,
      })
    }
    return context.json({ scans }, 202)
  })

  app.get("/api/share-files", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    if (administratorId === null) return context.json({ boxes: [] })
    await expireStaleScans(sql)
    await markBoxesWithoutHeartbeat(sql)
    const requestedBucket = context.req.query("bucket") ?? ""
    if (requestedBucket !== "" && requestedBucket !== "backup")
      return context.json({ error: "invalid_category" }, 400)
    const backup = requestedBucket === "backup"
    const category = context.req.query("category") ?? "video"
    if (!backup && !["video", "text", "image", "other"].includes(category))
      return context.json({ error: "invalid_category" }, 400)
    const scope = backup ? backupBuckets : fileBuckets
    const devices = await sql<
      {
        deviceId: string
        host: string
        name: string
        scanStatus: string | null
        finishedAt: Date | null
        status: string
      }[]
    >`
      select d.id as "deviceId", d.host, d.name, d.status,
        s.status as "scanStatus", s.finished_at as "finishedAt"
      from device d
      left join lateral (
        select status, finished_at from box_share_scan
        where device_id = d.id and buckets = ${scope} order by created_at desc limit 1
      ) s on true
      where d.enabled = true and d.assignment_pending = false and d.external_id is not null
        and d.group_id <> ${unassignedGroup}::uuid
        and d.assignee_user_id = ${administratorId}::uuid
      order by d.host
    `
    const files = await sql<
      {
        deviceId: string
        id: string
        mtime: Date | null
        name: string
        parent: string
        path: string
        sha256: string
        size: string
      }[]
    >`
      select e.device_id as "deviceId", e.id::text as id, e.mtime, e.name, e.parent_path as parent,
        e.relative_path as path, e.sha256, e.size_bytes::text as size
      from box_share_entry e
      join device d on d.id = e.device_id
      where e.kind = 'file'
        and (
          (${backup}::boolean and e.bucket = 'backup')
          or (not ${backup}::boolean and e.category = ${category} and e.bucket <> 'backup')
        )
        and d.assignee_user_id = ${administratorId}::uuid
        and d.enabled = true and d.assignment_pending = false
        and d.group_id <> ${unassignedGroup}::uuid
      order by e.parent_path, e.name
    `
    const boxes = devices.map((device) => {
      const mine = files.filter((file) => file.deviceId === device.deviceId)
      const dirs = new Map<string, typeof mine>()
      for (const file of mine) {
        const list = dirs.get(file.parent) ?? []
        list.push(file)
        dirs.set(file.parent, list)
      }
      return {
        deviceId: device.deviceId,
        directories: [...dirs.entries()].map(([path, entries]) => ({
          files: entries.map((file) => ({
            id: file.id,
            mtime: file.mtime,
            name: file.name,
            path: file.path,
            sha256: file.sha256,
            size: Number(file.size),
          })),
          path,
        })),
        finishedAt: device.finishedAt,
        host: device.host,
        name: device.name,
        online: device.status === "online",
        scanStatus: device.scanStatus,
      }
    })
    return context.json({ boxes, category: backup ? "backup" : category })
  })

  app.post("/api/share-transfers", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const body = (await context.req.json().catch(() => null)) as {
      fileIds?: string[]
      targetDeviceId?: string
      targetDirectory?: string
    } | null
    const fileIds = body?.fileIds ?? []
    const targetDeviceId = body?.targetDeviceId ?? ""
    const targetDirectory = (body?.targetDirectory ?? "").trim()
    if (administratorId === null || fileIds.length === 0 || fileIds.length > 200)
      return context.json({ error: "invalid_payload" }, 400)
    if (
      !fileIds.every((id) => /^[0-9a-f-]{36}$/i.test(id)) ||
      !/^[0-9a-f-]{36}$/i.test(targetDeviceId)
    )
      return context.json({ error: "invalid_payload" }, 400)
    if (!directoryOk(targetDirectory)) return context.json({ error: "invalid_directory" }, 400)
    const target = await sql<{ groupId: string; host: string }[]>`
      select group_id as "groupId", host from device
      where id = ${targetDeviceId}::uuid and enabled and not assignment_pending
        and group_id <> ${unassignedGroup}::uuid
        and assignee_user_id = ${administratorId}::uuid
    `
    if (target[0] === undefined) return context.json({ error: "not_found" }, 404)
    const rows = await sql<
      {
        bucket: string
        deviceId: string
        groupId: string
        host: string
        path: string
        sha256: string
        size: string
      }[]
    >`
      select e.bucket, e.device_id as "deviceId", d.group_id as "groupId", d.host, e.relative_path as path, e.sha256, e.size_bytes::text as size
      from box_share_entry e
      join device d on d.id = e.device_id
      where e.id = any(${fileIds}::uuid[]) and e.kind = 'file'
        and (
          (e.category in ('video', 'image') and e.bucket <> 'backup')
          or e.bucket = 'backup'
        )
        and d.assignee_user_id = ${administratorId}::uuid and d.enabled and not d.assignment_pending
    `
    if (rows.length !== fileIds.length) return context.json({ error: "not_found" }, 404)
    const kinds = new Set(rows.map((row) => (row.bucket === "backup" ? "backup" : "files")))
    if (kinds.size !== 1) return context.json({ error: "invalid_payload" }, 400)
    const bySource = new Map<string, (typeof rows)[number][]>()
    for (const row of rows) {
      const list = bySource.get(row.deviceId) ?? []
      list.push(row)
      bySource.set(row.deviceId, list)
    }
    const tasks = []
    for (const [deviceId, files] of bySource) {
      const source = files[0]
      if (source === undefined) continue
      const taskId = randomUUID()
      const key = `share-move:${taskId}`
      const fingerprint = hashToken(key)
      const input = {
        files: JSON.stringify(
          files.map((file) => ({
            bucket: file.bucket,
            path: file.path,
            sha256: file.sha256,
            size: Number(file.size),
          })),
        ),
        targetDeviceId,
        targetDirectory,
        targetHost: target[0].host,
      }
      await sql.begin(async (tx) => {
        await tx`
          insert into execution_task (
            id, group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters, status
          ) values (
            ${taskId}::uuid, ${source.groupId}::uuid, ${user}::uuid, ${deviceId}::uuid, ${key}, ${fingerprint},
            'MoveShare', 'box-agent', ${tx.json([{ input, skill: "MoveShare" }])}, 'queued'
          )
        `
        await tx`
          insert into execution_task_step (
            id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters, status, guards, after_ms
          ) values (
            ${randomUUID()}::uuid, ${taskId}::uuid, ${source.groupId}::uuid, 0, ${`${key}:0`}, ${fingerprint},
            'MoveShare', ${tx.json({ indexNum: 0 })}, ${tx.json(input)}, 'pending', ${tx.json([])}, 0
          )
        `
        await tx`select pg_notify('agent_task', ${deviceId})`
      })
      wake(deviceId)
      tasks.push({ deviceId, taskId })
    }
    return context.json({ tasks }, 202)
  })

  app.get("/agent/share-scans/:id/known", async (context) => {
    const device = await agentDevice(
      sql,
      bearer(context.req.header("authorization")),
      context.req.query("boxId") ?? "",
    )
    if (device === null) return context.body(null, 401)
    const scanId = context.req.param("id")
    const scan = await sql<{ buckets: string; deviceId: string }[]>`
      select device_id as "deviceId", buckets from box_share_scan where id = ${scanId}::uuid
    `
    if (scan[0]?.deviceId !== device.deviceId) return context.body(null, 401)
    const rows = await sql<
      { bucket: string; mtime: Date | null; path: string; sha256: string; size: string }[]
    >`
      select bucket, mtime, relative_path as path, sha256, size_bytes::text as size
      from box_share_entry
      where device_id = ${device.deviceId}::uuid and kind = 'file' and sha256 <> ''
        and bucket = any(string_to_array(${scan[0].buckets}, ','))
    `
    return context.json({
      files: rows.map((row) => ({
        bucket: row.bucket,
        mtime: row.mtime,
        path: row.path,
        sha256: row.sha256,
        size: Number(row.size),
      })),
    })
  })

  app.post("/agent/share-scans/:id/entries", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      boxId?: string
      entries?: {
        bucket?: string
        kind?: string
        mtime?: string
        path?: string
        sha256?: string
        size?: number
      }[]
    } | null
    const device = await agentDevice(
      sql,
      bearer(context.req.header("authorization")),
      body?.boxId ?? "",
    )
    if (device === null) return context.body(null, 401)
    const scanId = context.req.param("id")
    const entries = body?.entries ?? []
    if (entries.length === 0 || entries.length > 200)
      return context.json({ error: "invalid_payload" }, 400)
    const scan = await sql<{ buckets: string; status: string }[]>`
      select status, buckets from box_share_scan
      where id = ${scanId}::uuid and device_id = ${device.deviceId}::uuid
        and status in ('pending', 'running')
    `
    if (scan[0] === undefined) return context.json({ error: "not_found" }, 404)
    const allowed = new Set(scan[0].buckets.split(","))
    for (const entry of entries) {
      if (!allowed.has(entry.bucket ?? "")) return context.json({ error: "invalid_payload" }, 400)
    }
    for (const entry of entries) {
      const bucket = entry.bucket ?? ""
      const kind = entry.kind ?? ""
      const parsed = splitRelative(entry.path ?? "")
      if (!isBucket(bucket) || (kind !== "file" && kind !== "dir") || parsed === null)
        return context.json({ error: "invalid_payload" }, 400)
      const sha = (entry.sha256 ?? "").toLowerCase()
      if (sha !== "" && !/^[0-9a-f]{64}$/.test(sha))
        return context.json({ error: "invalid_payload" }, 400)
      const size = Number(entry.size ?? 0)
      if (!Number.isFinite(size) || size < 0) return context.json({ error: "invalid_payload" }, 400)
      const mtime = entry.mtime ? new Date(entry.mtime) : null
      const category = kind === "file" ? fileCategory(parsed.name) : ""
      await sql`
        insert into box_share_entry (
          device_id, bucket, relative_path, parent_path, name, kind, category, size_bytes, mtime, sha256, last_scan_id
        ) values (
          ${device.deviceId}::uuid, ${bucket}, ${entry.path ?? ""}, ${parsed.parent}, ${parsed.name}, ${kind},
          ${category}, ${Math.trunc(size)}, ${mtime !== null && !Number.isNaN(mtime.getTime()) ? mtime : null},
          ${sha}, ${scanId}::uuid
        )
        on conflict (device_id, bucket, relative_path) do update set
          parent_path = excluded.parent_path,
          name = excluded.name,
          kind = excluded.kind,
          category = excluded.category,
          size_bytes = excluded.size_bytes,
          mtime = excluded.mtime,
          sha256 = case when excluded.sha256 <> '' then excluded.sha256 else box_share_entry.sha256 end,
          last_scan_id = excluded.last_scan_id,
          seen_at = now()
      `
    }
    await sql`
      update box_share_scan set status = 'running', started_at = coalesce(started_at, now())
      where id = ${scanId}::uuid and status in ('pending', 'running')
    `
    return context.json({ accepted: entries.length })
  })

  app.post("/agent/share-scans/:id/complete", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      boxId?: string
      dirCount?: number
      error?: string
      fileCount?: number
      skippedCount?: number
    } | null
    const device = await agentDevice(
      sql,
      bearer(context.req.header("authorization")),
      body?.boxId ?? "",
    )
    if (device === null) return context.body(null, 401)
    const scanId = context.req.param("id")
    const error = (body?.error ?? "").slice(0, 500)
    const scan = await sql<{ buckets: string }[]>`
      select buckets from box_share_scan
      where id = ${scanId}::uuid and device_id = ${device.deviceId}::uuid
    `
    const buckets = scan[0]?.buckets ?? ""
    const missing = await sql<{ count: string }[]>`
      select count(*)::text as count from box_share_entry
      where last_scan_id = ${scanId}::uuid and device_id = ${device.deviceId}::uuid
        and kind = 'file' and sha256 = ''
    `
    const failed = error !== "" || Number(missing[0]?.count ?? "0") > 0
    await sql.begin(async (tx) => {
      if (!failed && buckets !== "") {
        await tx`
          delete from box_share_entry
          where device_id = ${device.deviceId}::uuid and last_scan_id <> ${scanId}::uuid
            and bucket = any(string_to_array(${buckets}, ','))
        `
      }
      await tx`
        update box_share_scan set
          status = ${failed ? "failed" : "complete"},
          finished_at = now(),
          file_count = ${Number(body?.fileCount ?? 0)},
          dir_count = ${Number(body?.dirCount ?? 0)},
          skipped_count = ${Number(body?.skippedCount ?? 0)},
          error = ${failed && error === "" ? "文件没有哈希" : error}
        where id = ${scanId}::uuid and device_id = ${device.deviceId}::uuid
          and status in ('pending', 'running')
      `
    })
    return context.json({ status: failed ? "failed" : "complete" })
  })

  app.post("/agent/share-moves", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      boxId?: string
      moves?: {
        bucket?: string
        from?: string
        sha256?: string
        size?: number
        to?: string
        toDeviceId?: string
      }[]
    } | null
    const device = await agentDevice(
      sql,
      bearer(context.req.header("authorization")),
      body?.boxId ?? "",
    )
    if (device === null) return context.body(null, 401)
    const source = await sql<{ assignee: string | null }[]>`
      select assignee_user_id::text as assignee from device where id = ${device.deviceId}::uuid
    `
    for (const move of body?.moves ?? []) {
      const from = splitRelative(move.from ?? "")
      const to = splitRelative(move.to ?? "")
      const bucket = move.bucket ?? ""
      const toDeviceId = move.toDeviceId ?? ""
      const sha = (move.sha256 ?? "").toLowerCase()
      if (from === null || to === null || !isBucket(bucket) || !/^[0-9a-f-]{36}$/i.test(toDeviceId))
        return context.json({ error: "invalid_payload" }, 400)
      const size = Number(move.size ?? 0)
      if (!/^[0-9a-f]{64}$/.test(sha) || !Number.isFinite(size) || size < 0)
        return context.json({ error: "invalid_payload" }, 400)
      const dest = await sql<{ assignee: string | null }[]>`
        select assignee_user_id::text as assignee from device
        where id = ${toDeviceId}::uuid and enabled and not assignment_pending
          and group_id <> ${unassignedGroup}::uuid
      `
      if (dest[0]?.assignee == null || dest[0].assignee !== source[0]?.assignee)
        return context.json({ error: "not_found" }, 404)
      const scans = await sql<{ id: string }[]>`
        select id::text as id from box_share_scan
        where device_id = ${toDeviceId}::uuid
        order by created_at desc limit 1
      `
      let scanId = scans[0]?.id
      if (scanId === undefined) {
        scanId = randomUUID()
        await sql`
          insert into box_share_scan (id, device_id, status, finished_at)
          values (${scanId}::uuid, ${toDeviceId}::uuid, 'complete', now())
        `
      }
      await sql`
        insert into box_share_entry (
          device_id, bucket, relative_path, parent_path, name, kind, category, size_bytes, sha256, last_scan_id
        ) values (
          ${toDeviceId}::uuid, ${bucket}, ${move.to ?? ""}, ${to.parent}, ${to.name}, 'file', ${fileCategory(to.name)},
          ${Math.trunc(size)}, ${sha}, ${scanId}::uuid
        )
        on conflict (device_id, bucket, relative_path) do update set
          parent_path = excluded.parent_path, name = excluded.name, sha256 = excluded.sha256,
          category = excluded.category, size_bytes = excluded.size_bytes, seen_at = now()
      `
    }
    const targets = [
      ...new Set(
        (body?.moves ?? []).flatMap((move) =>
          typeof move.toDeviceId === "string" && move.toDeviceId.length > 0
            ? [move.toDeviceId]
            : [],
        ),
      ),
    ]
    for (const deviceId of targets) {
      await sql`select pg_notify('agent_task', ${deviceId})`
      wake(deviceId)
    }
    return context.json({ moved: body?.moves?.length ?? 0 })
  })
}
