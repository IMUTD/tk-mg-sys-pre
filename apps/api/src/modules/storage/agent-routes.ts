import { createHash, randomUUID } from "node:crypto"

import type { Hono } from "hono"
import type { Sql } from "postgres"

import { UserIdSchema } from "../../lib/authorization"
import { backupPhone } from "../share-path"
import type { SecretCipher } from "../../lib/crypto"
import {
  boxDirForNasBucket,
  dirNameOk,
  fileNameOk,
  nasCommitShaOk,
  nasDeleteKeyOk,
  nasDirKey,
  nasObjectKey,
  nasTransferAction,
  type NasKind,
} from "./nas-place"
import type { StorageRepository } from "./repository"
import { readStoredSecrets } from "./service"

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex")

const bearer = (header: string | undefined): string => {
  const value = header ?? ""
  return value.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : ""
}

type AgentBox = { readonly assigneeUserId: string; readonly deviceId: string }

const agentBox = async (sql: Sql, token: string, boxId: string): Promise<AgentBox | null> => {
  if (token === "" || boxId === "") return null
  const rows = await sql<{ assigneeUserId: string | null; deviceId: string }[]>`
    select d.id::text as "deviceId", d.assignee_user_id::text as "assigneeUserId"
    from device_agent a
    join device d on d.id = a.device_id
    where a.token_hash = ${hashToken(token)} and d.external_id = ${boxId} and d.enabled = true
  `
  const row = rows[0]
  if (row === undefined || row.assigneeUserId === null || row.assigneeUserId.length === 0) return null
  return { assigneeUserId: row.assigneeUserId, deviceId: row.deviceId }
}

const agentByToken = async (sql: Sql, token: string): Promise<AgentBox | null> => {
  if (token === "") return null
  const rows = await sql<{ assigneeUserId: string | null; deviceId: string }[]>`
    select d.id::text as "deviceId", d.assignee_user_id::text as "assigneeUserId"
    from device_agent a
    join device d on d.id = a.device_id
    where a.token_hash = ${hashToken(token)} and d.enabled = true
  `
  if (rows.length !== 1) return null
  const row = rows[0]
  if (row === undefined || row.assigneeUserId === null || row.assigneeUserId.length === 0) return null
  return { assigneeUserId: row.assigneeUserId, deviceId: row.deviceId }
}

const missingText = (kind: string): string => (kind === "video" ? "没有这个视频" : "没有这张图片")

const folderFor = (kind: string): "share" | "video" | null =>
  kind === "image" ? "share" : kind === "video" ? "video" : null

export const nasObjectKeyOk = (assigneeId: string, objectKey: string, folder: string): boolean => {
  const prefix = `${assigneeId}/${folder}/`
  if (!objectKey.startsWith(prefix) || objectKey.length > 1024) return false
  const name = objectKey.slice(prefix.length)
  return name.length > 0 && !name.includes("/") && !name.includes("\\") && !name.includes("..")
}

