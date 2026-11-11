import { createHash, randomUUID } from "node:crypto"

import type { Hono } from "hono"
import type { Sql } from "postgres"
import { administratorFor } from "./business-labels"
import { backupPhone, directoryOk, fileCategory, isBucket, phoneQuery, splitRelative } from "./share-path"
import { boxDirForNasBucket, dirNameOk, nasDeleteKeyOk, storageCardItems } from "./storage/nas-place"

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

const backupStamp = (name: string, mtime: Date | null): { phoneName: string; savedAt: Date | null } => {
  const parsed = backupPhone(name)
  const savedAt = mtime !== null && !Number.isNaN(mtime.getTime()) ? mtime : parsed.namedAt
  return { phoneName: parsed.phoneName, savedAt }
}

const sameAssignee = async (sql: Sql, left: string, right: string): Promise<boolean> => {
  if (left === right) {
    const rows = await sql<{ assignee: string | null }[]>`
      select assignee_user_id::text as assignee from device
      where id = ${left}::uuid and enabled and group_id <> ${unassignedGroup}::uuid
    `
    return rows[0]?.assignee != null
  }
  const rows = await sql<{ assignee: string | null }[]>`
    select assignee_user_id::text as assignee from device
    where (id = ${left}::uuid or id = ${right}::uuid) and enabled and group_id <> ${unassignedGroup}::uuid
  `
  return rows.length === 2 && rows[0]?.assignee != null && rows[0].assignee === rows[1]?.assignee
}

const nasCardBucket = async (sql: Sql, administratorId: string, nasId: string): Promise<string | null> => {
  const rows = await sql<{ value: unknown }[]>`
    select value from storage_setting where key = ${`private-cloud:${administratorId}`}
  `
  return storageCardItems(rows[0]?.value).find((item) => item.id === nasId)?.bucket ?? null
}

const latestScan = async (sql: Sql, deviceId: string): Promise<string> => {
  const scans = await sql<{ id: string }[]>`
    select id::text as id from box_share_scan
    where device_id = ${deviceId}::uuid
    order by created_at desc limit 1
  `
  const found = scans[0]?.id
  if (found !== undefined) return found
  const scanId = randomUUID()
  await sql`
    insert into box_share_scan (id, device_id, status, finished_at, buckets)
    values (${scanId}::uuid, ${deviceId}::uuid, 'complete', now(), 'backup')
  `
  return scanId
}

