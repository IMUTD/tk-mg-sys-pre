import type { Hono } from "hono"
import type { Sql } from "postgres"

import { administratorFor } from "./business-labels"

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

type StoredStep = { readonly input?: Record<string, string>; readonly skill?: string }

type StageRow = {
  readonly chainId: string
  readonly chainName: string
  readonly delays: number[] | null
  readonly guards: string[][] | null
  readonly id: string
  readonly name: string
  readonly parameters: StoredStep[] | null
  readonly paramScopes: Record<string, string>[] | null
  readonly paramSources: Record<string, string>[] | null
  readonly position: number
  readonly taskChainId: string
  readonly updatedAt: Date
}

const stepView = (row: StageRow) =>
  (row.parameters ?? []).map((item, index) => ({
    api: typeof item.skill === "string" ? item.skill : "",
    delayMs: row.delays?.[index] ?? 0,
    guards: row.guards?.[index] ?? [],
    id: index,
    params: item.input ?? {},
    scopes: row.paramScopes?.[index] ?? {},
    sources: row.paramSources?.[index] ?? {},
  }))

const groupStages = (rows: readonly StageRow[], preview: boolean) => {
  const chains: {
    id: string
    name: string
    stages: {
      chainId: string
      chainName: string
      position: number
      steps: ReturnType<typeof stepView>
    }[]
    updatedAt: Date
  }[] = []
  for (const row of rows) {
    let chain = chains.find((item) => item.id === row.taskChainId)
    if (chain === undefined) {
      chain = { id: row.taskChainId, name: row.name, stages: [], updatedAt: row.updatedAt }
      chains.push(chain)
    }
    chain.stages.push({
      chainId: row.chainId,
      chainName: row.chainName,
      position: row.position,
      steps: stepView(row),
    })
  }
  return chains.map((chain) => {
    if (!preview) return chain
    let left = 4
    return {
      ...chain,
      stages: chain.stages.map((stage) => {
        const steps = stage.steps.slice(0, left)
        left -= steps.length
        return { ...stage, steps }
      }),
    }
  })
}

const loadRows = async (sql: Sql, administratorId: string, id?: string) =>
  sql<StageRow[]>`
    select tc.id::text as "taskChainId", tc.name, tc.updated_at as "updatedAt",
      i.position, c.id::text as "chainId", c.name as "chainName",
      c.parameters, c.param_scopes as "paramScopes", c.param_sources as "paramSources",
      c.guards, c.delays
    from task_chain tc
    join task_chain_item i on i.task_chain_id = tc.id
    join behavior_chain c on c.id = i.chain_id
    where tc.administrator_id = ${administratorId}::uuid
      and (${id ?? null}::uuid is null or tc.id = ${id ?? null}::uuid)
    order by tc.updated_at desc, i.position
  `

type StageInput = { readonly chainId: string }

const readStages = (raw: unknown): StageInput[] | null => {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) return null
  const stages: StageInput[] = []
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null
    const record = item as Record<string, unknown>
    if ("repeatCount" in record) return null
    const chainId = record["chainId"]
    if (typeof chainId !== "string" || !isUuid(chainId)) return null
    stages.push({ chainId })
  }
  return stages
}

const chainsReady = async (
  sql: Sql,
  administratorId: string,
  stages: readonly StageInput[],
): Promise<boolean> => {
  const ids = [...new Set(stages.map((item) => item.chainId))]
  const rows = await sql<{ id: string; steps: number }[]>`
    select id::text as id, jsonb_array_length(parameters)::int as steps
    from behavior_chain
    where administrator_id = ${administratorId}::uuid and id = any(${ids}::uuid[])
  `
  const ready = new Map(rows.map((row) => [row.id, row.steps]))
  return stages.every((item) => (ready.get(item.chainId) ?? 0) >= 1)
}

const replaceItems = async (
  sql: Sql,
  taskChainId: string,
  stages: readonly StageInput[],
): Promise<void> => {
  await sql`delete from task_chain_item where task_chain_id = ${taskChainId}::uuid`
  for (const [position, stage] of stages.entries()) {
    await sql`
      insert into task_chain_item (task_chain_id, position, chain_id)
      values (${taskChainId}::uuid, ${position}, ${stage.chainId}::uuid)
    `
  }
}

