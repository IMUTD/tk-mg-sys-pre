import type { Context, Hono } from "hono"
import type { Sql, TransactionSql } from "postgres"
import { z } from "zod"

import { administratorFor } from "./business-labels"

export type ChainRemark = { readonly id: string; readonly name: string }
export type ChainRemarkKind = "behavior" | "task-chain"

const unique = (values: readonly string[]): string[] => [...new Set(values)]

export const remarkMap = async (
  sql: Sql | TransactionSql,
  kind: ChainRemarkKind,
  ids: readonly string[],
): Promise<Map<string, ChainRemark[]>> => {
  const map = new Map<string, ChainRemark[]>()
  if (ids.length === 0) return map
  const rows =
    kind === "behavior"
      ? await sql<{ id: string; name: string; ownerId: string }[]>`
          select r.chain_id::text as "ownerId", l.id::text as id, l.name
          from behavior_chain_remark r
          join business_label l on l.id = r.label_id
          where r.chain_id = any(${ids}::uuid[])
          order by l.name, l.id
        `
      : await sql<{ id: string; name: string; ownerId: string }[]>`
          select r.task_chain_id::text as "ownerId", l.id::text as id, l.name
          from task_chain_remark r
          join business_label l on l.id = r.label_id
          where r.task_chain_id = any(${ids}::uuid[])
          order by l.name, l.id
        `
  for (const row of rows) {
    const current = map.get(row.ownerId) ?? []
    current.push({ id: row.id, name: row.name })
    map.set(row.ownerId, current)
  }
  return map
}

export const assignChainRemarks = async (
  sql: Sql,
  kind: ChainRemarkKind,
  administratorId: string,
  ids: readonly string[],
  remarkIds: readonly string[],
  mode: "add" | "replace",
): Promise<"ok" | "invalid" | "not_found"> => {
  const chainIds = unique(ids)
  const labels = unique(remarkIds)
  if (chainIds.length === 0 || chainIds.length > 200 || labels.length > 40) return "invalid"
  const scope = kind
  return sql.begin(async (tx) => {
    const owned =
      kind === "behavior"
        ? await tx<{ id: string }[]>`
            select id::text as id from behavior_chain
            where administrator_id = ${administratorId}::uuid and id = any(${chainIds}::uuid[])
          `
        : await tx<{ id: string }[]>`
            select id::text as id from task_chain
            where administrator_id = ${administratorId}::uuid and id = any(${chainIds}::uuid[])
          `
    if (owned.length !== chainIds.length) return "not_found"
    if (labels.length > 0) {
      const found = await tx<{ id: string }[]>`
        select id::text as id from business_label
        where administrator_id = ${administratorId}::uuid and scope = ${scope}
          and kind = 'remark' and id = any(${labels}::uuid[])
      `
      if (found.length !== labels.length) return "invalid"
    }
    if (mode === "replace") {
      if (kind === "behavior") {
        await tx`delete from behavior_chain_remark where chain_id = any(${chainIds}::uuid[])`
      } else {
        await tx`delete from task_chain_remark where task_chain_id = any(${chainIds}::uuid[])`
      }
    }
    if (labels.length === 0) return "ok"
    if (kind === "behavior") {
      await tx`
        insert into behavior_chain_remark (chain_id, label_id)
        select chain.chain_id, label.label_id
        from unnest(${chainIds}::uuid[]) as chain(chain_id)
        cross join unnest(${labels}::uuid[]) as label(label_id)
        on conflict do nothing
      `
    } else {
      await tx`
        insert into task_chain_remark (task_chain_id, label_id)
        select chain.chain_id, label.label_id
        from unnest(${chainIds}::uuid[]) as chain(chain_id)
        cross join unnest(${labels}::uuid[]) as label(label_id)
        on conflict do nothing
      `
    }
    return "ok"
  })
}

const AssignSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  mode: z.enum(["add", "replace"]),
  remarkIds: z.array(z.string().uuid()).max(40),
})

export const registerChainRemarkRoutes = (
  app: Hono,
  sql: Sql,
  userFromRequest: (sql: Sql, request: Request) => Promise<string | null>,
): void => {
  const assign = (kind: ChainRemarkKind, invalid: string) => {
    return async (context: Context) => {
      const user = await userFromRequest(sql, context.req.raw)
      if (user === null) return context.json({ error: "authentication_required" }, 401)
      const administratorId = await administratorFor(sql, user)
      if (administratorId === null) return context.json({ error: "not_found" }, 404)
      const body = AssignSchema.safeParse(await context.req.json().catch(() => null))
      if (!body.success) return context.json({ error: invalid }, 400)
      const result = await assignChainRemarks(
        sql,
        kind,
        administratorId,
        body.data.ids,
        body.data.remarkIds,
        body.data.mode,
      )
      if (result === "not_found") return context.json({ error: "not_found" }, 404)
      if (result !== "ok") return context.json({ error: invalid }, 400)
      return context.json({ ok: true })
    }
  }
  app.post("/api/behavior-chains/remarks", assign("behavior", "invalid_chain"))
  app.post("/api/task-chains/remarks", assign("task-chain", "invalid_task_chain"))
}
