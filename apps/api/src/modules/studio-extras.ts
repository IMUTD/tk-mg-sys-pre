import { createHash } from "node:crypto"

import type { Hono } from "hono"
import type { Sql } from "postgres"
import { z } from "zod"

import { administratorFor } from "./business-labels"

type UserFromRequest = (sql: Sql, request: Request) => Promise<string | null>

const card = z.object({
  ids: z.array(z.string()).max(8000),
  keyword: z.string().max(200),
  mode: z.enum(["and", "or", "nand"]),
  selected: z.record(z.string(), z.array(z.string()).max(800)),
})

const payloadSchema = z.object({
  accountCard: card,
  chances: z.record(z.string(), z.number().min(0).max(100)),
  continent: z.string().max(40),
  language: z.string().max(40).nullable(),
  limits: z.record(z.string(), z.string().max(8)),
  mediaCards: z.record(z.string(), card),
  mediaDraw: z.record(z.string(), z.enum(["random", "sequence"])),
  proxyCard: card,
  refreshes: z.record(z.string(), z.boolean()),
  instances: z
    .array(z.object({ deviceId: z.string().uuid(), index: z.number().int().min(1).max(5) }))
    .max(2000),
  pitRange: z.array(z.number().int().min(1).max(5)).max(5),
  region: z.string().max(40).nullable(),
  repeats: z.record(z.string(), z.unknown()),
  retries: z.record(z.string(), z.unknown()),
  taskChainId: z.string().uuid().nullable(),
  taskRemarks: z.array(z.string().max(80)).max(40),
  textCards: z.record(z.string(), card),
})

const unique = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "23505"

export const registerStudioExtras = (
  app: Hono,
  sql: Sql,
  userFromRequest: UserFromRequest,
): void => {
  const adminOf = async (request: Request): Promise<string | null> => {
    const user = await userFromRequest(sql, request)
    if (user === null) return null
    return administratorFor(sql, user)
  }

  app.get("/api/quick-tasks", async (context) => {
    const admin = await adminOf(context.req.raw)
    if (admin === null) return context.json({ error: "authentication_required" }, 401)
    const rows = await sql<{ id: string; name: string; payload: unknown }[]>`
      select id::text as id, name, payload from quick_task
      where administrator_id = ${admin}::uuid
      order by created_at desc
    `
    return context.json({ items: rows })
  })

  app.post("/api/quick-tasks", async (context) => {
    const admin = await adminOf(context.req.raw)
    if (admin === null) return context.json({ error: "authentication_required" }, 401)
    const body = z
      .object({ name: z.string().trim().min(1).max(40), payload: payloadSchema })
      .safeParse(await context.req.json().catch(() => null))
    if (!body.success) return context.json({ error: "invalid_payload" }, 400)
    try {
      const rows = await sql<{ id: string }[]>`
        insert into quick_task (administrator_id, name, payload)
        values (${admin}::uuid, ${body.data.name}, ${sql.json(body.data.payload)})
        returning id::text as id
      `
      return context.json({ id: rows[0]?.id ?? "" }, 201)
    } catch (error) {
      if (unique(error)) return context.json({ error: "name_taken", message: "这个名称已经有了" }, 409)
      throw error
    }
  })

  app.delete("/api/quick-tasks/:id", async (context) => {
    const admin = await adminOf(context.req.raw)
    if (admin === null) return context.json({ error: "authentication_required" }, 401)
    const id = context.req.param("id")
    if (!/^[0-9a-f-]{36}$/i.test(id)) return context.json({ error: "invalid_payload" }, 400)
    const rows = await sql<{ id: string }[]>`
      delete from quick_task
      where id = ${id}::uuid and administrator_id = ${admin}::uuid
      returning id::text as id
    `
    if (rows.length === 0) return context.json({ error: "not_found" }, 404)
    return context.json({ ok: true })
  })

  app.post("/api/match-images", async (context) => {
    const admin = await adminOf(context.req.raw)
    if (admin === null) return context.json({ error: "authentication_required" }, 401)
    const form = await context.req.formData().catch(() => null)
    const file = form?.get("file")
    if (!(file instanceof File)) return context.json({ error: "invalid_payload" }, 400)
    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.length === 0 || bytes.length > 2_000_000) {
      return context.json({ error: "invalid_payload", message: "图片不能超过 2MB" }, 400)
    }
    const sha = createHash("sha256").update(bytes).digest("hex")
    const rows = await sql<{ id: string }[]>`
      insert into match_image (administrator_id, sha256, size_bytes, bytes)
      values (${admin}::uuid, ${sha}, ${bytes.length}, ${bytes})
      on conflict (administrator_id, sha256) do update set sha256 = excluded.sha256
      returning id::text as id
    `
    return context.json({ id: rows[0]?.id ?? "" })
  })

  app.get("/api/match-images", async (context) => {
    const admin = await adminOf(context.req.raw)
    if (admin === null) return context.json({ error: "authentication_required" }, 401)
    const rows = await sql<{ createdAt: Date; id: string; sizeBytes: number }[]>`
      select id::text as id, size_bytes as "sizeBytes", created_at as "createdAt"
      from match_image
      where administrator_id = ${admin}::uuid
      order by created_at desc, id desc
    `
    return context.json({ images: rows })
  })

  app.get("/api/match-images/:id", async (context) => {
    const admin = await adminOf(context.req.raw)
    if (admin === null) return context.json({ error: "authentication_required" }, 401)
    const id = context.req.param("id")
    if (!/^[0-9a-f-]{36}$/i.test(id)) return context.json({ error: "invalid_payload" }, 400)
    const rows = await sql<{ bytes: Buffer }[]>`
      select bytes from match_image
      where id = ${id}::uuid and administrator_id = ${admin}::uuid
    `
    const bytes = rows[0]?.bytes
    if (bytes === undefined || bytes.length === 0) return context.json({ error: "not_found" }, 404)
    return context.body(bytes, 200, { "content-type": matchImageType(bytes) })
  })

  app.delete("/api/match-images/:id", async (context) => {
    const admin = await adminOf(context.req.raw)
    if (admin === null) return context.json({ error: "authentication_required" }, 401)
    const id = context.req.param("id")
    if (!/^[0-9a-f-]{36}$/i.test(id)) return context.json({ error: "invalid_payload" }, 400)
    const rows = await sql<{ id: string }[]>`
      delete from match_image
      where id = ${id}::uuid and administrator_id = ${admin}::uuid
      returning id::text as id
    `
    if (rows.length === 0) return context.json({ error: "not_found" }, 404)
    return context.json({ ok: true })
  })
}

const matchImageType = (bytes: Buffer): string => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg"
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png"
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString("ascii").startsWith("GIF8")) return "image/gif"
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp"
  return "application/octet-stream"
}