const placeShareEntry = async (
  sql: Sql,
  deviceId: string,
  scanId: string,
  bucket: string,
  path: string,
  parent: string,
  name: string,
  kind: string,
  category: string,
  size: number,
  mtime: Date | null,
  sha: string,
): Promise<"drop" | "stored"> => {
  const stamp = mtime !== null && !Number.isNaN(mtime.getTime()) ? mtime : null
  const identity = bucket === "backup" ? backupStamp(name, stamp) : { phoneName: "", savedAt: null }
  const fileType = bucket === "backup" ? "backup" : category
  if (kind === "file" && name.length > 0) {
    const nasSame = await sql<{ id: string }[]>`
      select e.id::text as id from box_share_entry e
      join device owner on owner.id = e.device_id
      join device me on me.id = ${deviceId}::uuid
      where e.place = 'nas' and e.kind = 'file' and e.name = ${name}
        and (case when e.bucket = 'backup' then 'backup' else e.category end) = ${fileType}
        and owner.assignee_user_id is not null
        and me.assignee_user_id is not null
        and owner.assignee_user_id = me.assignee_user_id
    `
    if (nasSame[0] !== undefined) {
      await sql`
        delete from box_share_entry
        where device_id = ${deviceId}::uuid and bucket = ${bucket} and relative_path = ${path} and place = 'box'
      `
      return "drop"
    }
  }
  const occupied = await sql<{ place: string }[]>`
    select place from box_share_entry
    where device_id = ${deviceId}::uuid and bucket = ${bucket} and relative_path = ${path}
  `
  if (occupied[0]?.place === "nas") return "stored"
  if (kind === "file" && name.length > 0) {
    const samePath = await sql<{ id: string }[]>`
      select id::text as id from box_share_entry
      where device_id = ${deviceId}::uuid and bucket = ${bucket} and relative_path = ${path}
    `
    if (samePath[0] === undefined) {
      const hits = await sql<{ id: string }[]>`
        select e.id::text as id from box_share_entry e
        join device owner on owner.id = e.device_id
        join device me on me.id = ${deviceId}::uuid
        where e.kind = 'file' and e.place = 'box' and e.name = ${name}
          and (case when e.bucket = 'backup' then 'backup' else e.category end) = ${fileType}
          and owner.enabled and owner.group_id <> ${unassignedGroup}::uuid
          and owner.assignee_user_id is not null
          and me.enabled and me.group_id <> ${unassignedGroup}::uuid
          and me.assignee_user_id is not null
          and owner.assignee_user_id = me.assignee_user_id
      `
      const hit = hits.length === 1 ? hits[0] : undefined
      if (hit !== undefined) {
        const taken = await sql<{ id: string }[]>`
          select id::text as id from box_share_entry
          where device_id = ${deviceId}::uuid and bucket = ${bucket} and relative_path = ${path}
            and id <> ${hit.id}::uuid
        `
        if (taken[0] === undefined) {
          await sql`
            update box_share_entry set
              device_id = ${deviceId}::uuid,
              bucket = ${bucket},
              relative_path = ${path},
              parent_path = ${parent},
              name = ${name},
              kind = 'file',
              category = ${category},
              size_bytes = ${size},
              mtime = ${stamp},
              sha256 = case when ${sha} <> '' then ${sha} else sha256 end,
              last_scan_id = ${scanId}::uuid,
              assignee_user_id = (select assignee_user_id from device where id = ${deviceId}::uuid),
              box_online = (select status = 'online' and enabled from device where id = ${deviceId}::uuid),
              seen_at = now()
            where id = ${hit.id}::uuid and place = 'box'
          `
          return "stored"
        }
      }
    }
  }
  await sql`
    insert into box_share_entry (
      device_id, bucket, relative_path, parent_path, name, kind, category, size_bytes, mtime, sha256, last_scan_id,
      phone_name, saved_at, assignee_user_id, box_online
    ) values (
      ${deviceId}::uuid, ${bucket}, ${path}, ${parent}, ${name}, ${kind},
      ${category}, ${size}, ${stamp}, ${sha}, ${scanId}::uuid,
      ${identity.phoneName}, ${identity.savedAt},
      (select assignee_user_id from device where id = ${deviceId}::uuid),
      (select status = 'online' and enabled from device where id = ${deviceId}::uuid)
    )
    on conflict (device_id, bucket, relative_path) do update set
      parent_path = excluded.parent_path,
      name = excluded.name,
      kind = excluded.kind,
      category = excluded.category,
      size_bytes = excluded.size_bytes,
      mtime = excluded.mtime,
      sha256 = case when excluded.sha256 <> '' then excluded.sha256 else box_share_entry.sha256 end,
      phone_name = excluded.phone_name,
      saved_at = excluded.saved_at,
      last_scan_id = excluded.last_scan_id,
      assignee_user_id = excluded.assignee_user_id,
      box_online = excluded.box_online,
      seen_at = now()
    where box_share_entry.place = 'box'
  `
  return "stored"
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
    const request = (await context.req.json().catch(() => null)) as { deviceIds?: unknown; scope?: unknown } | null
    const buckets = scanBuckets(request?.scope)
    if (buckets === null) return context.json({ error: "invalid_payload" }, 400)
    const requestedIds = request?.deviceIds
    const only =
      requestedIds === undefined
        ? null
        : Array.isArray(requestedIds) &&
            requestedIds.length > 0 &&
            requestedIds.length <= 50 &&
            requestedIds.every((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id))
          ? requestedIds
          : undefined
    if (only === undefined) return context.json({ error: "invalid_payload" }, 400)
    const scope = buckets === backupBuckets ? "backup" : "files"
    const owned = await sql<
      { deviceId: string; groupId: string; host: string; name: string; status: string }[]
    >`
      select d.id as "deviceId", d.group_id as "groupId", d.host, d.name, d.status
      from device d
      where d.enabled = true and d.assignment_pending = false and d.external_id is not null
        and d.group_id <> ${unassignedGroup}::uuid
        and d.assignee_user_id = ${administratorId}::uuid
      order by d.host
    `
    const devices = only === null ? owned : owned.filter((device) => only.includes(device.deviceId))
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
        lastAccount: string
        sha256: string
        size: string
      }[]
    >`
      select e.device_id as "deviceId", e.id::text as id, e.mtime, e.name, e.parent_path as parent,
        e.relative_path as path, e.sha256, e.size_bytes::text as size,
        case when ${backup}::boolean or ${category} not in ('image', 'video') then ''
          else coalesce(a.identifier, '') end as "lastAccount"
      from box_share_entry e
      join device d on d.id = e.device_id
      left join operation_account a
        on ${backup}::boolean = false and ${category} in ('image', 'video')
        and a.id = e.last_account_id and a.deleted = false
      where e.kind = 'file'
        and e.place = 'box'
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
            ...((file.lastAccount ?? "").length === 0 ? {} : { lastAccount: file.lastAccount }),
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
    type NasListRow = {
      id: string
      lastAccount: string
      mtime: Date | null
      name: string
      nasId: string
      path: string
      sha256: string
      size: string
    }
    const nasRows = await sql<NasListRow[]>`
      select e.id::text as id, e.mtime, e.name, e.nas_id::text as "nasId", e.nas_key as path, e.sha256,
        e.size_bytes::text as size,
        case when ${backup}::boolean or ${category} not in ('image', 'video') then ''
          else coalesce(a.identifier, '') end as "lastAccount"
      from box_share_entry e
      left join operation_account a
        on ${backup}::boolean = false and ${category} in ('image', 'video')
        and a.id = e.last_account_id and a.deleted = false
      where e.place = 'nas' and e.kind = 'file'
        and e.assignee_user_id = ${administratorId}::uuid
        and (
          (${backup}::boolean and e.bucket = 'backup')
          or (not ${backup}::boolean and e.category = ${category} and e.bucket <> 'backup')
        )
      order by e.name
    `
    const nasGroups = new Map<string, NasListRow[]>()
    for (const row of nasRows) {
      const list = nasGroups.get(row.nasId) ?? []
      list.push(row)
      nasGroups.set(row.nasId, list)
    }
    const dirRows = await sql<{ id: string; name: string; nasId: string }[]>`
      select e.id::text as id, e.name, e.nas_id::text as "nasId"
      from box_share_entry e
      where ${backup}::boolean and e.place = 'nas' and e.kind = 'dir' and e.bucket = 'backup'
        and e.assignee_user_id = ${administratorId}::uuid
        and e.nas_key = e.name || '/'
        and e.name <> ${administratorId}
      order by e.name
    `
    const dirsByNas = new Map<string, { id: string; name: string }[]>()
    for (const row of dirRows) {
      if (!dirNameOk(row.name)) continue
      const list = dirsByNas.get(row.nasId) ?? []
      list.push({ id: row.id, name: row.name })
      dirsByNas.set(row.nasId, list)
      if (!nasGroups.has(row.nasId)) nasGroups.set(row.nasId, [])
    }
    const nas = [...nasGroups.entries()].map(([nasId, entries]) => ({
      directories: dirsByNas.get(nasId) ?? [],
      files: entries.map((file) => ({
        id: file.id,
        ...((file.lastAccount ?? "").length === 0 ? {} : { lastAccount: file.lastAccount }),
        mtime: file.mtime,
        name: file.name,
        path: file.path.startsWith(`${administratorId}/`) ? file.path.slice(administratorId.length + 1) : file.path,
        sha256: file.sha256,
        size: Number(file.size),
      })),
      nasId,
    }))
    return context.json({ boxes, category: backup ? "backup" : category, nas })
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

  app.get("/api/storage/nas-entries", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const nasId = context.req.query("nasId") ?? ""
    if (administratorId === null || !/^[0-9a-f-]{36}$/i.test(nasId)) return context.json({ items: [] })
    const owned = await nasCardBucket(sql, administratorId, nasId)
    if (owned === null) return context.json({ message: "NAS未配置" }, 404)
    const rows = await sql<{ key: string; modified: Date | null; name: string; sha256: string; size: string }[]>`
      select nas_key as key,
        case when bucket = 'backup' then coalesce(mtime, saved_at, seen_at) else seen_at end as modified,
        name, sha256, size_bytes::text as size
      from box_share_entry
      where place = 'nas' and nas_id = ${nasId}::uuid and assignee_user_id = ${administratorId}::uuid
      order by name
    `
    return context.json({
      items: rows.map((row) => ({
        key: row.key,
        modified: row.modified,
        name: row.name,
        sha256: row.sha256,
        size: Number(row.size),
      })),
    })
  })

  app.post("/api/storage/nas-refresh", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const body = (await context.req.json().catch(() => null)) as { nasId?: string } | null
    const nasId = body?.nasId ?? ""
    if (administratorId === null || !/^[0-9a-f-]{36}$/i.test(nasId)) {
      return context.json({ error: "invalid_payload" }, 400)
    }
    if ((await nasCardBucket(sql, administratorId, nasId)) === null) {
      return context.json({ message: "NAS未配置" }, 404)
    }
    const online = await sql<{ deviceId: string; groupId: string }[]>`
      select id as "deviceId", group_id as "groupId" from device
      where enabled and status = 'online' and assignee_user_id = ${administratorId}::uuid
        and group_id <> ${unassignedGroup}::uuid and external_id is not null
      order by host limit 1
    `
    const box = online[0]
    if (box === undefined) return context.json({ queued: false })
    const taskId = randomUUID()
    const key = `nas-list:${taskId}`
    const fingerprint = hashToken(key)
    const input = { nasId }
    await sql.begin(async (tx) => {
      await tx`
        insert into execution_task (
          id, group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters, status
        ) values (
          ${taskId}::uuid, ${box.groupId}::uuid, ${user}::uuid, ${box.deviceId}::uuid, ${key}, ${fingerprint},
          'ListNas', 'box-agent', ${tx.json([{ input, skill: "ListNas" }])}, 'queued'
        )
      `
      await tx`
        insert into execution_task_step (
          id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters, status, guards, after_ms
        ) values (
          ${randomUUID()}::uuid, ${taskId}::uuid, ${box.groupId}::uuid, 0, ${`${key}:0`}, ${fingerprint},
          'ListNas', ${tx.json({ indexNum: 0 })}, ${tx.json(input)}, 'pending', ${tx.json([])}, 0
        )
      `
      await tx`select pg_notify('agent_task', ${box.deviceId})`
    })
    wake(box.deviceId)
    return context.json({ queued: true, taskId }, 202)
  })

  app.get("/api/share-nas-directories", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const nasId = context.req.query("nasId") ?? ""
    if (administratorId === null || !/^[0-9a-f-]{36}$/i.test(nasId)) return context.json({ error: "invalid_payload" }, 400)
    const cardBucket = await nasCardBucket(sql, administratorId, nasId)
    if (boxDirForNasBucket(cardBucket ?? "") === null) return context.json({ message: "NAS未配置" }, 404)
    const category = context.req.query("category") ?? ""
    if (category === "image" || category === "video") {
      const expected = category === "image" ? "pictures" : "videos"
      if (cardBucket !== expected) return context.json({ directories: [], items: [] })
      const counted = await sql<{ count: number; directory: string }[]>`
        select split_part(nas_key, '/', 1) as directory, count(*)::int as count
        from box_share_entry
        where place = 'nas' and kind = 'file'
          and assignee_user_id = ${administratorId}::uuid
          and nas_id = ${nasId}::uuid
          and category = ${category}
          and split_part(nas_key, '/', 2) <> ''
          and split_part(nas_key, '/', 3) = ''
          and split_part(nas_key, '/', 1) <> ${administratorId}
        group by 1
        order by 1
      `
      const items = counted
        .filter((row) => dirNameOk(row.directory))
        .map((row) => ({ count: Number(row.count), name: row.directory }))
      return context.json({ directories: items.map((item) => item.name), items })
    }
    if (category.length > 0) return context.json({ error: "invalid_payload" }, 400)
    const rows = await sql<{ directory: string }[]>`
      select distinct split_part(nas_key, '/', 1) as directory
      from box_share_entry
      where place = 'nas' and assignee_user_id = ${administratorId}::uuid
        and nas_id = ${nasId}::uuid
        and nas_key like '%/%'
        and split_part(nas_key, '/', 1) <> ${administratorId}
      order by directory
    `
    return context.json({ directories: rows.map((row) => row.directory).filter(dirNameOk) })
  })

  app.post("/api/share-nas-transfers", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const body = (await context.req.json().catch(() => null)) as { directory?: string; fileIds?: string[]; nasId?: string } | null
    const directory = (body?.directory ?? "").trim()
    const fileIds = body?.fileIds ?? []
    const nasId = body?.nasId ?? ""
    if (administratorId === null || !dirNameOk(directory) || fileIds.length === 0 || fileIds.length > 200 || !/^[0-9a-f-]{36}$/i.test(nasId)) {
      return context.json({ error: "invalid_payload", message: "目录名无效" }, 400)
    }
    if (!fileIds.every((id) => /^[0-9a-f-]{36}$/i.test(id))) return context.json({ error: "invalid_payload" }, 400)
    const cardBucket = await nasCardBucket(sql, administratorId, nasId)
    const mapped = boxDirForNasBucket(cardBucket ?? "")
    if (mapped === null) return context.json({ message: "NAS未配置" }, 404)
    const backupCard = mapped.bucket === "backup"
    const rows = await sql<
      { bucket: string; deviceId: string; groupId: string; id: string; name: string; path: string; sha256: string; size: string }[]
    >`
      select e.id::text as id, e.bucket, e.device_id as "deviceId", d.group_id as "groupId", e.name,
        e.relative_path as path, e.sha256, e.size_bytes::text as size
      from box_share_entry e
      join device d on d.id = e.device_id
      where e.id = any(${fileIds}::uuid[]) and e.kind = 'file' and e.place = 'box'
        and (
          (${backupCard}::boolean and e.bucket = 'backup')
          or (not ${backupCard}::boolean and e.category = ${mapped.category})
        )
        and d.assignee_user_id = ${administratorId}::uuid and d.enabled
    `
    if (rows.length !== fileIds.length) return context.json({ error: "not_found" }, 404)
    const marked = await sql<{ id: string }[]>`
      update box_share_entry set dest_dir = ${directory}
      where id = any(${fileIds}::uuid[]) and place = 'box' and assignee_user_id = ${administratorId}::uuid
      returning id::text as id
    `
    if (marked.length !== fileIds.length) return context.json({ error: "not_found" }, 404)
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
      const key = `nas-move:${taskId}`
      const fingerprint = hashToken(key)
      const input = {
        files: JSON.stringify(
          files.map((file) => ({
            bucket: file.bucket,
            id: file.id,
            name: file.name,
            path: file.path,
            sha256: file.sha256,
            size: Number(file.size),
          })),
        ),
        nasId,
      }
      await sql.begin(async (tx) => {
        await tx`
          insert into execution_task (
            id, group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters, status
          ) values (
            ${taskId}::uuid, ${source.groupId}::uuid, ${user}::uuid, ${deviceId}::uuid, ${key}, ${fingerprint},
            'MoveShareToNas', 'box-agent', ${tx.json([{ input, skill: "MoveShareToNas" }])}, 'queued'
          )
        `
        await tx`
          insert into execution_task_step (
            id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters, status, guards, after_ms
          ) values (
            ${randomUUID()}::uuid, ${taskId}::uuid, ${source.groupId}::uuid, 0, ${`${key}:0`}, ${fingerprint},
            'MoveShareToNas', ${tx.json({ indexNum: 0 })}, ${tx.json(input)}, 'pending', ${tx.json([])}, 0
          )
        `
        await tx`select pg_notify('agent_task', ${deviceId})`
      })
      wake(deviceId)
      tasks.push({ deviceId, taskId })
    }
    return context.json({ tasks }, 202)
  })

  app.post("/api/share-nas-deletes", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const body = (await context.req.json().catch(() => null)) as { fileIds?: string[] } | null
    const fileIds = [...new Set(body?.fileIds ?? [])]
    if (administratorId === null || fileIds.length === 0 || fileIds.length > 200) {
      return context.json({ error: "invalid_payload" }, 400)
    }
    if (!fileIds.every((id) => /^[0-9a-f-]{36}$/i.test(id))) return context.json({ error: "invalid_payload" }, 400)
    const rows = await sql<{ id: string; nasId: string; nasKey: string }[]>`
      select e.id::text as id, e.nas_id::text as "nasId", e.nas_key as "nasKey"
      from box_share_entry e
      where e.id = any(${fileIds}::uuid[]) and e.kind = 'file' and e.place = 'nas'
        and e.assignee_user_id = ${administratorId}::uuid
    `
    if (rows.length !== fileIds.length || rows.some((row) => typeof row.nasKey !== "string" || !nasDeleteKeyOk(row.nasKey))) {
      return context.json({ error: "not_found" }, 404)
    }
    const buckets = new Map<string, string | null>()
    for (const row of rows) {
      if (!buckets.has(row.nasId)) buckets.set(row.nasId, await nasCardBucket(sql, administratorId, row.nasId))
    }
    if ([...buckets.values()].some((bucket) => bucket !== "pictures" && bucket !== "videos" && bucket !== "backup")) {
      return context.json({ error: "not_found" }, 404)
    }
    const online = await sql<{ deviceId: string; groupId: string }[]>`
      select id as "deviceId", group_id as "groupId" from device
      where enabled and status = 'online' and assignee_user_id = ${administratorId}::uuid
        and group_id <> ${unassignedGroup}::uuid and external_id is not null
      order by host limit 1
    `
    const box = online[0]
    if (box === undefined) return context.json({ queued: false, message: "没有在线盒子" })
    const taskId = randomUUID()
    const key = `nas-delete:${taskId}`
    const fingerprint = hashToken(key)
    const input = { entryIds: JSON.stringify(fileIds) }
    await sql.begin(async (tx) => {
      await tx`
        insert into execution_task (
          id, group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters, status
        ) values (
          ${taskId}::uuid, ${box.groupId}::uuid, ${user}::uuid, ${box.deviceId}::uuid, ${key}, ${fingerprint},
          'DeleteNasShare', 'box-agent', ${tx.json([{ input, skill: "DeleteNasShare" }])}, 'queued'
        )
      `
      await tx`
        insert into execution_task_step (
          id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters, status, guards, after_ms
        ) values (
          ${randomUUID()}::uuid, ${taskId}::uuid, ${box.groupId}::uuid, 0, ${`${key}:0`}, ${fingerprint},
          'DeleteNasShare', ${tx.json({ indexNum: 0 })}, ${tx.json(input)}, 'pending', ${tx.json([])}, 0
        )
      `
      await tx`select pg_notify('agent_task', ${box.deviceId})`
    })
    wake(box.deviceId)
    return context.json({ queued: true, taskId }, 202)
  })

  app.post("/api/share-nas-directory-deletes", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const body = (await context.req.json().catch(() => null)) as { entryId?: string } | null
    const entryId = body?.entryId ?? ""
    if (administratorId === null || !/^[0-9a-f-]{36}$/i.test(entryId)) {
      return context.json({ error: "invalid_payload" }, 400)
    }
    const rows = await sql<{ name: string; nasId: string; nasKey: string }[]>`
      select e.name, e.nas_id::text as "nasId", e.nas_key as "nasKey"
      from box_share_entry e
      where e.id = ${entryId}::uuid and e.kind = 'dir' and e.place = 'nas' and e.bucket = 'backup'
        and e.assignee_user_id = ${administratorId}::uuid
    `
    const row = rows[0]
    if (row === undefined || row.nasKey !== `${row.name}/` || row.name === administratorId || !dirNameOk(row.name)) {
      return context.json({ error: "not_found" }, 404)
    }
    const bucket = await nasCardBucket(sql, administratorId, row.nasId)
    if (bucket !== "backup") return context.json({ error: "not_found" }, 404)
    const files = await sql<{ id: string }[]>`
      select id::text as id from box_share_entry
      where place = 'nas' and kind = 'file' and assignee_user_id = ${administratorId}::uuid
        and nas_id = ${row.nasId}::uuid
        and split_part(nas_key, '/', 1) = ${row.name}
        and split_part(nas_key, '/', 2) <> ''
        and split_part(nas_key, '/', 3) = ''
      limit 1
    `
    if (files.length > 0) return context.json({ message: "目录里还有备份" }, 409)
    const online = await sql<{ deviceId: string; groupId: string }[]>`
      select id as "deviceId", group_id as "groupId" from device
      where enabled and status = 'online' and assignee_user_id = ${administratorId}::uuid
        and group_id <> ${unassignedGroup}::uuid and external_id is not null
      order by host limit 1
    `
    const box = online[0]
    if (box === undefined) return context.json({ queued: false, message: "没有在线盒子" })
    const taskId = randomUUID()
    const key = `nas-dir-delete:${taskId}`
    const fingerprint = hashToken(key)
    const input = { entryId }
    await sql.begin(async (tx) => {
      await tx`
        insert into execution_task (
          id, group_id, requester_id, device_id, idempotency_key, fingerprint, name, executor_key, parameters, status
        ) values (
          ${taskId}::uuid, ${box.groupId}::uuid, ${user}::uuid, ${box.deviceId}::uuid, ${key}, ${fingerprint},
          'DeleteNasDir', 'box-agent', ${tx.json([{ input, skill: "DeleteNasDir" }])}, 'queued'
        )
      `
      await tx`
        insert into execution_task_step (
          id, task_id, group_id, sequence, command_idempotency_key, fingerprint, kind, target, parameters, status, guards, after_ms
        ) values (
          ${randomUUID()}::uuid, ${taskId}::uuid, ${box.groupId}::uuid, 0, ${`${key}:0`}, ${fingerprint},
          'DeleteNasDir', ${tx.json({ indexNum: 0 })}, ${tx.json(input)}, 'pending', ${tx.json([])}, 0
        )
      `
      await tx`select pg_notify('agent_task', ${box.deviceId})`
    })
    wake(box.deviceId)
    return context.json({ queued: true, taskId }, 202)
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
      where device_id = ${device.deviceId}::uuid and kind = 'file' and sha256 <> '' and place = 'box'
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
    const drops: { bucket: string; path: string }[] = []
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
      const placed = await placeShareEntry(
        sql,
        device.deviceId,
        scanId,
        bucket,
        entry.path ?? "",
        parsed.parent,
        parsed.name,
        kind,
        category,
        Math.trunc(size),
        mtime,
        sha,
      )
      if (placed === "drop") drops.push({ bucket, path: entry.path ?? "" })
    }
    await sql`
      update box_share_scan set status = 'running', started_at = coalesce(started_at, now())
      where id = ${scanId}::uuid and status in ('pending', 'running')
    `
    return context.json({ accepted: entries.length, drop: drops })
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
    const failed = error !== ""
    await sql.begin(async (tx) => {
      if (!failed && buckets !== "") {
        await tx`
          delete from box_share_entry
          where device_id = ${device.deviceId}::uuid and last_scan_id <> ${scanId}::uuid
            and place = 'box'
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
          error = ${error}
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
      if ((sha !== "" && !/^[0-9a-f]{64}$/.test(sha)) || !Number.isFinite(size) || size < 0)
        return context.json({ error: "invalid_payload" }, 400)
      const identity = bucket === "backup" ? backupStamp(to.name, null) : { phoneName: "", savedAt: null }
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
          device_id, bucket, relative_path, parent_path, name, kind, category, size_bytes, sha256, last_scan_id,
          phone_name, saved_at
        ) values (
          ${toDeviceId}::uuid, ${bucket}, ${move.to ?? ""}, ${to.parent}, ${to.name}, 'file', ${fileCategory(to.name)},
          ${Math.trunc(size)}, ${sha}, ${scanId}::uuid, ${identity.phoneName}, ${identity.savedAt}
        )
        on conflict (device_id, bucket, relative_path) do update set
          parent_path = excluded.parent_path, name = excluded.name, sha256 = excluded.sha256,
          category = excluded.category, size_bytes = excluded.size_bytes,
          phone_name = excluded.phone_name, saved_at = excluded.saved_at, seen_at = now()
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

  app.post("/agent/backup-locate", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      backupName?: string
      boxId?: string
    } | null
    const device = await agentDevice(sql, bearer(context.req.header("authorization")), body?.boxId ?? "")
    if (device === null) return context.body(null, 401)
    const phone = phoneQuery(body?.backupName ?? "")
    if (phone === null) return context.json({ error: "invalid_backup_name", message: "云机名无效" }, 400)
    const rows = await sql<{
      deviceId: string
      host: string
      phoneName: string
      relativePath: string
      sha256: string
      sizeBytes: string
    }[]>`
      select e.device_id::text as "deviceId", d.host, e.phone_name as "phoneName",
        e.relative_path as "relativePath", e.sha256, e.size_bytes::text as "sizeBytes"
      from box_share_entry e
      join device d on d.id = e.device_id
      join device me on me.id = ${device.deviceId}::uuid
      where e.bucket = 'backup' and e.kind = 'file'
        and e.phone_name = ${phone} and e.saved_at is not null
        and d.enabled and d.group_id <> ${unassignedGroup}::uuid and d.assignee_user_id is not null
        and me.enabled and me.group_id <> ${unassignedGroup}::uuid and me.assignee_user_id is not null
        and d.assignee_user_id = me.assignee_user_id
      order by e.saved_at desc,
        case when e.device_id = ${device.deviceId}::uuid then 0 else 1 end,
        d.host, e.relative_path
      limit 1
    `
    const row = rows[0]
    if (row === undefined) return context.json({ error: "backup_not_found", message: "没有这个备份" }, 404)
    return context.json({
      deviceId: row.deviceId,
      host: row.host,
      local: row.deviceId === device.deviceId,
      phoneName: row.phoneName,
      relativePath: row.relativePath,
      sha256: row.sha256,
      sizeBytes: Number(row.sizeBytes),
    })
  })

  app.post("/agent/backup-extras", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      backupName?: string
      boxId?: string
    } | null
    const device = await agentDevice(sql, bearer(context.req.header("authorization")), body?.boxId ?? "")
    if (device === null) return context.body(null, 401)
    const phone = phoneQuery(body?.backupName ?? "")
    if (phone === null) return context.json({ error: "invalid_backup_name", message: "云机名无效" }, 400)
    const rows = await sql<{
      deviceId: string
      host: string
      relativePath: string
      savedAt: Date
      sha256: string
    }[]>`
      select e.device_id::text as "deviceId", d.host, e.relative_path as "relativePath",
        e.saved_at as "savedAt", e.sha256
      from box_share_entry e
      join device d on d.id = e.device_id
      join device me on me.id = ${device.deviceId}::uuid
      where e.bucket = 'backup' and e.kind = 'file'
        and e.phone_name = ${phone} and e.saved_at is not null
        and d.enabled and d.group_id <> ${unassignedGroup}::uuid and d.assignee_user_id is not null
        and me.enabled and me.group_id <> ${unassignedGroup}::uuid and me.assignee_user_id is not null
        and d.assignee_user_id = me.assignee_user_id
      order by e.saved_at desc,
        case when e.device_id = ${device.deviceId}::uuid then 0 else 1 end,
        d.host, e.relative_path
    `
    const keep = rows[0]
    if (keep === undefined) return context.json({ error: "backup_not_found", message: "没有这个备份" }, 404)
    const extras = rows.slice(1).reverse()
    return context.json({ extras, keep, phoneName: phone })
  })

  app.post("/agent/backup-removed", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      boxId?: string
      deviceId?: string
      relativePath?: string
      sha256?: string
    } | null
    const device = await agentDevice(sql, bearer(context.req.header("authorization")), body?.boxId ?? "")
    if (device === null) return context.body(null, 401)
    const fromDeviceId = body?.deviceId ?? ""
    const relativePath = body?.relativePath ?? ""
    const parsed = splitRelative(relativePath)
    if (!/^[0-9a-f-]{36}$/i.test(fromDeviceId) || parsed === null) {
      return context.json({ error: "invalid_payload", message: "备份已变化" }, 400)
    }
    if (!(await sameAssignee(sql, device.deviceId, fromDeviceId))) {
      return context.json({ error: "not_found", message: "没有这个备份" }, 404)
    }
    await sql`
      delete from box_share_entry
      where device_id = ${fromDeviceId}::uuid and bucket = 'backup'
        and relative_path = ${relativePath} and name = ${parsed.name}
    `
    return context.json({ removed: true })
  })

  app.post("/agent/backup-relocated", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      boxId?: string
      fromDeviceId?: string
      relativePath?: string
      sha256?: string
      sizeBytes?: number
    } | null
    const device = await agentDevice(sql, bearer(context.req.header("authorization")), body?.boxId ?? "")
    if (device === null) return context.body(null, 401)
    const fromDeviceId = body?.fromDeviceId ?? ""
    const relativePath = body?.relativePath ?? ""
    const sha = (body?.sha256 ?? "").toLowerCase()
    const size = Number(body?.sizeBytes ?? 0)
    const parsed = splitRelative(relativePath)
    if (!/^[0-9a-f-]{36}$/i.test(fromDeviceId) || parsed === null || (sha !== "" && !/^[0-9a-f]{64}$/.test(sha)) || !Number.isFinite(size) || size < 0) {
      return context.json({ error: "invalid_payload", message: "备份已变化" }, 400)
    }
    if (!(await sameAssignee(sql, device.deviceId, fromDeviceId))) {
      return context.json({ error: "not_found", message: "没有这个备份" }, 404)
    }
    const source = await sql<{ id: string; phoneName: string; savedAt: Date | null; sha256: string }[]>`
      select id::text as id, phone_name as "phoneName", saved_at as "savedAt", sha256 from box_share_entry
      where device_id = ${fromDeviceId}::uuid and bucket = 'backup' and relative_path = ${relativePath} and name = ${parsed.name}
    `
    const kept = source[0]
    if (kept === undefined) return context.json({ error: "backup_moved", message: "备份已变化" }, 409)
    const scanId = await latestScan(sql, device.deviceId)
    await sql.begin(async (tx) => {
      await tx`
        insert into box_share_entry (
          device_id, bucket, relative_path, parent_path, name, kind, category, size_bytes, sha256, last_scan_id,
          phone_name, saved_at
        ) values (
          ${device.deviceId}::uuid, 'backup', ${relativePath}, ${parsed.parent}, ${parsed.name}, 'file',
          ${fileCategory(parsed.name)}, ${Math.trunc(size)}, ${sha !== "" ? sha : kept.sha256}, ${scanId}::uuid,
          ${kept.phoneName}, ${kept.savedAt}
        )
        on conflict (device_id, bucket, relative_path) do update set
          parent_path = excluded.parent_path, name = excluded.name,
          sha256 = case when excluded.sha256 <> '' then excluded.sha256 else box_share_entry.sha256 end,
          category = excluded.category, size_bytes = excluded.size_bytes, last_scan_id = excluded.last_scan_id,
          phone_name = excluded.phone_name, saved_at = excluded.saved_at, seen_at = now()
      `
      await tx`
        delete from box_share_entry
        where id = ${kept.id}::uuid and device_id = ${fromDeviceId}::uuid
          and device_id <> ${device.deviceId}::uuid
      `
    })
    return context.json({ relocated: true })
  })

  app.post("/agent/media-locate", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      boxId?: string
      entryId?: string
      kind?: string
      nasId?: string
    } | null
    const device = await agentDevice(sql, bearer(context.req.header("authorization")), body?.boxId ?? "")
    if (device === null) return context.body(null, 401)
    const kind = body?.kind === "video" ? "video" : body?.kind === "image" ? "image" : ""
    const entryId = body?.entryId ?? ""
    const invalid = kind === "video" ? "视频ID无效" : "图片ID无效"
    const missing = kind === "video" ? "没有这个视频" : "没有这张图片"
    const wrong = kind === "video" ? "这不是视频" : "这不是图片"
    if (kind === "" || !/^[0-9a-f-]{36}$/i.test(entryId)) {
      return context.json({ error: "invalid_entry_id", message: invalid === "视频ID无效" && kind === "" ? "图片ID无效" : invalid }, 400)
    }
    const rows = await sql<{
      assigneeUserId: string | null
      boxOnline: boolean
      bucket: string
      category: string
      deviceId: string
      host: string
      name: string
      nasId: string | null
      nasKey: string
      place: string
      relativePath: string
      sha256: string
      sizeBytes: string
      useCount: number
    }[]>`
      select e.device_id::text as "deviceId", d.host, e.bucket, e.relative_path as "relativePath",
        e.name, e.category, e.sha256, e.size_bytes::text as "sizeBytes", e.use_count as "useCount",
        e.assignee_user_id::text as "assigneeUserId", e.box_online as "boxOnline", e.place,
        e.nas_id::text as "nasId", e.nas_key as "nasKey"
      from box_share_entry e
      join device d on d.id = e.device_id
      where e.id = ${entryId}::uuid and e.kind = 'file'
    `
    const row = rows[0]
    if (row === undefined) return context.json({ error: "entry_not_found", message: missing }, 404)
    const mine = await sql<{ assigneeUserId: string | null }[]>`
      select assignee_user_id::text as "assigneeUserId" from device where id = ${device.deviceId}::uuid
    `
    const taskAssignee = mine[0]?.assigneeUserId ?? null
    if (row.assigneeUserId === null || taskAssignee === null || row.assigneeUserId !== taskAssignee) {
      return context.json({ error: "entry_not_found", message: missing }, 404)
    }
    const requestedNas = body?.nasId ?? ""
    if (requestedNas.length > 0 && row.nasId !== requestedNas) {
      return context.json({ error: "entry_not_found", message: missing }, 404)
    }
    if (row.place !== "nas" && !row.boxOnline) {
      return context.json({ error: "source_offline", message: "源盒子没有响应" }, 502)
    }
    if (row.category !== kind) return context.json({ error: "entry_kind", message: wrong }, 409)
    const nasBucket = row.place === "nas" && row.nasId !== null ? await nasCardBucket(sql, taskAssignee, row.nasId) : ""
    return context.json({
      bucket: row.bucket,
      deviceId: row.deviceId,
      host: row.host,
      local: row.deviceId === device.deviceId,
      name: row.name,
      nasBucket: nasBucket ?? "",
      nasKey: row.place === "nas" ? row.nasKey : "",
      place: row.place,
      relativePath: row.relativePath,
      sha256: row.sha256,
      sizeBytes: Number(row.sizeBytes),
      useCount: row.useCount,
    })
  })

  app.post("/agent/media-used", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      boxId?: string
      deleteAfter?: number
      entryId?: string
    } | null
    const device = await agentDevice(sql, bearer(context.req.header("authorization")), body?.boxId ?? "")
    if (device === null) return context.body(null, 401)
    const entryId = body?.entryId ?? ""
    const after = Number(body?.deleteAfter ?? 0)
    if (!/^[0-9a-f-]{36}$/i.test(entryId) || !Number.isInteger(after) || after < 1) {
      return context.json({ error: "invalid_payload", message: "上传次数无效" }, 400)
    }
    const owned = await sql<{ deviceId: string }[]>`
      select device_id::text as "deviceId" from box_share_entry where id = ${entryId}::uuid
    `
    const owner = owned[0]
    if (owner === undefined || !(await sameAssignee(sql, device.deviceId, owner.deviceId))) {
      return context.json({ error: "entry_not_found", message: "没有这张图片" }, 404)
    }
    const rows = await sql<{ useCount: number }[]>`
      update box_share_entry set use_count = use_count + 1
      where id = ${entryId}::uuid
      returning use_count as "useCount"
    `
    const row = rows[0]
    if (row === undefined) return context.json({ error: "entry_not_found", message: "没有这张图片" }, 404)
    return context.json({ remove: row.useCount >= after, useCount: row.useCount })
  })

  app.post("/agent/media-removed", async (context) => {
    const body = (await context.req.json().catch(() => null)) as { boxId?: string; entryId?: string } | null
    const device = await agentDevice(sql, bearer(context.req.header("authorization")), body?.boxId ?? "")
    if (device === null) return context.body(null, 401)
    const entryId = body?.entryId ?? ""
    if (!/^[0-9a-f-]{36}$/i.test(entryId)) return context.json({ error: "invalid_entry_id" }, 400)
    const rows = await sql<{ deviceId: string }[]>`
      select device_id::text as "deviceId" from box_share_entry where id = ${entryId}::uuid
    `
    const row = rows[0]
    if (row === undefined) return context.json({ removed: true })
    if (!(await sameAssignee(sql, device.deviceId, row.deviceId))) {
      return context.json({ error: "entry_not_found" }, 404)
    }
    await sql`delete from box_share_entry where id = ${entryId}::uuid`
    return context.json({ removed: true })
  })
}