export const registerTaskChains = (
  app: Hono,
  sql: Sql,
  userFromRequest: (sql: Sql, request: Request) => Promise<string | null>,
): void => {
  app.get("/api/task-chains", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    if (administratorId === null) return context.json([])
    return context.json(groupStages(await loadRows(sql, administratorId), true))
  })

  app.get("/api/task-chains/:id", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const id = context.req.param("id")
    if (administratorId === null || !isUuid(id)) return context.json({ error: "not_found" }, 404)
    const view = groupStages(await loadRows(sql, administratorId, id), false)[0]
    return view === undefined ? context.json({ error: "not_found" }, 404) : context.json(view)
  })

  app.post("/api/task-chains", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const groupId = administratorId === null ? null : await sharedGroup(sql, user, administratorId)
    if (administratorId === null || groupId === null) return context.json({ error: "not_found" }, 404)
    const body = (await context.req.json().catch(() => null)) as {
      name?: unknown
      stages?: unknown
    } | null
    const name = typeof body?.name === "string" ? body.name.trim() : ""
    const stages = readStages(body?.stages)
    if (name.length < 1 || name.length > 80 || stages === null)
      return context.json({ error: "invalid_task_chain" }, 400)
    if (!(await chainsReady(sql, administratorId, stages)))
      return context.json({ error: "invalid_task_chain" }, 400)
    const created = await sql.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        insert into task_chain (group_id, administrator_id, created_by, name)
        values (${groupId}::uuid, ${administratorId}::uuid, ${user}::uuid, ${name})
        returning id::text as id
      `
      const id = rows[0]?.id
      if (id === undefined) return null
      await replaceItems(tx, id, stages)
      return id
    })
    if (created === null) return context.json({ error: "invalid_task_chain" }, 400)
    const view = groupStages(await loadRows(sql, administratorId, created), false)[0]
    return context.json(view, 201)
  })

  app.put("/api/task-chains/:id", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const id = context.req.param("id")
    if (administratorId === null || !isUuid(id)) return context.json({ error: "not_found" }, 404)
    const body = (await context.req.json().catch(() => null)) as {
      name?: unknown
      stages?: unknown
    } | null
    const name = typeof body?.name === "string" ? body.name.trim() : ""
    const stages = readStages(body?.stages)
    if (name.length < 1 || name.length > 80 || stages === null)
      return context.json({ error: "invalid_task_chain" }, 400)
    if (!(await chainsReady(sql, administratorId, stages)))
      return context.json({ error: "invalid_task_chain" }, 400)
    const saved = await sql.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        update task_chain
        set name = ${name}, updated_at = now()
        where id = ${id}::uuid and administrator_id = ${administratorId}::uuid
        returning id::text as id
      `
      if (rows[0] === undefined) return false
      await replaceItems(tx, id, stages)
      return true
    })
    if (!saved) return context.json({ error: "not_found" }, 404)
    const view = groupStages(await loadRows(sql, administratorId, id), false)[0]
    return context.json(view)
  })

  app.delete("/api/task-chains/:id", async (context) => {
    const user = await userFromRequest(sql, context.req.raw)
    if (user === null) return context.json({ error: "authentication_required" }, 401)
    const administratorId = await administratorFor(sql, user)
    const id = context.req.param("id")
    if (administratorId === null || !isUuid(id)) return context.json({ error: "not_found" }, 404)
    const used = await sql`
      select 1 from operation_dispatch where task_chain_id = ${id}::uuid
      union all
      select 1 from execution_task where task_chain_id = ${id}::uuid
      limit 1
    `
    if (used.length > 0) return context.json({ error: "task_chain_in_use" }, 409)
    const rows = await sql<{ id: string }[]>`
      delete from task_chain
      where id = ${id}::uuid and administrator_id = ${administratorId}::uuid
      returning id::text as id
    `
    return rows[0] === undefined
      ? context.json({ error: "not_found" }, 404)
      : context.json({ ok: true })
  })
}