export const registerNasAgentRoutes = (
  app: Hono,
  sql: Sql,
  cipher: SecretCipher | undefined,
  repository: StorageRepository,
): void => {
  app.get("/agent/nas-config", async (context) => {
    const device = await agentByToken(sql, bearer(context.req.header("authorization")))
    const requested = context.req.query("nasId") ?? ""
    const adminId = device === null ? null : UserIdSchema.safeParse(device.assigneeUserId)
    const stored =
      cipher === undefined || adminId === null || !adminId.success ? null : await repository.get(adminId.data)
    const secrets = stored === null || cipher === undefined ? {} : readStoredSecrets(cipher, stored.encryptedCredentials)
    const item = stored === null || requested.length === 0 ? undefined : stored.items.find((entry) => entry.id === requested)
    const secret = item === undefined ? "" : (secrets[item.id] ?? "")
    if (device === null || item === undefined || secret.length === 0 || item.bucket.length === 0 || item.endpoint.length === 0) {
      return context.json({ message: "NAS未配置" }, 404)
    }
    return context.json({
      accessKey: item.username,
      bucket: item.bucket,
      endpoint: item.endpoint,
      loginUrl: item.loginUrl,
      prefix: `${device.assigneeUserId}/`,
      secret,
    })
  })

  app.post("/agent/nas-used", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      boxId?: string
      deleteAfter?: number
      kind?: string
      objectKey?: string
    } | null
    const kind = body?.kind === "video" ? "video" : body?.kind === "image" ? "image" : ""
    const folder = folderFor(kind)
    const after = Number(body?.deleteAfter ?? 0)
    const objectKey = body?.objectKey ?? ""
    if (folder === null || !Number.isInteger(after) || after < 1 || objectKey.length === 0) {
      return context.json({ error: "invalid_payload", message: "上传次数无效" }, 400)
    }
    const device = await agentBox(sql, bearer(context.req.header("authorization")), body?.boxId ?? "")
    if (device === null) return context.body(null, 401)
    if (!nasObjectKeyOk(device.assigneeUserId, objectKey, folder)) {
      return context.json({ error: "entry_not_found", message: missingText(kind) }, 404)
    }
    const rows = await sql<{ useCount: number }[]>`
      insert into nas_use (administrator_id, object_key, use_count)
      values (${device.assigneeUserId}::uuid, ${objectKey}, 1)
      on conflict (administrator_id, object_key) do update
        set use_count = nas_use.use_count + 1
      returning use_count as "useCount"
    `
    const row = rows[0]
    if (row === undefined) return context.json({ error: "entry_not_found", message: missingText(kind) }, 404)
    return context.json({ remove: row.useCount >= after, useCount: row.useCount })
  })

  app.post("/agent/nas-removed", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      boxId?: string
      kind?: string
      objectKey?: string
    } | null
    const kind = body?.kind === "video" ? "video" : body?.kind === "image" ? "image" : ""
    const folder = folderFor(kind)
    const objectKey = body?.objectKey ?? ""
    if (folder === null || objectKey.length === 0) {
      return context.json({ error: "invalid_payload", message: missingText(kind === "" ? "image" : kind) }, 400)
    }
    const device = await agentBox(sql, bearer(context.req.header("authorization")), body?.boxId ?? "")
    if (device === null) return context.body(null, 401)
    if (!nasObjectKeyOk(device.assigneeUserId, objectKey, folder)) {
      return context.json({ error: "entry_not_found", message: missingText(kind) }, 404)
    }
    await sql`
      delete from nas_use
      where administrator_id = ${device.assigneeUserId}::uuid and object_key = ${objectKey}
    `
    return context.json({ removed: true })
  })

  app.post("/agent/backup-recorded", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      boxId?: string
      directory?: string
      name?: string
      nasId?: string
      sha256?: string
      size?: number
    } | null
    const device = await agentBox(sql, bearer(context.req.header("authorization")), body?.boxId ?? "")
    const directory = (body?.directory ?? "").trim()
    const name = (body?.name ?? "").trim()
    const sha = (body?.sha256 ?? "").toLowerCase()
    const size = Number(body?.size ?? 0)
    const nasId = body?.nasId ?? ""
    const stamped = backupPhone(name)
    if (device === null) return context.body(null, 401)
    if (!dirNameOk(directory)) return context.json({ error: "invalid_payload", message: "请选择目录" }, 400)
    if (stamped.phoneName.length === 0 || stamped.namedAt === null || !fileNameOk(name) || (sha !== "" && !/^[0-9a-f]{64}$/.test(sha)) || !Number.isFinite(size) || size < 0 || !/^[0-9a-f-]{36}$/i.test(nasId)) {
      return context.json({ error: "invalid_payload", message: "云机名无效" }, 400)
    }
    const card = await ownCard(sql, cipher, repository, device.assigneeUserId, nasId)
    const key = nasDirKey(directory, name)
    if (card === null || card.bucket !== "backup" || key === null) {
      return context.json({ error: "entry_not_found", message: "NAS未配置" }, 404)
    }
    const existing = await sql<{ id: string }[]>`
      select id::text as id from box_share_entry
      where place = 'nas' and assignee_user_id = ${device.assigneeUserId}::uuid
        and nas_id = ${nasId}::uuid and nas_key = ${key}
    `
    const found = existing[0]
    if (found !== undefined) {
      await sql`
        update box_share_entry set dest_dir = ${directory}, phone_name = ${stamped.phoneName}, saved_at = ${stamped.namedAt}
        where id = ${found.id}::uuid and place = 'nas'
      `
      return context.json({ action: "replace", entryId: found.id })
    }
    const scanId = await ensureScan(sql, device.deviceId)
    const rows = await sql<{ id: string }[]>`
      insert into box_share_entry (
        device_id, bucket, relative_path, parent_path, name, kind, category, size_bytes, sha256, last_scan_id,
        phone_name, saved_at, assignee_user_id, box_online, place, dest_dir
      ) values (
        ${device.deviceId}::uuid, 'backup', ${name}, '', ${name}, 'file', 'other', ${Math.trunc(size)}, ${sha}, ${scanId}::uuid,
        ${stamped.phoneName}, ${stamped.namedAt}, ${device.assigneeUserId}::uuid,
        (select status = 'online' and enabled from device where id = ${device.deviceId}::uuid),
        'box', ${directory}
      )
      on conflict (device_id, bucket, relative_path) do update set
        size_bytes = excluded.size_bytes,
        sha256 = excluded.sha256,
        phone_name = excluded.phone_name,
        saved_at = excluded.saved_at,
        dest_dir = excluded.dest_dir,
        seen_at = now()
      where box_share_entry.place = 'box'
      returning id::text as id
    `
    const row = rows[0]
    if (row === undefined) return context.json({ error: "entry_not_found", message: "没有这个备份" }, 409)
    return context.json({ action: "upload", entryId: row.id })
  })

  app.post("/agent/backup-on-nas", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      action?: string
      boxId?: string
      entryId?: string
      nasId?: string
      phase?: string
      sha256?: string
      size?: number
    } | null
    const device = await agentBox(sql, bearer(context.req.header("authorization")), body?.boxId ?? "")
    const entryId = body?.entryId ?? ""
    const nasId = body?.nasId ?? ""
    const sha = (body?.sha256 ?? "").toLowerCase()
    const size = Number(body?.size ?? 0)
    if (device === null) return context.body(null, 401)
    if (!/^[0-9a-f-]{36}$/i.test(entryId) || !/^[0-9a-f-]{36}$/i.test(nasId) || (sha !== "" && !/^[0-9a-f]{64}$/.test(sha)) || !Number.isFinite(size) || size < 0) {
      return context.json({ error: "invalid_payload" }, 400)
    }
    const card = await ownCard(sql, cipher, repository, device.assigneeUserId, nasId)
    const rows = await sql<{ category: string; destDir: string; name: string; place: string; sha256: string }[]>`
      select category, dest_dir as "destDir", name, place, sha256 from box_share_entry
      where id = ${entryId}::uuid and assignee_user_id = ${device.assigneeUserId}::uuid
    `
    const row = rows[0]
    if (card === null || row === undefined) return context.json({ error: "entry_not_found", message: "没有这个备份" }, 404)
    const kind = nasKind(card.bucket, row.category)
    const key = dirNameOk(row.destDir)
      ? nasDirKey(row.destDir, row.name)
      : nasObjectKey(device.assigneeUserId, row.name)
    if (kind === null || key === null || !nasCommitShaOk(row.place, kind, row.sha256, sha)) {
      return context.json({ error: "entry_not_found", message: "没有这个备份" }, 404)
    }
    const existing = await sql<{ id: string; sha256: string }[]>`
      select id::text as id, sha256 from box_share_entry
      where place = 'nas' and kind = 'file' and assignee_user_id = ${device.assigneeUserId}::uuid
        and nas_id = ${nasId}::uuid and name = ${row.name} and id <> ${entryId}::uuid
        and (
          (${kind} = 'backup' and bucket = 'backup')
          or (${kind} <> 'backup' and category = ${kind} and bucket <> 'backup')
        )
    `
    const other = existing[0]
    const action = nasTransferAction(kind, other === undefined ? null : other.sha256, sha)
    const marker = card.bucket === "backup" && dirNameOk(row.destDir) ? `${row.destDir}/` : ""
    const savedAt = kind === "backup" ? (backupPhone(row.name).namedAt ?? new Date()) : new Date()
    if (body?.phase === "check") {
      if (action === "stop") return context.json({ action, message: "NAS 上已有同名文件" }, 409)
      return context.json({ action, entryId: action === "drop" && other !== undefined ? other.id : entryId, key, marker })
    }
    if (action === "stop") return context.json({ error: "entry_not_found", message: "NAS 上已有同名文件" }, 409)
    if (action === "drop") {
      if (marker.length > 0) await ensureBackupDir(sql, entryId, row.destDir, nasId, device.assigneeUserId)
      await sql`delete from box_share_entry where id = ${entryId}::uuid and place = 'box'`
      return context.json({ action: "drop", entryId: other?.id ?? entryId, key, marker })
    }
    const targetId = action === "replace" && other !== undefined ? other.id : entryId
    await sql`
      update box_share_entry set
        place = 'nas',
        nas_id = ${nasId}::uuid,
        nas_key = ${key},
        size_bytes = ${Math.trunc(size)},
        sha256 = ${sha},
        saved_at = ${savedAt},
        seen_at = now()
      where id = ${targetId}::uuid and assignee_user_id = ${device.assigneeUserId}::uuid
    `
    if (marker.length > 0) await ensureBackupDir(sql, targetId, row.destDir, nasId, device.assigneeUserId)
    if (targetId !== entryId) {
      await sql`delete from box_share_entry where id = ${entryId}::uuid and place = 'box'`
    }
    return context.json({ action, entryId: targetId, key, marker })
  })

  app.post("/agent/backup-nas-locate", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      boxId?: string
      directory?: string
      name?: string
      nasId?: string
    } | null
    const device = await agentBox(sql, bearer(context.req.header("authorization")), body?.boxId ?? "")
    const directory = (body?.directory ?? "").trim()
    const name = (body?.name ?? "").trim()
    const nasId = body?.nasId ?? ""
    if (device === null) return context.body(null, 401)
    if (!dirNameOk(directory)) return context.json({ error: "invalid_payload", message: "请选择目录" }, 400)
    if (!fileNameOk(name) || !/^[0-9a-f-]{36}$/i.test(nasId)) {
      return context.json({ error: "invalid_payload", message: "云机名无效" }, 400)
    }
    const card = await ownCard(sql, cipher, repository, device.assigneeUserId, nasId)
    if (card === null || card.bucket !== "backup") {
      return context.json({ error: "entry_not_found", message: "没有这个备份" }, 404)
    }
    const rows = await sql<{ id: string; nasKey: string; sha256: string; sizeBytes: string }[]>`
      select id::text as id, nas_key as "nasKey", sha256, size_bytes::text as "sizeBytes"
      from box_share_entry
      where place = 'nas' and kind = 'file' and assignee_user_id = ${device.assigneeUserId}::uuid
        and nas_id = ${nasId}::uuid and phone_name = ${name}
        and split_part(nas_key, '/', 1) = ${directory}
        and split_part(nas_key, '/', 2) <> ''
        and split_part(nas_key, '/', 3) = ''
      order by saved_at desc nulls last, seen_at desc
      limit 1
    `
    const row = rows[0]
    if (row === undefined || !nasDeleteKeyOk(row.nasKey)) {
      return context.json({ error: "entry_not_found", message: "没有这个备份" }, 404)
    }
    return context.json({ entryId: row.id, nasKey: row.nasKey, sha256: row.sha256, sizeBytes: Number(row.sizeBytes) })
  })

  app.post("/agent/backup-nas-extras", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      boxId?: string
      directory?: string
      name?: string
      nasId?: string
    } | null
    const device = await agentBox(sql, bearer(context.req.header("authorization")), body?.boxId ?? "")
    const directory = (body?.directory ?? "").trim()
    const name = (body?.name ?? "").trim()
    const nasId = body?.nasId ?? ""
    if (device === null) return context.body(null, 401)
    if (!dirNameOk(directory)) return context.json({ error: "invalid_payload", message: "请选择目录" }, 400)
    if (!fileNameOk(name) || !/^[0-9a-f-]{36}$/i.test(nasId)) {
      return context.json({ error: "invalid_payload", message: "云机名无效" }, 400)
    }
    const card = await ownCard(sql, cipher, repository, device.assigneeUserId, nasId)
    if (card === null || card.bucket !== "backup") {
      return context.json({ error: "entry_not_found", message: "没有这个备份" }, 404)
    }
    const rows = await sql<{ id: string; name: string; nasKey: string }[]>`
      select id::text as id, name, nas_key as "nasKey"
      from box_share_entry
      where place = 'nas' and kind = 'file' and assignee_user_id = ${device.assigneeUserId}::uuid
        and nas_id = ${nasId}::uuid and phone_name = ${name}
        and split_part(nas_key, '/', 1) = ${directory}
        and split_part(nas_key, '/', 2) <> ''
        and split_part(nas_key, '/', 3) = ''
      order by saved_at desc nulls last, seen_at desc
    `
    const kept = rows.find((row) => nasDeleteKeyOk(row.nasKey))
    if (kept === undefined) return context.json({ error: "entry_not_found", message: "没有这个备份" }, 404)
    return context.json({
      extras: rows.filter((row) => row.id !== kept.id && nasDeleteKeyOk(row.nasKey)),
      kept: { id: kept.id, name: kept.name, nasKey: kept.nasKey },
    })
  })

  app.post("/agent/backup-nas-removed", async (context) => {
    const body = (await context.req.json().catch(() => null)) as { boxId?: string; entryId?: string } | null
    const device = await agentBox(sql, bearer(context.req.header("authorization")), body?.boxId ?? "")
    const entryId = body?.entryId ?? ""
    if (device === null) return context.body(null, 401)
    if (!/^[0-9a-f-]{36}$/i.test(entryId)) return context.json({ error: "invalid_payload" }, 400)
    const current = await sql<{ nasId: string | null; nasKey: string }[]>`
      select nas_id::text as "nasId", nas_key as "nasKey" from box_share_entry
      where id = ${entryId}::uuid and place = 'nas' and kind = 'file'
        and assignee_user_id = ${device.assigneeUserId}::uuid
    `
    const leaving = current[0]
    if (leaving?.nasId && nasDeleteKeyOk(leaving.nasKey)) {
      const directory = leaving.nasKey.slice(0, leaving.nasKey.indexOf("/"))
      const card = await ownCard(sql, cipher, repository, device.assigneeUserId, leaving.nasId)
      if (card?.bucket === "backup" && directory !== device.assigneeUserId && dirNameOk(directory)) {
        await ensureBackupDir(sql, entryId, directory, leaving.nasId, device.assigneeUserId)
      }
    }
    await sql`
      delete from box_share_entry
      where id = ${entryId}::uuid and place = 'nas' and kind = 'file' and assignee_user_id = ${device.assigneeUserId}::uuid
    `
    return context.json({ removed: true })
  })

  app.post("/agent/nas-listed", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      boxId?: string
      nasId?: string
      objects?: { key?: string; size?: number }[]
    } | null
    const device = await agentBox(sql, bearer(context.req.header("authorization")), body?.boxId ?? "")
    const nasId = body?.nasId ?? ""
    const objects = body?.objects ?? []
    if (device === null) return context.body(null, 401)
    if (!/^[0-9a-f-]{36}$/i.test(nasId) || objects.length > 1000) {
      return context.json({ error: "invalid_payload" }, 400)
    }
    const card = await ownCard(sql, cipher, repository, device.assigneeUserId, nasId)
    const mapped = card === null ? null : boxDirForNasBucket(card.bucket)
    if (card === null || mapped === null) return context.json({ error: "entry_not_found", message: "NAS未配置" }, 404)
    const prefix = `${device.assigneeUserId}/`
    const scanId = await ensureScan(sql, device.deviceId)
    let stored = 0
    for (const object of objects) {
      const key = object.key ?? ""
      const size = Number(object.size ?? 0)
      if (!key.startsWith(prefix) || !Number.isFinite(size) || size < 0) continue
      const name = key.slice(prefix.length)
      if (!fileNameOk(name) || name.endsWith(".uploading")) continue
      const current = await sql<{ id: string; place: string }[]>`
        select id::text as id, place from box_share_entry
        where device_id = ${device.deviceId}::uuid and bucket = ${mapped.bucket} and relative_path = ${name}
      `
      const same = await sql<{ id: string }[]>`
        select id::text as id from box_share_entry
        where place = 'nas' and nas_id = ${nasId}::uuid and nas_key = ${key}
          and assignee_user_id = ${device.assigneeUserId}::uuid
      `
      if (same[0] !== undefined) {
        await sql`
          update box_share_entry set size_bytes = ${Math.trunc(size)}, seen_at = now()
          where id = ${same[0].id}::uuid and place = 'nas'
        `
        stored += 1
        continue
      }
      if (current[0]?.place === "box") continue
      if (current[0] !== undefined) continue
      await sql`
        insert into box_share_entry (
          device_id, bucket, relative_path, parent_path, name, kind, category, size_bytes, sha256, last_scan_id,
          phone_name, saved_at, assignee_user_id, box_online, place, nas_id, nas_key
        ) values (
          ${device.deviceId}::uuid, ${mapped.bucket}, ${name}, '', ${name}, 'file', ${mapped.category},
          ${Math.trunc(size)}, '', ${scanId}::uuid,
          ${mapped.bucket === "backup" ? name : ""}, now(),
          ${device.assigneeUserId}::uuid,
          (select status = 'online' and enabled from device where id = ${device.deviceId}::uuid),
          'nas', ${nasId}::uuid, ${key}
        )
      `
      stored += 1
    }
    return context.json({ stored })
  })

  app.post("/agent/nas-delete-items", async (context) => {
    const body = (await context.req.json().catch(() => null)) as { boxId?: string; entryIds?: string[] } | null
    const device = await agentBox(sql, bearer(context.req.header("authorization")), body?.boxId ?? "")
    const entryIds = [...new Set(body?.entryIds ?? [])]
    if (device === null) return context.body(null, 401)
    if (entryIds.length === 0 || entryIds.length > 200 || !entryIds.every((id) => /^[0-9a-f-]{36}$/i.test(id))) {
      return context.json({ error: "invalid_payload" }, 400)
    }
    const rows = await sql<{ id: string; nasId: string; nasKey: string }[]>`
      select id::text as id, nas_id::text as "nasId", nas_key as "nasKey"
      from box_share_entry
      where id = any(${entryIds}::uuid[]) and place = 'nas' and kind = 'file'
        and assignee_user_id = ${device.assigneeUserId}::uuid
    `
    const cards = new Map<string, string | null>()
    const items = []
    for (const row of rows) {
      if (typeof row.nasKey !== "string" || !nasDeleteKeyOk(row.nasKey)) continue
      if (!cards.has(row.nasId)) {
        const card = await ownCard(sql, cipher, repository, device.assigneeUserId, row.nasId)
        cards.set(row.nasId, card?.bucket ?? null)
      }
      const bucket = cards.get(row.nasId)
      if (bucket !== "pictures" && bucket !== "videos" && bucket !== "backup") continue
      const directory = row.nasKey.slice(0, row.nasKey.indexOf("/"))
      const marker = bucket === "backup" && directory !== device.assigneeUserId ? `${directory}/` : ""
      items.push({ id: row.id, marker, nasId: row.nasId, nasKey: row.nasKey })
    }
    return context.json({ items })
  })

  app.post("/agent/nas-dir-item", async (context) => {
    const body = (await context.req.json().catch(() => null)) as { boxId?: string; entryId?: string } | null
    const device = await agentBox(sql, bearer(context.req.header("authorization")), body?.boxId ?? "")
    const entryId = body?.entryId ?? ""
    if (device === null) return context.body(null, 401)
    if (!/^[0-9a-f-]{36}$/i.test(entryId)) return context.json({ error: "invalid_payload" }, 400)
    const rows = await sql<{ name: string; nasId: string; nasKey: string }[]>`
      select name, nas_id::text as "nasId", nas_key as "nasKey"
      from box_share_entry
      where id = ${entryId}::uuid and place = 'nas' and kind = 'dir' and bucket = 'backup'
        and assignee_user_id = ${device.assigneeUserId}::uuid
    `
    const row = rows[0]
    if (row === undefined || row.nasKey !== `${row.name}/` || row.name === device.assigneeUserId || !dirNameOk(row.name)) {
      return context.json({ error: "entry_not_found" }, 404)
    }
    const card = await ownCard(sql, cipher, repository, device.assigneeUserId, row.nasId)
    if (card?.bucket !== "backup") return context.json({ error: "entry_not_found" }, 404)
    const files = await sql<{ id: string }[]>`
      select id::text as id from box_share_entry
      where place = 'nas' and kind = 'file' and assignee_user_id = ${device.assigneeUserId}::uuid
        and nas_id = ${row.nasId}::uuid
        and split_part(nas_key, '/', 1) = ${row.name}
        and split_part(nas_key, '/', 2) <> ''
        and split_part(nas_key, '/', 3) = ''
      limit 1
    `
    if (files.length > 0) return context.json({ error: "not_empty", message: "目录里还有备份" }, 409)
    return context.json({ id: entryId, nasId: row.nasId, nasKey: row.nasKey })
  })

  app.post("/agent/nas-dir-removed", async (context) => {
    const body = (await context.req.json().catch(() => null)) as { boxId?: string; entryId?: string } | null
    const device = await agentBox(sql, bearer(context.req.header("authorization")), body?.boxId ?? "")
    const entryId = body?.entryId ?? ""
    if (device === null) return context.body(null, 401)
    if (!/^[0-9a-f-]{36}$/i.test(entryId)) return context.json({ error: "invalid_payload" }, 400)
    const rows = await sql<{ name: string; nasId: string }[]>`
      select name, nas_id::text as "nasId" from box_share_entry
      where id = ${entryId}::uuid and place = 'nas' and kind = 'dir' and bucket = 'backup'
        and assignee_user_id = ${device.assigneeUserId}::uuid
        and nas_key = name || '/'
    `
    const row = rows[0]
    if (row === undefined) return context.json({ removed: true })
    if (!dirNameOk(row.name)) return context.json({ error: "entry_not_found" }, 404)
    const files = await sql<{ id: string }[]>`
      select id::text as id from box_share_entry
      where place = 'nas' and kind = 'file' and assignee_user_id = ${device.assigneeUserId}::uuid
        and nas_id = ${row.nasId}::uuid
        and split_part(nas_key, '/', 1) = ${row.name}
        and split_part(nas_key, '/', 2) <> ''
        and split_part(nas_key, '/', 3) = ''
      limit 1
    `
    if (files.length > 0) return context.json({ error: "not_empty", message: "目录里还有备份" }, 409)
    await sql`
      delete from box_share_entry
      where id = ${entryId}::uuid and place = 'nas' and kind = 'dir'
        and assignee_user_id = ${device.assigneeUserId}::uuid
    `
    return context.json({ removed: true })
  })
}

