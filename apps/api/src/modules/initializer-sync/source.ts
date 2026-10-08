import type { Sql } from "postgres"
import { z } from "zod"

const AdminSchema = z.object({
  id: z.string().min(1),
  username: z.string(),
  email: z.string().trim().toLowerCase().email(),
  passwordHash: z.string().regex(/^\$2[aby]\$\d{2}\$/),
  enabled: z.boolean(),
})
const BoxSchema = z.object({
  id: z.string().min(1),
  ip: z.string().min(1),
  type: z.string(),
  firmware: z.string(),
  memory: z.string(),
  memoryPct: z.number().int(),
  disk: z.string(),
  diskPct: z.number().int(),
  online: z.boolean(),
  lastSeenAt: z.coerce.date().nullable(),
  adminId: z.string().nullable(),
})
export const SnapshotSchema = z
  .object({
    admins: z.array(AdminSchema),
    boxes: z.array(BoxSchema),
  })
  .superRefine((snapshot, context) => {
    const ids = new Set(snapshot.admins.map((admin) => admin.id))
    if (
      ids.size !== snapshot.admins.length ||
      new Set(snapshot.admins.map((admin) => admin.email)).size !== snapshot.admins.length ||
      new Set(snapshot.boxes.map((box) => box.id)).size !== snapshot.boxes.length ||
      snapshot.boxes.some((box) => box.adminId !== null && !ids.has(box.adminId))
    ) {
      context.addIssue({ code: "custom", message: "Inconsistent initializer snapshot" })
    }
  })
export type InitializerSnapshot = z.infer<typeof SnapshotSchema>

export const readInitializerSnapshot = async (source: Sql): Promise<InitializerSnapshot> =>
  source.begin("isolation level repeatable read read only", async (tx) => {
    await tx`set local statement_timeout = '10s'`
    const admins = await tx`
      select id::text, username, email, password_hash as "passwordHash", enabled from init_admin
    `
    const boxes = await tx`
      select b.id, b.ip, b.type, b.firmware, b.memory, b.memory_pct as "memoryPct",
        b.disk, b.disk_pct as "diskPct", b.online, b.last_seen_at as "lastSeenAt",
        ab.admin_id::text as "adminId"
      from init_box b left join init_admin_box ab on ab.box_id = b.id
    `
    return SnapshotSchema.parse({ admins, boxes })
  })