const ownCard = async (
  sql: Sql,
  cipher: SecretCipher | undefined,
  repository: StorageRepository,
  administratorId: string,
  nasId: string,
): Promise<{ readonly bucket: string } | null> => {
  const adminId = UserIdSchema.safeParse(administratorId)
  if (cipher === undefined || !adminId.success) return null
  const stored = await repository.get(adminId.data)
  const item = stored?.items.find((entry) => entry.id === nasId)
  return item === undefined ? null : { bucket: item.bucket }
}

const nasKind = (bucket: string, category: string): NasKind | null => {
  if (bucket === "backup") return "backup"
  if (bucket === "pictures" && category === "image") return "image"
  if (bucket === "videos" && category === "video") return "video"
  return null
}

const ensureBackupDir = async (
  sql: Sql,
  entryId: string,
  directory: string,
  nasId: string,
  administratorId: string,
): Promise<void> => {
  const marker = `${directory}/`
  const source = await sql<{ deviceId: string }[]>`
    select device_id::text as "deviceId" from box_share_entry where id = ${entryId}::uuid
  `
  const deviceId = source[0]?.deviceId
  if (deviceId === undefined) return
  const scanId = await ensureScan(sql, deviceId)
  await sql`
    insert into box_share_entry (
      device_id, bucket, relative_path, parent_path, name, kind, category, size_bytes, sha256, last_scan_id,
      assignee_user_id, box_online, place, nas_id, nas_key
    )
    select ${deviceId}::uuid, 'backup', ${directory}, '', ${directory}, 'dir', 'other', 0, '', ${scanId}::uuid,
      ${administratorId}::uuid,
      (select status = 'online' and enabled from device where id = ${deviceId}::uuid),
      'nas', ${nasId}::uuid, ${marker}
    where not exists (
      select 1 from box_share_entry
      where place = 'nas' and assignee_user_id = ${administratorId}::uuid
        and nas_id = ${nasId}::uuid and nas_key = ${marker}
    )
    and not exists (
      select 1 from box_share_entry
      where device_id = ${deviceId}::uuid and bucket = 'backup' and relative_path = ${directory}
    )
  `
}

const ensureScan = async (sql: Sql, deviceId: string): Promise<string> => {
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
